"use client";

import { useState } from "react";

import { computeNiceIntegerAxis, formatPhpCurrency } from "../../../components/manager/chartUtils";
import styles from "./reports.module.css";

export type ReportBarDatum = {
  key: string;
  label: string;
  tooltipLabel: string;
  value: number;
  secondaryNote?: string;
};

type ReportBarChartProps = {
  title: string;
  subtitle?: string;
  data: ReportBarDatum[];
  formatMode: "currency" | "integer";
  accent?: "green" | "gold";
  emptyMessage?: string;
};

export default function ReportBarChart({
  title,
  subtitle,
  data,
  formatMode,
  accent = "green",
  emptyMessage = "No activity recorded in this reporting window.",
}: ReportBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxVal = data.reduce((acc, item) => (item.value > acc ? item.value : acc), 0);
  const { maxTick, ticks } = computeNiceIntegerAxis(
    maxVal,
    formatMode === "currency" ? 1000 : 8
  );

  const svgWidth = 680;
  const svgHeight = 220;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 14;
  const padBottom = 34;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const count = Math.max(1, data.length);
  const slotW = plotW / count;
  const barW = Math.max(4, Math.min(32, slotW * 0.62));
  const stepLabelEvery = count <= 10 ? 1 : count <= 24 ? 3 : 5;

  const activePoint =
    hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < data.length
      ? data[hoveredIdx]
      : null;

  const formatVal = (v: number) =>
    formatMode === "currency" ? formatPhpCurrency(v) : v.toLocaleString("en-PH");

  const barColor = accent === "gold" ? "var(--brand-gold)" : "var(--brand-green)";

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        </div>
      </div>

      {activePoint && (
        <div className={styles.chartTooltip} role="status">
          <span>{activePoint.tooltipLabel}</span>
          <span>
            <strong>{formatVal(activePoint.value)}</strong>
            {activePoint.secondaryNote ? ` · ${activePoint.secondaryNote}` : ""}
          </span>
        </div>
      )}

      {data.length === 0 ? (
        <div className={styles.emptyState}>{emptyMessage}</div>
      ) : (
        <div className={styles.chartWrap}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className={styles.svgChart}
            role="img"
            aria-label={`${title} bar chart`}
          >
            {ticks.map((tickVal) => {
              const y = padTop + plotH - (tickVal / maxTick) * plotH;
              const lbl =
                formatMode === "currency" && tickVal >= 1000
                  ? `₱${(tickVal / 1000).toFixed(tickVal % 1000 === 0 ? 0 : 1)}k`
                  : formatMode === "currency"
                    ? `₱${tickVal}`
                    : String(tickVal);
              return (
                <g key={tickVal}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={svgWidth - padRight}
                    y2={y}
                    stroke="var(--border-subtle)"
                    strokeDasharray={tickVal === 0 ? undefined : "3 3"}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="10"
                    fill="var(--text-muted)"
                  >
                    {lbl}
                  </text>
                </g>
              );
            })}

            {data.map((point, idx) => {
              const ratio = maxTick > 0 ? Math.max(0, point.value / maxTick) : 0;
              const barH = point.value > 0 ? Math.max(2, ratio * plotH) : 0;
              const x = padLeft + idx * slotW + (slotW - barW) / 2;
              const y = padTop + plotH - barH;
              const showLabel =
                idx === 0 || idx === data.length - 1 || idx % stepLabelEvery === 0;
              return (
                <g
                  key={point.key}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <rect
                    x={padLeft + idx * slotW}
                    y={padTop}
                    width={slotW}
                    height={plotH}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                  />
                  {barH > 0 && (
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      rx={3}
                      fill={barColor}
                      opacity={hoveredIdx === null || hoveredIdx === idx ? 0.92 : 0.45}
                    />
                  )}
                  {showLabel && (
                    <text
                      x={padLeft + idx * slotW + slotW / 2}
                      y={svgHeight - 10}
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--text-muted)"
                    >
                      {point.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {maxVal === 0 && data.length > 0 && (
        <p className={styles.cardSubtitle}>{emptyMessage}</p>
      )}
    </section>
  );
}
