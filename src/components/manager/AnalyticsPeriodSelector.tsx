"use client";

import type { RevenuePeriod } from "../../types/staff";
import styles from "./analytics-period-selector.module.css";

export const ANALYTICS_PERIOD_OPTIONS: Array<{ value: RevenuePeriod; label: string }> = [
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_12_months", label: "Last 12 months" },
];

type AnalyticsPeriodSelectorProps = {
  period: RevenuePeriod;
  onChange: (nextPeriod: RevenuePeriod) => void;
};

export default function AnalyticsPeriodSelector({
  period,
  onChange,
}: AnalyticsPeriodSelectorProps) {
  return (
    <div
      className={styles.periodGroup}
      role="group"
      aria-label="Dashboard analytics reporting period"
    >
      {ANALYTICS_PERIOD_OPTIONS.map((opt) => {
        const isActive = period === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`${styles.periodBtn} ${isActive ? styles.periodBtnActive : ""}`}
            aria-pressed={isActive}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
