"use client";

import { useState } from "react";
import type { RevenuePeriod } from "../../types/staff";
import { RefreshIcon } from "../ui/Icons";
import AnalyticsPeriodSelector from "./AnalyticsPeriodSelector";
import KpiSummaryRow from "./KpiSummaryRow";
import OperationalAlertStrip from "./OperationalAlertStrip";
import OrderDistributionChart from "./OrderDistributionChart";
import OrderVolumeChart from "./OrderVolumeChart";
import RevenueTrendChart from "./RevenueTrendChart";
import TopSellingDishesChart from "./TopSellingDishesChart";
import styles from "../../app/manager/manager.module.css";

export default function ManagerAnalyticsDashboard() {
  const [period, setPeriod] = useState<RevenuePeriod>("last_7_days");
  const [refreshNonce, setRefreshNonce] = useState(0);

  return (
    <div className={styles.pageContainer}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
        <div className={styles.headerControls}>
          <AnalyticsPeriodSelector period={period} onChange={setPeriod} />
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => setRefreshNonce((n) => n + 1)}
            aria-label="Refresh dashboard metrics and alerts"
            title="Refresh dashboard metrics and alerts"
          >
            <RefreshIcon size={15} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <OperationalAlertStrip refreshNonce={refreshNonce} />

      <KpiSummaryRow period={period} refreshNonce={refreshNonce} />

      <div className={styles.dashboardAnalytics}>
        <RevenueTrendChart period={period} refreshNonce={refreshNonce} />
        <OrderDistributionChart period={period} refreshNonce={refreshNonce} />
      </div>

      <div className={styles.dashboardSecondaryCharts}>
        <TopSellingDishesChart period={period} refreshNonce={refreshNonce} />
        <OrderVolumeChart period={period} refreshNonce={refreshNonce} />
      </div>
    </div>
  );
}
