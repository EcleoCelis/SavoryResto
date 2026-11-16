"use client";

import { useState } from "react";
import type { RevenuePeriod } from "../../types/staff";
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

  return (
    <div className={styles.pageContainer}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
        <AnalyticsPeriodSelector period={period} onChange={setPeriod} />
      </header>

      <OperationalAlertStrip />

      <KpiSummaryRow period={period} />

      <div className={styles.dashboardAnalytics}>
        <RevenueTrendChart period={period} />
        <OrderDistributionChart period={period} />
      </div>

      <div className={styles.dashboardSecondaryCharts}>
        <TopSellingDishesChart period={period} />
        <OrderVolumeChart period={period} />
      </div>
    </div>
  );
}
