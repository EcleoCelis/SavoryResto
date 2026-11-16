"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getManagerOrderDistribution } from "../../lib/api/staff";
import type {
  OrderDistributionItem,
  OrderDistributionResponse,
  OrderStatusCode,
  RevenuePeriod,
} from "../../types/staff";
import { ANALYTICS_PERIOD_OPTIONS } from "./AnalyticsPeriodSelector";
import styles from "./order-distribution-chart.module.css";

const SVG_SIZE = 200;
const CENTER = 100;
const RADIUS = 72;
const STROKE_WIDTH = 24;
const HOVER_STROKE_WIDTH = 27;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const VALID_STATUS_SET = new Set<OrderStatusCode>([
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

const STATUS_COLOR_MAP: Record<OrderStatusCode, string> = {
  pending: "#b47a14",
  confirmed: "#1d6f8a",
  preparing: "#d9730d",
  ready: "#2b8c78",
  completed: "#173f35",
  cancelled: "#c53030",
};

function isValidOrderDistribution(
  res: OrderDistributionResponse | null,
  selectedPeriod: RevenuePeriod
): res is OrderDistributionResponse {
  if (!res || res.period !== selectedPeriod || !Array.isArray(res.distribution)) return false;
  if (res.distribution.length === 0) return false;
  if (!Number.isFinite(res.total_orders) || res.total_orders < 0) return false;

  let sum = 0;
  for (const item of res.distribution) {
    if (
      !VALID_STATUS_SET.has(item.status) ||
      typeof item.label !== "string" ||
      item.label.length === 0 ||
      !Number.isFinite(item.count) ||
      item.count < 0
    ) {
      return false;
    }
    sum += item.count;
  }
  return sum === res.total_orders;
}

type SegmentArc = {
  item: OrderDistributionItem;
  color: string;
  percentage: number;
  dashArray: string;
  dashOffset: number;
};

type OrderDistributionChartProps = {
  period: RevenuePeriod;
};

type FetchState = {
  period: RevenuePeriod | null;
  data: OrderDistributionResponse | null;
  error: string | null;
};

export default function OrderDistributionChart({ period }: OrderDistributionChartProps) {
  const headingId = useId();
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [retryNonce, setRetryNonce] = useState(0);
  const [hoveredStatus, setHoveredStatus] = useState<OrderStatusCode | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({
    period: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;

    getManagerOrderDistribution(period, controller.signal)
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setHoveredStatus(null);
        setFetchState({ period, data: res, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (seq !== requestSeqRef.current) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Unable to load order distribution.";
        setHoveredStatus(null);
        setFetchState({ period, data: null, error: message });
      });

    return () => controller.abort();
  }, [period, retryNonce]);

  const isLoading = fetchState.period !== period;
  const error = fetchState.period === period ? fetchState.error : null;
  const rawResponse = fetchState.period === period ? fetchState.data : null;

  const hasValidDistribution = useMemo(
    () => isValidOrderDistribution(rawResponse, period),
    [rawResponse, period]
  );

  const items: OrderDistributionItem[] = useMemo(
    () => (hasValidDistribution && rawResponse ? rawResponse.distribution : []),
    [hasValidDistribution, rawResponse]
  );
  const totalOrders = hasValidDistribution && rawResponse ? rawResponse.total_orders : 0;
  const isConfirmedZeroOrders = hasValidDistribution && totalOrders === 0;

  const segments: SegmentArc[] = useMemo(() => {
    if (!hasValidDistribution || totalOrders <= 0) return [];
    const arcs: SegmentArc[] = [];
    let consumedLength = 0;

    for (const item of items) {
      if (item.count <= 0) continue;
      const ratio = item.count / totalOrders;
      const length = ratio * CIRCUMFERENCE;
      const dashArray =
        item.count === totalOrders
          ? `${CIRCUMFERENCE.toFixed(2)} 0`
          : `${length.toFixed(2)} ${(CIRCUMFERENCE - length).toFixed(2)}`;
      arcs.push({
        item,
        color: STATUS_COLOR_MAP[item.status],
        percentage: ratio * 100,
        dashArray,
        dashOffset: -consumedLength,
      });
      consumedLength += length;
    }

    return arcs;
  }, [hasValidDistribution, items, totalOrders]);

  const activeSegment = useMemo(() => {
    if (!hoveredStatus || totalOrders <= 0) return null;
    const found = segments.find((seg) => seg.item.status === hoveredStatus);
    if (found) return found;
    const item = items.find((i) => i.status === hoveredStatus);
    if (!item) return null;
    return {
      item,
      color: STATUS_COLOR_MAP[item.status],
      percentage: 0,
      dashArray: `0 ${CIRCUMFERENCE}`,
      dashOffset: 0,
    };
  }, [hoveredStatus, items, segments, totalOrders]);

  const activePeriodLabel =
    ANALYTICS_PERIOD_OPTIONS.find((opt) => opt.value === period)?.label ?? "Selected period";

  const handleRetry = () => {
    setFetchState({ period: null, data: null, error: null });
    setRetryNonce((n) => n + 1);
  };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Order Distribution
        </h2>
        {!error && isConfirmedZeroOrders ? (
          <p className={styles.subtext}>No orders recorded</p>
        ) : (
          <p className={styles.subtext}>Orders placed · Asia/Manila</p>
        )}
      </div>

      {isLoading ? (
        <div
          className={styles.skeletonWrap}
          role="status"
          aria-label="Loading order distribution"
        >
          <div className={styles.skeletonRing} />
          <div className={styles.skeletonLegend}>
            {[0, 1, 2, 3].map((idx) => (
              <span key={idx} className={styles.skeletonRow} />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className={styles.stateBox} role="alert">
          <p className={styles.stateText}>Unable to load order distribution.</p>
          <p className={styles.stateSubtext}>{error}</p>
          <button type="button" className={styles.retryBtn} onClick={handleRetry}>
            Retry
          </button>
        </div>
      ) : !hasValidDistribution ? (
        <div className={styles.stateBox} role="status">
          <p className={styles.stateText}>Order distribution data is currently unavailable.</p>
          <p className={styles.stateSubtext}>
            Status counts could not be verified for {activePeriodLabel.toLowerCase()}.
          </p>
          <button type="button" className={styles.retryBtn} onClick={handleRetry}>
            Retry
          </button>
        </div>
      ) : (
        <div className={styles.content}>
          <div
            className={styles.donutStage}
            onMouseLeave={() => setHoveredStatus(null)}
          >
            <svg
              className={styles.donutSvg}
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              role="img"
              aria-label={
                isConfirmedZeroOrders
                  ? `Order distribution for ${activePeriodLabel}: 0 total orders.`
                  : `Order distribution for ${activePeriodLabel}: ${totalOrders} total orders across operational statuses.`
              }
            >
              {isConfirmedZeroOrders ? (
                <circle
                  className={styles.emptyRing}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                />
              ) : (
                <>
                  <circle
                    className={styles.trackRing}
                    cx={CENTER}
                    cy={CENTER}
                    r={RADIUS}
                  />
                  <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
                    {segments.map((seg) => {
                      const isActive = hoveredStatus === seg.item.status;
                      const isDimmed = hoveredStatus !== null && !isActive;
                      return (
                        <circle
                          key={seg.item.status}
                          data-segment-status={seg.item.status}
                          className={styles.segment}
                          cx={CENTER}
                          cy={CENTER}
                          r={RADIUS}
                          stroke={seg.color}
                          strokeWidth={isActive ? HOVER_STROKE_WIDTH : STROKE_WIDTH}
                          strokeDasharray={seg.dashArray}
                          strokeDashoffset={seg.dashOffset}
                          opacity={isDimmed ? 0.5 : 1}
                          onMouseEnter={() => setHoveredStatus(seg.item.status)}
                          onClick={() =>
                            setHoveredStatus((prev) =>
                              prev === seg.item.status ? null : seg.item.status
                            )
                          }
                        />
                      );
                    })}
                  </g>
                </>
              )}

              <text
                className={styles.centerTotal}
                x={CENTER}
                y={CENTER - 2}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {totalOrders.toLocaleString("en-PH")}
              </text>
              <text
                className={styles.centerCaption}
                x={CENTER}
                y={CENTER + 18}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                Total Orders
              </text>
            </svg>

            {activeSegment && totalOrders > 0 && (
              <div className={styles.tooltip} aria-hidden="true">
                <div className={styles.tooltipStatus}>{activeSegment.item.label}</div>
                <div className={styles.tooltipCount}>
                  {activeSegment.item.count.toLocaleString("en-PH")}{" "}
                  {activeSegment.item.count === 1 ? "order" : "orders"}
                </div>
                <div className={styles.tooltipShare}>
                  {activeSegment.percentage.toFixed(1)}% of total orders
                </div>
              </div>
            )}

            <div className={styles.srOnly} aria-live="polite">
              {activeSegment && totalOrders > 0
                ? `${activeSegment.item.label}: ${activeSegment.item.count} orders, ${activeSegment.percentage.toFixed(1)} percent of total orders.`
                : ""}
            </div>
          </div>

          <ul className={styles.legend} aria-label="Order statuses breakdown">
            {items.map((item) => {
              const color = STATUS_COLOR_MAP[item.status];
              const isInteractive = totalOrders > 0;
              const isActive = hoveredStatus === item.status;
              const pct = totalOrders > 0 ? (item.count / totalOrders) * 100 : null;
              const rowContent = (
                <>
                  <span className={styles.legendLeft}>
                    <span
                      className={`${styles.legendDot} ${
                        isConfirmedZeroOrders ? styles.legendDotMuted : ""
                      }`}
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span className={styles.legendLabel}>{item.label}</span>
                  </span>
                  <span className={styles.legendMeta}>
                    <span className={styles.legendCount}>
                      {item.count.toLocaleString("en-PH")}
                    </span>
                    {pct !== null && (
                      <span className={styles.legendPercent}>{pct.toFixed(1)}%</span>
                    )}
                  </span>
                </>
              );

              return (
                <li key={item.status}>
                  {isInteractive ? (
                    <button
                      type="button"
                      className={`${styles.legendItem} ${styles.legendBtn} ${
                        isActive ? styles.legendItemActive : ""
                      }`}
                      aria-pressed={isActive}
                      onMouseEnter={() => setHoveredStatus(item.status)}
                      onMouseLeave={() => setHoveredStatus(null)}
                      onFocus={() => setHoveredStatus(item.status)}
                      onBlur={() => setHoveredStatus(null)}
                      onClick={() =>
                        setHoveredStatus((prev) => (prev === item.status ? null : item.status))
                      }
                    >
                      {rowContent}
                    </button>
                  ) : (
                    <div className={styles.legendItem}>{rowContent}</div>
                  )}
                </li>
              );
            })}
          </ul>

          <table className={styles.srOnly}>
            <caption>Order Distribution — {activePeriodLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Orders</th>
                {!isConfirmedZeroOrders && <th scope="col">Percentage</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.status}>
                  <td>{item.label}</td>
                  <td>{item.count}</td>
                  {!isConfirmedZeroOrders && (
                    <td>
                      {totalOrders > 0 ? `${((item.count / totalOrders) * 100).toFixed(1)}%` : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
