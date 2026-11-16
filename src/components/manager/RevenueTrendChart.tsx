"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getManagerRevenueTrend } from "../../lib/api/staff";
import type { RevenuePeriod, RevenueTrendPoint, RevenueTrendResponse } from "../../types/staff";
import { ANALYTICS_PERIOD_OPTIONS } from "./AnalyticsPeriodSelector";
import {
  EXPECTED_INTERVAL_COUNTS,
  formatPhpCurrency,
  shouldRenderPeriodXAxisLabel,
} from "./chartUtils";
import styles from "./revenue-trend-chart.module.css";

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 292;

function formatCompactPhpTick(value: number): string {
  if (value === 0) return "₱0";
  if (value >= 1_000_000) {
    const millions = (value / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `₱${millions}M`;
  }
  if (value >= 1_000) {
    const thousands = (value / 1_000).toFixed(1).replace(/\.0$/, "");
    return `₱${thousands}K`;
  }
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(0);
  return `₱${rounded}`;
}

function computeNiceYAxis(maxRevenue: number): { maxTick: number; ticks: number[] } {
  const safeMax = Math.max(maxRevenue, 100);
  const rawStep = safeMax / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;

  const candidateSteps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  const chosenNormalized = candidateSteps.find((c) => c >= normalized) ?? 10;
  const step = chosenNormalized * magnitude;
  const maxTick = step * 4;
  const ticks = [0, step, step * 2, step * 3, maxTick];

  return { maxTick, ticks };
}

function isValidRevenueSeries(
  res: RevenueTrendResponse | null,
  selectedPeriod: RevenuePeriod
): res is RevenueTrendResponse {
  if (!res || res.period !== selectedPeriod || !Array.isArray(res.data)) return false;
  if (res.data.length !== EXPECTED_INTERVAL_COUNTS[selectedPeriod]) return false;
  return res.data.every(
    (point) =>
      typeof point.date === "string" &&
      point.date.length > 0 &&
      typeof point.label === "string" &&
      typeof point.tooltip_label === "string" &&
      Number.isFinite(point.revenue) &&
      point.revenue >= 0 &&
      Number.isFinite(point.order_count) &&
      point.order_count >= 0
  );
}

type RevenueTrendChartProps = {
  period: RevenuePeriod;
};

type FetchState = {
  period: RevenuePeriod | null;
  data: RevenueTrendResponse | null;
  error: string | null;
};

export default function RevenueTrendChart({ period }: RevenueTrendChartProps) {
  const headingId = useId();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [retryNonce, setRetryNonce] = useState(0);
  const [fetchState, setFetchState] = useState<FetchState>({
    period: null,
    data: null,
    error: null,
  });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });

  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const updateSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const nextWidth = Math.round(width);
      const nextHeight = Math.round(height);
      setStageSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      );
    };

    updateSize(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateSize(entry.contentRect.width, entry.contentRect.height || node.clientHeight);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;

    getManagerRevenueTrend(period, controller.signal)
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setActiveIndex(null);
        setFetchState({ period, data: res, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (seq !== requestSeqRef.current) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Unable to load revenue trend data.";
        setActiveIndex(null);
        setFetchState({ period, data: null, error: message });
      });

    return () => controller.abort();
  }, [period, retryNonce]);

  const loading = fetchState.period !== period;
  const error = fetchState.period === period ? fetchState.error : null;
  const trend = fetchState.period === period ? fetchState.data : null;

  const handleRetry = () => {
    setFetchState({ period: null, data: null, error: null });
    setRetryNonce((n) => n + 1);
  };

  const hasValidSeries = useMemo(
    () => isValidRevenueSeries(trend, period),
    [trend, period]
  );
  const points: RevenueTrendPoint[] = useMemo(
    () => (hasValidSeries && trend ? trend.data : []),
    [hasValidSeries, trend]
  );
  const isConfirmedZeroRevenue = useMemo(
    () => hasValidSeries && points.every((point) => point.revenue === 0 && point.order_count === 0),
    [hasValidSeries, points]
  );

  const yAxis = useMemo(() => {
    const maxVal = points.reduce((max, p) => (p.revenue > max ? p.revenue : max), 0);
    return computeNiceYAxis(maxVal);
  }, [points]);

  const geometry = useMemo(() => {
    const width = Math.max(stageSize.width, 280);
    const height = stageSize.height;
    const isNarrow = width < 520;
    const maxTickLabelLen = Math.max(
      ...yAxis.ticks.map((tick) => formatCompactPhpTick(tick).length),
      3
    );

    const padLeft = Math.max(48, maxTickLabelLen * 8 + 14);
    const padRight = isNarrow ? 14 : 22;
    const padTop = 14;
    const padBottom = 34;
    const plotWidth = Math.max(120, width - padLeft - padRight);
    const plotHeight = Math.max(100, height - padTop - padBottom);

    const count = points.length;
    const coords = points.map((point, index) => {
      const ratioX = count > 1 ? index / (count - 1) : 0.5;
      const clampedRevenue = Math.max(0, point.revenue);
      const ratioY = yAxis.maxTick > 0 ? clampedRevenue / yAxis.maxTick : 0;
      return {
        x: padLeft + ratioX * plotWidth,
        y: padTop + (1 - ratioY) * plotHeight,
        point,
      };
    });

    const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotWidth,
      plotHeight,
      coords,
      polylinePoints,
      isThirtyDays: count > 15,
    };
  }, [points, stageSize.height, stageSize.width, yAxis.maxTick, yAxis.ticks]);

  const activeCoord =
    activeIndex !== null && activeIndex >= 0 && activeIndex < geometry.coords.length
      ? geometry.coords[activeIndex]
      : null;

  const updateActiveFromClientX = (clientX: number, rect: DOMRect) => {
    if (geometry.coords.length === 0) return;
    const localX = clientX - rect.left;
    const clampedX = Math.min(
      Math.max(localX, geometry.padLeft),
      geometry.padLeft + geometry.plotWidth
    );
    const ratio =
      geometry.coords.length > 1
        ? (clampedX - geometry.padLeft) / geometry.plotWidth
        : 0;
    const nearestIdx = Math.round(ratio * (geometry.coords.length - 1));
    setActiveIndex(Math.min(Math.max(nearestIdx, 0), geometry.coords.length - 1));
  };

  const handleChartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (geometry.coords.length === 0) return;
    const lastIdx = geometry.coords.length - 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((prev) => (prev === null ? 0 : Math.min(prev + 1, lastIdx)));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((prev) => (prev === null ? lastIdx : Math.max(prev - 1, 0)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(lastIdx);
    } else if (event.key === "Escape") {
      setActiveIndex(null);
    }
  };

  const tooltipPosition = useMemo(() => {
    if (!activeCoord) return null;
    const minLeft = Math.min(116, Math.floor(geometry.width * 0.4));
    const maxLeft = Math.max(minLeft, geometry.width - minLeft);
    const clampedLeft = Math.min(Math.max(activeCoord.x, minLeft), maxLeft);
    const topOffset = activeCoord.y < 84 ? activeCoord.y + 82 : activeCoord.y - 14;
    return { left: clampedLeft, top: topOffset };
  }, [activeCoord, geometry.width]);

  const activePeriodLabel =
    ANALYTICS_PERIOD_OPTIONS.find((opt) => opt.value === period)?.label ?? "Selected period";

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div className={styles.headingGroup}>
          <h2 id={headingId} className={styles.heading}>
            Revenue Trend
          </h2>
          {!error && isConfirmedZeroRevenue ? (
            <p className={styles.emptyCaption}>No revenue recorded during this period</p>
          ) : (
            <p className={styles.emptyCaption}>Completed orders revenue (PHP) · Asia/Manila</p>
          )}
        </div>
      </div>

      <div ref={stageRef} className={styles.chartStage}>
        {loading ? (
          <div className={styles.skeletonWrap} role="status" aria-label="Loading revenue trend">
            {[0, 1, 2, 3, 4].map((lineIdx) => (
              <span key={lineIdx} className={styles.skeletonLine} />
            ))}
            <div className={styles.skeletonPulse} />
          </div>
        ) : error ? (
          <div className={styles.stateBox} role="alert">
            <p className={styles.stateText}>Unable to load revenue trend.</p>
            <p className={styles.stateSubtext}>{error}</p>
            <button type="button" className={styles.retryBtn} onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : !hasValidSeries ? (
          <div className={styles.stateBox} role="status">
            <p className={styles.stateText}>Revenue reporting data is currently unavailable.</p>
            <p className={styles.stateSubtext}>
              The reporting intervals could not be verified for {activePeriodLabel.toLowerCase()}.
            </p>
            <button type="button" className={styles.retryBtn} onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : (
          <div
            className={styles.chartInteractive}
            style={{ opacity: loading ? 0.55 : 1 }}
            tabIndex={0}
            role="group"
            aria-roledescription="interactive line chart"
            aria-label={`Revenue trend for ${activePeriodLabel}. Use Left and Right arrow keys to inspect data points.`}
            onKeyDown={handleChartKeyDown}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              updateActiveFromClientX(e.clientX, rect);
            }}
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              updateActiveFromClientX(e.clientX, rect);
            }}
            onPointerLeave={() => setActiveIndex(null)}
            onBlur={() => setActiveIndex(null)}
          >
            <svg
              className={styles.svg}
              width={geometry.width}
              height={geometry.height}
              viewBox={`0 0 ${geometry.width} ${geometry.height}`}
              aria-hidden="true"
            >
              {yAxis.ticks.map((tick) => {
                const ratio = yAxis.maxTick > 0 ? tick / yAxis.maxTick : 0;
                const y = geometry.padTop + (1 - ratio) * geometry.plotHeight;
                return (
                  <g key={tick}>
                    <line
                      className={styles.gridLine}
                      x1={geometry.padLeft}
                      x2={geometry.padLeft + geometry.plotWidth}
                      y1={y}
                      y2={y}
                    />
                    <text
                      className={styles.axisLabel}
                      x={geometry.padLeft - 10}
                      y={y + 4}
                      textAnchor="end"
                    >
                      {formatCompactPhpTick(tick)}
                    </text>
                  </g>
                );
              })}

              {geometry.coords.map((coord, idx) => {
                if (!shouldRenderPeriodXAxisLabel(idx, geometry.coords.length, period, geometry.plotWidth)) {
                  return null;
                }
                const textAnchor =
                  idx === 0
                    ? "start"
                    : idx === geometry.coords.length - 1
                    ? "end"
                    : "middle";
                return (
                  <text
                    key={coord.point.date}
                    className={styles.axisLabel}
                    x={coord.x}
                    y={geometry.height - 6}
                    textAnchor={textAnchor}
                  >
                    {coord.point.label}
                  </text>
                );
              })}

              {activeCoord && (
                <line
                  className={styles.guideLine}
                  x1={activeCoord.x}
                  x2={activeCoord.x}
                  y1={geometry.padTop}
                  y2={geometry.padTop + geometry.plotHeight}
                />
              )}

              {geometry.coords.length > 1 && (
                <polyline className={styles.seriesLine} points={geometry.polylinePoints} />
              )}

              {geometry.coords.map((coord, idx) => {
                const isSelected = activeIndex === idx;
                const baseRadius = geometry.isThirtyDays ? 3.5 : 4.5;
                return (
                  <g key={coord.point.date}>
                    {isSelected && (
                      <circle className={styles.pointHalo} cx={coord.x} cy={coord.y} r={9} />
                    )}
                    <circle
                      className={styles.pointDot}
                      cx={coord.x}
                      cy={coord.y}
                      r={isSelected ? baseRadius + 1.5 : baseRadius}
                    />
                  </g>
                );
              })}
            </svg>

            {activeCoord && tooltipPosition && (
              <div
                className={styles.tooltip}
                style={{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }}
                aria-hidden="true"
              >
                <div className={styles.tooltipDate}>{activeCoord.point.tooltip_label}</div>
                <div className={styles.tooltipValue}>
                  {formatPhpCurrency(activeCoord.point.revenue)}
                </div>
                <div className={styles.tooltipOrders}>
                  {activeCoord.point.order_count === 0
                    ? "No completed orders"
                    : `${activeCoord.point.order_count} completed ${
                        activeCoord.point.order_count === 1 ? "order" : "orders"
                      }`}
                </div>
              </div>
            )}

            <div className={styles.srOnly} aria-live="polite">
              {activeCoord
                ? `${activeCoord.point.tooltip_label}: ${formatPhpCurrency(
                    activeCoord.point.revenue
                  )}, ${activeCoord.point.order_count} completed orders.`
                : ""}
            </div>
          </div>
        )}
      </div>

      {hasValidSeries && (
        <table className={styles.srOnly}>
          <caption>Revenue Trend — {activePeriodLabel} (PHP)</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Revenue</th>
              <th scope="col">Completed Orders</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <td>{point.tooltip_label}</td>
                <td>{formatPhpCurrency(point.revenue)}</td>
                <td>{point.order_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
