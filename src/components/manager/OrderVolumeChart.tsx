"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getManagerOrderVolume } from "../../lib/api/staff";
import type { OrderVolumePoint, OrderVolumeResponse, RevenuePeriod } from "../../types/staff";
import { ANALYTICS_PERIOD_OPTIONS } from "./AnalyticsPeriodSelector";
import {
  EXPECTED_INTERVAL_COUNTS,
  computeNiceIntegerAxis,
  shouldRenderPeriodXAxisLabel,
} from "./chartUtils";
import styles from "./order-volume-chart.module.css";

const DEFAULT_WIDTH = 540;
const DEFAULT_HEIGHT = 272;

function isValidOrderVolume(
  res: OrderVolumeResponse | null,
  selectedPeriod: RevenuePeriod
): res is OrderVolumeResponse {
  if (!res || res.period !== selectedPeriod || !Array.isArray(res.data)) return false;
  if (res.data.length !== EXPECTED_INTERVAL_COUNTS[selectedPeriod]) return false;
  if (!Number.isFinite(res.total_orders) || res.total_orders < 0) return false;

  return res.data.every(
    (point) =>
      typeof point.date === "string" &&
      point.date.length > 0 &&
      typeof point.label === "string" &&
      typeof point.tooltip_label === "string" &&
      Number.isFinite(point.orders) &&
      point.orders >= 0
  );
}

/** Draw a rectangle with rounded top corners and a flat bottom edge along baselineY. */
function buildTopRoundedBarPath(
  x: number,
  topY: number,
  width: number,
  height: number,
  radius: number
): string {
  const r = Math.min(radius, width / 2, height);
  const bottomY = topY + height;
  if (r <= 0.5) {
    return `M ${x} ${bottomY} L ${x} ${topY} L ${x + width} ${topY} L ${x + width} ${bottomY} Z`;
  }
  return [
    `M ${x} ${bottomY}`,
    `L ${x} ${topY + r}`,
    `Q ${x} ${topY} ${x + r} ${topY}`,
    `L ${x + width - r} ${topY}`,
    `Q ${x + width} ${topY} ${x + width} ${topY + r}`,
    `L ${x + width} ${bottomY}`,
    "Z",
  ].join(" ");
}

type OrderVolumeChartProps = {
  period: RevenuePeriod;
  refreshNonce?: number;
};

type FetchState = {
  period: RevenuePeriod | null;
  data: OrderVolumeResponse | null;
  error: string | null;
};

export default function OrderVolumeChart({
  period,
  refreshNonce = 0,
}: OrderVolumeChartProps) {
  const headingId = useId();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [retryNonce, setRetryNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({
    period: null,
    data: null,
    error: null,
  });
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

    getManagerOrderVolume(period, controller.signal)
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
            : "Unable to load order volume data.";
        setActiveIndex(null);
        setFetchState({ period, data: null, error: message });
      });

    return () => controller.abort();
  }, [period, retryNonce, refreshNonce]);

  const loading = fetchState.period !== period;
  const error = fetchState.period === period ? fetchState.error : null;
  const rawResponse = fetchState.period === period ? fetchState.data : null;

  const hasValidVolume = useMemo(
    () => isValidOrderVolume(rawResponse, period),
    [rawResponse, period]
  );

  const points: OrderVolumePoint[] = useMemo(
    () => (hasValidVolume && rawResponse ? rawResponse.data : []),
    [hasValidVolume, rawResponse]
  );
  const isConfirmedZeroOrders = hasValidVolume && points.every((point) => point.orders === 0);

  const yAxis = useMemo(() => {
    const maxOrders = points.reduce((max, p) => (p.orders > max ? p.orders : max), 0);
    return computeNiceIntegerAxis(maxOrders, 8);
  }, [points]);

  const geometry = useMemo(() => {
    const width = Math.max(stageSize.width, 260);
    const height = stageSize.height;
    const isNarrow = width < 480;
    const maxTickLen = Math.max(
      ...yAxis.ticks.map((t) => t.toLocaleString("en-PH").length),
      2
    );

    const padLeft = Math.max(36, maxTickLen * 8 + 14);
    const padRight = isNarrow ? 10 : 14;
    const padTop = 12;
    const padBottom = 32;
    const plotWidth = Math.max(120, width - padLeft - padRight);
    const plotHeight = Math.max(100, height - padTop - padBottom);
    const baselineY = padTop + plotHeight;

    const count = points.length;
    const slotWidth = count > 0 ? plotWidth / count : plotWidth;
    const barWidth = Math.max(4, Math.min(36, slotWidth * 0.64));
    const cornerRadius = Math.min(6, barWidth * 0.28);

    const bars = points.map((point, index) => {
      const centerX = padLeft + (index + 0.5) * slotWidth;
      const x = centerX - barWidth / 2;
      const ratio = yAxis.maxTick > 0 ? Math.min(point.orders / yAxis.maxTick, 1) : 0;
      const barHeight = point.orders > 0 ? Math.max(4, ratio * plotHeight) : 0;
      const topY = baselineY - barHeight;
      return {
        point,
        centerX,
        x,
        width: barWidth,
        topY,
        height: barHeight,
        path:
          barHeight > 0
            ? buildTopRoundedBarPath(x, topY, barWidth, barHeight, cornerRadius)
            : "",
      };
    });

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotWidth,
      plotHeight,
      baselineY,
      bars,
    };
  }, [points, stageSize.height, stageSize.width, yAxis.maxTick, yAxis.ticks]);

  const activeBar =
    activeIndex !== null && activeIndex >= 0 && activeIndex < geometry.bars.length
      ? geometry.bars[activeIndex]
      : null;

  const updateActiveFromClientX = (clientX: number, rect: DOMRect) => {
    if (geometry.bars.length === 0) return;
    const localX = clientX - rect.left - geometry.padLeft;
    if (localX < 0 || localX > geometry.plotWidth) {
      setActiveIndex(null);
      return;
    }
    const idx = Math.floor((localX / geometry.plotWidth) * geometry.bars.length);
    setActiveIndex(Math.min(Math.max(idx, 0), geometry.bars.length - 1));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (geometry.bars.length === 0) return;
    const lastIdx = geometry.bars.length - 1;
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
    if (!activeBar) return null;
    const minLeft = Math.min(96, Math.floor(geometry.width * 0.38));
    const maxLeft = Math.max(minLeft, geometry.width - minLeft);
    const clampedLeft = Math.min(Math.max(activeBar.centerX, minLeft), maxLeft);
    const anchorY = activeBar.height > 0 ? activeBar.topY : geometry.baselineY - 3;
    const topPos = anchorY < 74 ? anchorY + 72 : anchorY - 10;
    return { left: clampedLeft, top: topPos };
  }, [activeBar, geometry.baselineY, geometry.width]);

  const activePeriodLabel =
    ANALYTICS_PERIOD_OPTIONS.find((opt) => opt.value === period)?.label ?? "Selected period";

  const chartHeading = period === "last_12_months" ? "Order Volume" : "Order Volume by Day";
  const chartSubtext =
    !error && isConfirmedZeroOrders
      ? "No orders recorded during this period."
      : period === "last_12_months"
      ? "Monthly orders placed · Asia/Manila"
      : "Orders placed · Asia/Manila";

  const handleRetry = () => {
    setFetchState({ period: null, data: null, error: null });
    setRetryNonce((n) => n + 1);
  };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          {chartHeading}
        </h2>
        <p className={styles.subtext}>{chartSubtext}</p>
      </div>

      <div ref={stageRef} className={styles.chartStage}>
        {loading ? (
          <div className={styles.skeletonWrap} role="status" aria-label="Loading order volume">
            {[42, 65, 52, 78, 60, 88, 70].map((pct, idx) => (
              <span key={idx} className={styles.skeletonBar} style={{ height: `${pct}%` }} />
            ))}
          </div>
        ) : error ? (
          <div className={styles.stateBox} role="alert">
            <p className={styles.stateText}>Unable to load order volume.</p>
            <p className={styles.stateSubtext}>{error}</p>
            <button type="button" className={styles.retryBtn} onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : !hasValidVolume ? (
          <div className={styles.stateBox} role="status">
            <p className={styles.stateText}>Order volume data is currently unavailable.</p>
            <p className={styles.stateSubtext}>
              Could not verify order counts for {activePeriodLabel.toLowerCase()}.
            </p>
            <button type="button" className={styles.retryBtn} onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : (
          <div
            className={styles.chartInteractive}
            tabIndex={0}
            role="group"
            aria-roledescription="vertical bar chart"
            aria-label={`${chartHeading} for ${activePeriodLabel}. Use Left and Right arrow keys to inspect intervals.`}
            onKeyDown={handleKeyDown}
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
                      {tick.toLocaleString("en-PH")}
                    </text>
                  </g>
                );
              })}

              {geometry.bars.map((bar, idx) => {
                const isActive = activeIndex === idx;
                const isDimmed = activeIndex !== null && !isActive;
                const showLabel = shouldRenderPeriodXAxisLabel(
                  idx,
                  geometry.bars.length,
                  period,
                  geometry.plotWidth
                );
                return (
                  <g key={bar.point.date}>
                    {bar.height > 0 ? (
                      <path
                        className={`${styles.bar} ${isActive ? styles.barActive : ""}`}
                        d={bar.path}
                        opacity={isDimmed ? 0.55 : 1}
                      />
                    ) : (
                      <rect
                        className={`${styles.zeroMarker} ${
                          isActive ? styles.zeroMarkerActive : ""
                        }`}
                        x={bar.x}
                        y={geometry.baselineY - 3}
                        width={bar.width}
                        height={3}
                        rx={1.5}
                      />
                    )}
                    {showLabel && (
                      <text
                        className={styles.axisLabel}
                        x={bar.centerX}
                        y={geometry.height - 6}
                        textAnchor="middle"
                      >
                        {bar.point.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {activeBar && tooltipPosition && (
              <div
                className={styles.tooltip}
                style={{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }}
                aria-hidden="true"
              >
                <div className={styles.tooltipDate}>{activeBar.point.tooltip_label}</div>
                <div className={styles.tooltipCount}>
                  {activeBar.point.orders === 0
                    ? "0 orders placed"
                    : `${activeBar.point.orders.toLocaleString("en-PH")} ${
                        activeBar.point.orders === 1 ? "order placed" : "orders placed"
                      }`}
                </div>
              </div>
            )}

            <div className={styles.srOnly} aria-live="polite">
              {activeBar
                ? `${activeBar.point.tooltip_label}: ${activeBar.point.orders} orders placed.`
                : ""}
            </div>
          </div>
        )}
      </div>

      {hasValidVolume && (
        <table className={styles.srOnly}>
          <caption>
            {chartHeading} — {activePeriodLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Orders Placed</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <td>{point.tooltip_label}</td>
                <td>{point.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
