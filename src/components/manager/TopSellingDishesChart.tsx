"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getManagerTopDishes } from "../../lib/api/staff";
import type { RevenuePeriod, TopSellingDishItem, TopSellingDishesResponse } from "../../types/staff";
import { ANALYTICS_PERIOD_OPTIONS } from "./AnalyticsPeriodSelector";
import { computeNiceIntegerAxis, formatPhpCurrency, truncateLabel } from "./chartUtils";
import styles from "./top-selling-dishes-chart.module.css";

const DEFAULT_WIDTH = 540;
const DEFAULT_HEIGHT = 272;
const MAX_RANKED_ROWS = 5;

function isValidTopDishes(
  res: TopSellingDishesResponse | null,
  selectedPeriod: RevenuePeriod
): res is TopSellingDishesResponse {
  if (!res || res.period !== selectedPeriod || !Array.isArray(res.items)) return false;
  if (res.items.length > MAX_RANKED_ROWS) return false;
  return res.items.every(
    (item) =>
      Number.isFinite(item.product_id) &&
      item.product_id > 0 &&
      typeof item.name === "string" &&
      item.name.trim().length > 0 &&
      Number.isFinite(item.units_sold) &&
      item.units_sold > 0 &&
      Number.isFinite(item.revenue) &&
      item.revenue >= 0
  );
}

type TopSellingDishesChartProps = {
  period: RevenuePeriod;
};

type FetchState = {
  period: RevenuePeriod | null;
  data: TopSellingDishesResponse | null;
  error: string | null;
};

export default function TopSellingDishesChart({ period }: TopSellingDishesChartProps) {
  const headingId = useId();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [retryNonce, setRetryNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [zeroMarkerActive, setZeroMarkerActive] = useState(false);
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

    getManagerTopDishes(period, controller.signal)
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setActiveIndex(null);
        setZeroMarkerActive(false);
        setFetchState({ period, data: res, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (seq !== requestSeqRef.current) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Unable to load top-selling dishes.";
        setActiveIndex(null);
        setZeroMarkerActive(false);
        setFetchState({ period, data: null, error: message });
      });

    return () => controller.abort();
  }, [period, retryNonce]);

  const loading = fetchState.period !== period;
  const error = fetchState.period === period ? fetchState.error : null;
  const rawResponse = fetchState.period === period ? fetchState.data : null;

  const hasValidPayload = useMemo(
    () => isValidTopDishes(rawResponse, period),
    [rawResponse, period]
  );

  const items: TopSellingDishItem[] = useMemo(
    () => (hasValidPayload && rawResponse ? rawResponse.items : []),
    [hasValidPayload, rawResponse]
  );
  const isZeroSales = !loading && !error && hasValidPayload && items.length === 0;

  const xAxis = useMemo(() => {
    const maxUnits = items.reduce((max, item) => (item.units_sold > max ? item.units_sold : max), 0);
    return computeNiceIntegerAxis(maxUnits, 40);
  }, [items]);

  const geometry = useMemo(() => {
    const width = Math.max(stageSize.width, 260);
    const height = stageSize.height;
    const isNarrow = width < 420;
    const padLeft = isNarrow ? 104 : 136;
    const padRight = isNarrow ? 16 : 22;
    const padTop = 8;
    const padBottom = 28;
    const plotWidth = Math.max(100, width - padLeft - padRight);
    const plotHeight = Math.max(120, height - padTop - padBottom);
    const slotHeight = plotHeight / MAX_RANKED_ROWS;
    const barHeight = Math.min(28, Math.max(16, slotHeight * 0.58));
    const maxLabelChars = isNarrow ? 13 : 17;

    const bars = items.map((item, idx) => {
      const ratio = xAxis.maxTick > 0 ? Math.min(item.units_sold / xAxis.maxTick, 1) : 0;
      const barWidth = Math.max(6, ratio * plotWidth);
      const y = padTop + idx * slotHeight + (slotHeight - barHeight) / 2;
      return {
        item,
        x: padLeft,
        y,
        width: barWidth,
        height: barHeight,
        labelY: y + barHeight / 2 + 4,
        displayName: truncateLabel(item.name, maxLabelChars),
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
      slotHeight,
      barHeight,
      zeroMarkerY: padTop + (plotHeight - barHeight) / 2,
      bars,
    };
  }, [items, stageSize.height, stageSize.width, xAxis.maxTick]);

  const activeBar =
    activeIndex !== null && activeIndex >= 0 && activeIndex < geometry.bars.length
      ? geometry.bars[activeIndex]
      : null;

  const updateActiveFromClientY = (clientY: number, rect: DOMRect) => {
    if (isZeroSales) return;
    if (geometry.bars.length === 0) return;
    const localY = clientY - rect.top - geometry.padTop;
    const idx = Math.floor(localY / geometry.slotHeight);
    if (idx >= 0 && idx < geometry.bars.length) {
      setActiveIndex(idx);
    } else {
      setActiveIndex(null);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isZeroSales) {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowLeft"
      ) {
        event.preventDefault();
        setZeroMarkerActive(true);
      } else if (event.key === "Escape") {
        setZeroMarkerActive(false);
      }
      return;
    }

    if (geometry.bars.length === 0) return;
    const lastIdx = geometry.bars.length - 1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((prev) => (prev === null ? 0 : Math.min(prev + 1, lastIdx)));
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
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
    const anchorX = activeBar.x + Math.min(activeBar.width * 0.55, geometry.plotWidth * 0.72);
    const minLeft = Math.min(110, Math.floor(geometry.width * 0.42));
    const maxLeft = Math.max(minLeft, geometry.width - minLeft);
    const clampedLeft = Math.min(Math.max(anchorX, minLeft), maxLeft);
    const topPos = activeBar.y < 72 ? activeBar.y + activeBar.height + 76 : activeBar.y - 8;
    return { left: clampedLeft, top: topPos };
  }, [activeBar, geometry.plotWidth, geometry.width]);

  const zeroTooltipPosition = useMemo(() => {
    const anchorX = geometry.padLeft + 18;
    const minLeft = Math.min(108, Math.floor(geometry.width * 0.42));
    const maxLeft = Math.max(minLeft, geometry.width - minLeft);
    const clampedLeft = Math.min(Math.max(anchorX, minLeft), maxLeft);
    const topPos = Math.max(66, geometry.zeroMarkerY - 10);
    return { left: clampedLeft, top: topPos };
  }, [geometry.padLeft, geometry.width, geometry.zeroMarkerY]);

  const activePeriodLabel =
    ANALYTICS_PERIOD_OPTIONS.find((opt) => opt.value === period)?.label ?? "Selected period";

  const handleRetry = () => {
    setZeroMarkerActive(false);
    setFetchState({ period: null, data: null, error: null });
    setRetryNonce((n) => n + 1);
  };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Top-Selling Dishes
        </h2>
        {!error && isZeroSales ? (
          <p className={styles.subtext}>No dishes sold during this period.</p>
        ) : (
          <p className={styles.subtext}>Units sold (completed orders) · Top 5</p>
        )}
      </div>

      <div ref={stageRef} className={styles.chartStage}>
        {loading ? (
          <div className={styles.skeletonWrap} role="status" aria-label="Loading top-selling dishes">
            {[84, 68, 56, 44, 34].map((pct, idx) => (
              <div key={idx} className={styles.skeletonRow}>
                <span className={styles.skeletonName} />
                <span className={styles.skeletonBar} style={{ width: `${pct}%` }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className={styles.stateBox} role="alert">
            <p className={styles.stateText}>Unable to load top-selling dishes.</p>
            <p className={styles.stateSubtext}>{error}</p>
            <button type="button" className={styles.retryBtn} onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : !hasValidPayload ? (
          <div className={styles.stateBox} role="status">
            <p className={styles.stateText}>Dish sales data is currently unavailable.</p>
            <p className={styles.stateSubtext}>
              Could not verify ranked dish sales for {activePeriodLabel.toLowerCase()}.
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
            aria-roledescription="horizontal bar chart"
            aria-label={
              isZeroSales
                ? `Top-Selling Dishes for ${activePeriodLabel}: no dishes sold during this period. Zero-sales marker at 0.`
                : `Top-Selling Dishes for ${activePeriodLabel}. Use Up and Down arrow keys to inspect rankings.`
            }
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (isZeroSales) setZeroMarkerActive(true);
            }}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              updateActiveFromClientY(e.clientY, rect);
            }}
            onPointerDown={(e) => {
              if (isZeroSales) {
                setZeroMarkerActive(true);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              updateActiveFromClientY(e.clientY, rect);
            }}
            onPointerLeave={() => {
              setActiveIndex(null);
              setZeroMarkerActive(false);
            }}
            onBlur={() => {
              setActiveIndex(null);
              setZeroMarkerActive(false);
            }}
          >
            <svg
              className={styles.svg}
              width={geometry.width}
              height={geometry.height}
              viewBox={`0 0 ${geometry.width} ${geometry.height}`}
              aria-hidden="true"
            >
              {xAxis.ticks.map((tick) => {
                const ratio = xAxis.maxTick > 0 ? tick / xAxis.maxTick : 0;
                const x = geometry.padLeft + ratio * geometry.plotWidth;
                return (
                  <g key={tick}>
                    <line
                      className={styles.gridLine}
                      x1={x}
                      x2={x}
                      y1={geometry.padTop}
                      y2={geometry.padTop + geometry.plotHeight}
                    />
                    <text
                      className={styles.axisLabel}
                      x={x}
                      y={geometry.height - 6}
                      textAnchor={tick === xAxis.maxTick ? "end" : "middle"}
                    >
                      {tick.toLocaleString("en-PH")}
                    </text>
                  </g>
                );
              })}

              <line
                className={styles.baseline}
                x1={geometry.padLeft}
                x2={geometry.padLeft + geometry.plotWidth}
                y1={geometry.padTop + geometry.plotHeight}
                y2={geometry.padTop + geometry.plotHeight}
              />

              {isZeroSales ? (
                <g
                  data-zero-sales-marker="true"
                  onPointerEnter={() => setZeroMarkerActive(true)}
                  onPointerLeave={() => setZeroMarkerActive(false)}
                  onClick={() => setZeroMarkerActive(true)}
                >
                  <rect
                    className={`${styles.zeroMarker} ${
                      zeroMarkerActive ? styles.zeroMarkerActive : ""
                    }`}
                    x={geometry.padLeft}
                    y={geometry.zeroMarkerY}
                    width={4}
                    height={geometry.barHeight}
                    rx={2}
                  />
                  <rect
                    className={styles.zeroHitArea}
                    data-zero-sales-hit="true"
                    x={Math.max(0, geometry.padLeft - 14)}
                    y={Math.max(0, geometry.zeroMarkerY - 14)}
                    width={58}
                    height={geometry.barHeight + 28}
                    rx={6}
                  />
                </g>
              ) : (
                geometry.bars.map((bar, idx) => {
                  const isActive = activeIndex === idx;
                  const isDimmed = activeIndex !== null && !isActive;
                  return (
                    <g key={bar.item.product_id}>
                      <text
                        className={`${styles.dishLabel} ${isActive ? styles.dishLabelActive : ""}`}
                        x={geometry.padLeft - 12}
                        y={bar.labelY}
                        textAnchor="end"
                      >
                        {bar.displayName}
                      </text>
                      <rect
                        className={`${styles.bar} ${isActive ? styles.barActive : ""}`}
                        x={bar.x}
                        y={bar.y}
                        width={bar.width}
                        height={bar.height}
                        rx={6}
                        opacity={isDimmed ? 0.55 : 1}
                      />
                    </g>
                  );
                })
              )}
            </svg>

            {isZeroSales && zeroMarkerActive ? (
              <div
                className={styles.tooltip}
                style={{ left: `${zeroTooltipPosition.left}px`, top: `${zeroTooltipPosition.top}px` }}
                aria-hidden="true"
              >
                <div className={styles.tooltipTitle}>Top-Selling Dishes</div>
                <div className={styles.tooltipMeta}>Units sold: 0</div>
                <div className={styles.tooltipRevenue}>Period: {activePeriodLabel}</div>
              </div>
            ) : (
              activeBar &&
              tooltipPosition && (
                <div
                  className={styles.tooltip}
                  style={{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }}
                  aria-hidden="true"
                >
                  <div className={styles.tooltipTitle}>{activeBar.item.name}</div>
                  <div className={styles.tooltipMeta}>
                    Units sold: {activeBar.item.units_sold.toLocaleString("en-PH")}
                  </div>
                  <div className={styles.tooltipRevenue}>
                    Sales revenue: {formatPhpCurrency(activeBar.item.revenue)}
                  </div>
                </div>
              )
            )}

            <div className={styles.srOnly} aria-live="polite">
              {isZeroSales && zeroMarkerActive
                ? `Top-Selling Dishes. Units sold: 0. Period: ${activePeriodLabel}.`
                : activeBar
                ? `${activeBar.item.name}: ${activeBar.item.units_sold} units sold, ${formatPhpCurrency(
                    activeBar.item.revenue
                  )} sales revenue.`
                : ""}
            </div>
          </div>
        )}
      </div>

      {hasValidPayload && (
        <table className={styles.srOnly}>
          <caption>Top-Selling Dishes — {activePeriodLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Dish</th>
              <th scope="col">Units Sold</th>
              <th scope="col">Sales Revenue (PHP)</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4}>No dishes sold during this period.</td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <tr key={item.product_id}>
                  <td>{idx + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.units_sold}</td>
                  <td>{formatPhpCurrency(item.revenue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
