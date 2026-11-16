"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getManagerKpiSummary } from "../../lib/api/staff";
import type { KpiSummaryResponse, RevenuePeriod } from "../../types/staff";
import { ANALYTICS_PERIOD_OPTIONS } from "./AnalyticsPeriodSelector";
import { formatPhpCurrency } from "./chartUtils";
import styles from "./kpi-summary-row.module.css";

function isValidKpiSummary(
  res: KpiSummaryResponse | null,
  selectedPeriod: RevenuePeriod
): res is KpiSummaryResponse {
  if (!res || res.period !== selectedPeriod) return false;
  return (
    Number.isFinite(res.total_revenue) &&
    res.total_revenue >= 0 &&
    Number.isFinite(res.total_orders) &&
    res.total_orders >= 0 &&
    Number.isFinite(res.completed_orders) &&
    res.completed_orders >= 0 &&
    Number.isFinite(res.placed_completed_orders) &&
    res.placed_completed_orders >= 0 &&
    Number.isFinite(res.completion_rate) &&
    res.completion_rate >= 0 &&
    res.completion_rate <= 100 &&
    Number.isFinite(res.average_order_value) &&
    res.average_order_value >= 0
  );
}

type KpiSummaryRowProps = {
  period: RevenuePeriod;
};

type FetchState = {
  period: RevenuePeriod | null;
  data: KpiSummaryResponse | null;
  error: string | null;
};

export default function KpiSummaryRow({ period }: KpiSummaryRowProps) {
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
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

    getManagerKpiSummary(period, controller.signal)
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setFetchState({ period, data: res, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (seq !== requestSeqRef.current) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Unable to load KPI summary metrics.";
        setFetchState({ period, data: null, error: message });
      });

    return () => controller.abort();
  }, [period, retryNonce]);

  const loading = fetchState.period !== period;
  const error = fetchState.period === period ? fetchState.error : null;
  const rawData = fetchState.period === period ? fetchState.data : null;

  const summary = useMemo(
    () => (isValidKpiSummary(rawData, period) ? rawData : null),
    [rawData, period]
  );

  const activePeriodLabel =
    ANALYTICS_PERIOD_OPTIONS.find((opt) => opt.value === period)?.label ?? "Selected period";

  const handleRetry = () => {
    setFetchState({ period: null, data: null, error: null });
    setRetryNonce((n) => n + 1);
  };

  if (loading) {
    return (
      <section className={styles.grid} aria-label="KPI summary metrics" aria-busy="true">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className={styles.card}>
            <span className={styles.skelLabel} />
            <span className={styles.skelValue} />
            <span className={styles.skelSub} />
          </div>
        ))}
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className={styles.errorBox} role="alert" aria-label="KPI summary metrics error">
        <div>
          <p className={styles.errorTitle}>Unable to load KPI summary metrics.</p>
          <p className={styles.errorDetail}>
            {error ?? `Summary data unavailable for ${activePeriodLabel.toLowerCase()}.`}
          </p>
        </div>
        <button type="button" className={styles.retryBtn} onClick={handleRetry}>
          Retry
        </button>
      </section>
    );
  }

  const cards = [
    {
      label: "Total Revenue",
      value: formatPhpCurrency(summary.total_revenue),
      subtext:
        summary.completed_orders === 0
          ? "No completed sales"
          : `${summary.completed_orders.toLocaleString("en-PH")} completed ${
              summary.completed_orders === 1 ? "order" : "orders"
            }`,
    },
    {
      label: "Total Orders",
      value: summary.total_orders.toLocaleString("en-PH"),
      subtext: `Orders placed · ${activePeriodLabel}`,
    },
    {
      label: "Completion Rate",
      value: `${summary.completion_rate.toFixed(1)}%`,
      subtext:
        summary.total_orders === 0
          ? "No orders placed"
          : `${summary.placed_completed_orders.toLocaleString("en-PH")} of ${summary.total_orders.toLocaleString(
              "en-PH"
            )} completed`,
    },
    {
      label: "Avg. Order Value",
      value: formatPhpCurrency(summary.average_order_value),
      subtext:
        summary.completed_orders === 0 ? "No completed orders" : "Per completed order",
    },
  ];

  return (
    <section className={styles.grid} aria-label="KPI summary metrics">
      {cards.map((card) => (
        <article key={card.label} className={styles.card}>
          <h2 className={styles.label}>{card.label}</h2>
          <p className={styles.value}>{card.value}</p>
          <p className={styles.subtext}>{card.subtext}</p>
        </article>
      ))}
    </section>
  );
}
