"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { formatPhpCurrency } from "../../../components/manager/chartUtils";
import { RefreshIcon } from "../../../components/ui/Icons";
import {
  downloadManagerReportCsv,
  getManagerInventoryReport,
  getManagerMenuReport,
  getManagerOrdersReport,
  getManagerPaymentsReport,
  getManagerReportOverview,
  getManagerSalesReport,
  StaffApiError,
} from "../../../lib/api/staff";
import type {
  ManagerInventoryReportResponse,
  ManagerMenuReportResponse,
  ManagerOrdersReportResponse,
  ManagerPaymentsReportResponse,
  ManagerReportOverviewResponse,
  ManagerSalesReportResponse,
  MenuReportSortBy,
  PaymentSettlementState,
  ReportDatePreset,
  ReportExportType,
  ReportGranularity,
  SortDirection,
} from "../../../types/staff";
import ReportBarChart from "./ReportBarChart";
import styles from "./reports.module.css";

type ReportTab = "overview" | "sales" | "orders" | "menu" | "payments" | "inventory";

const PRESET_OPTIONS: Array<{ value: ReportDatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
];

const TAB_ITEMS: Array<{ value: ReportTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "sales", label: "Sales & Revenue" },
  { value: "orders", label: "Orders" },
  { value: "menu", label: "Menu Performance" },
  { value: "payments", label: "Payments" },
  { value: "inventory", label: "Inventory" },
];

function getTodayManilaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getOffsetManilaIso(daysAgo: number): string {
  const target = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
}

function formatDateManila(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCalendarDate(dateStr: string): string {
  const parsed = new Date(`${dateStr}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDeltaSummary(
  delta: number,
  changePct: number | null,
  isCurrency: boolean
): { text: string; className: string } {
  if (changePct === null) {
    return { text: "No prior baseline", className: styles.deltaNeutral };
  }
  const sign = delta > 0 ? "+" : "";
  const formattedDelta = isCurrency ? formatPhpCurrency(delta) : `${sign}${delta}`;
  const pctStr = `${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}%`;
  const className =
    delta > 0 ? styles.deltaUp : delta < 0 ? styles.deltaDown : styles.deltaNeutral;
  return {
    text: `${pctStr} (${sign}${formattedDelta}) vs prev`,
    className,
  };
}

function statusBadgeClass(status: string): string {
  if (status === "completed" || status === "settled" || status === "normal") {
    return styles.badgeCompleted;
  }
  if (status === "cancelled" || status === "voided" || status === "out_of_stock") {
    return styles.badgeCancelled;
  }
  return styles.badgePending;
}

export default function ManagerReportsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ReportTab>("overview");

  // Shared reporting window
  const [preset, setPreset] = useState<ReportDatePreset>("last_30_days");
  const [customFrom, setCustomFrom] = useState<string>(() => getOffsetManilaIso(29));
  const [customTo, setCustomTo] = useState<string>(() => getTodayManilaIso());
  const [appliedCustomFrom, setAppliedCustomFrom] = useState<string>(() => getOffsetManilaIso(29));
  const [appliedCustomTo, setAppliedCustomTo] = useState<string>(() => getTodayManilaIso());
  const [rangeError, setRangeError] = useState<string>("");

  // Tab-specific filters
  const [salesGranularity, setSalesGranularity] = useState<ReportGranularity>("daily");
  const [salesPage, setSalesPage] = useState(1);

  const [ordersStatus, setOrdersStatus] = useState<string>("all");
  const [ordersType, setOrdersType] = useState<string>("all");
  const [ordersPage, setOrdersPage] = useState(1);

  const [menuCategoryId, setMenuCategoryId] = useState<string>("all");
  const [menuSearch, setMenuSearch] = useState<string>("");
  const [menuSortBy, setMenuSortBy] = useState<MenuReportSortBy>("units_sold");
  const [menuSortDir, setMenuSortDir] = useState<SortDirection>("desc");
  const [menuPage, setMenuPage] = useState(1);

  const [paymentsSettlement, setPaymentsSettlement] = useState<"all" | PaymentSettlementState>("all");
  const [paymentsMethod, setPaymentsMethod] = useState<string>("all");
  const [paymentsPage, setPaymentsPage] = useState(1);

  const [inventoryTxType, setInventoryTxType] = useState<string>("all");
  const [inventorySearch, setInventorySearch] = useState<string>("");
  const [inventoryPage, setInventoryPage] = useState(1);

  // Report data states
  const [overviewData, setOverviewData] = useState<ManagerReportOverviewResponse | null>(null);
  const [salesData, setSalesData] = useState<ManagerSalesReportResponse | null>(null);
  const [ordersData, setOrdersData] = useState<ManagerOrdersReportResponse | null>(null);
  const [menuData, setMenuData] = useState<ManagerMenuReportResponse | null>(null);
  const [paymentsData, setPaymentsData] = useState<ManagerPaymentsReportResponse | null>(null);
  const [inventoryData, setInventoryData] = useState<ManagerInventoryReportResponse | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportMsg, setExportMsg] = useState<string>("");
  const [refreshNonce, setRefreshNonce] = useState(0);

  function resetAllPages() {
    setSalesPage(1);
    setOrdersPage(1);
    setMenuPage(1);
    setPaymentsPage(1);
    setInventoryPage(1);
  }

  function handlePresetSelect(nextPreset: ReportDatePreset) {
    setRangeError("");
    setExportMsg("");
    setLoading(true);
    setPreset(nextPreset);
    resetAllPages();
  }

  function handleApplyCustomRange() {
    if (!customFrom || !customTo) {
      setRangeError("Select both start and end dates.");
      return;
    }
    if (customFrom > customTo) {
      setRangeError("Start date must be on or before end date.");
      return;
    }
    const diffDays =
      Math.round(
        (new Date(`${customTo}T00:00:00Z`).getTime() -
          new Date(`${customFrom}T00:00:00Z`).getTime()) /
          86_400_000
      ) + 1;
    if (diffDays > 366) {
      setRangeError("Custom reporting window cannot exceed 366 days.");
      return;
    }
    setRangeError("");
    setExportMsg("");
    setLoading(true);
    setAppliedCustomFrom(customFrom);
    setAppliedCustomTo(customTo);
    setPreset("custom");
    resetAllPages();
  }

  useEffect(() => {
    const controller = new AbortController();
    const baseWindow =
      preset === "custom"
        ? { preset, date_from: appliedCustomFrom, date_to: appliedCustomTo }
        : { preset };

    let task: Promise<unknown>;
    if (activeTab === "overview") {
      task = getManagerReportOverview(baseWindow, controller.signal).then((res) => {
        if (!controller.signal.aborted) setOverviewData(res);
      });
    } else if (activeTab === "sales") {
      task = getManagerSalesReport(
        { ...baseWindow, granularity: salesGranularity, page: salesPage, page_size: 15 },
        controller.signal
      ).then((res) => {
        if (!controller.signal.aborted) setSalesData(res);
      });
    } else if (activeTab === "orders") {
      task = getManagerOrdersReport(
        {
          ...baseWindow,
          status: ordersStatus === "all" ? undefined : ordersStatus,
          order_type: ordersType === "all" ? undefined : ordersType,
          page: ordersPage,
          page_size: 15,
        },
        controller.signal
      ).then((res) => {
        if (!controller.signal.aborted) setOrdersData(res);
      });
    } else if (activeTab === "menu") {
      task = getManagerMenuReport(
        {
          ...baseWindow,
          category_id: menuCategoryId === "all" ? undefined : Number(menuCategoryId),
          search: menuSearch.trim() || undefined,
          sort_by: menuSortBy,
          sort_dir: menuSortDir,
          page: menuPage,
          page_size: 15,
        },
        controller.signal
      ).then((res) => {
        if (!controller.signal.aborted) setMenuData(res);
      });
    } else if (activeTab === "payments") {
      task = getManagerPaymentsReport(
        {
          ...baseWindow,
          settlement: paymentsSettlement,
          method_code: paymentsMethod === "all" ? undefined : paymentsMethod,
          page: paymentsPage,
          page_size: 15,
        },
        controller.signal
      ).then((res) => {
        if (!controller.signal.aborted) setPaymentsData(res);
      });
    } else {
      task = getManagerInventoryReport(
        {
          ...baseWindow,
          transaction_type: inventoryTxType === "all" ? undefined : inventoryTxType,
          search: inventorySearch.trim() || undefined,
          page: inventoryPage,
          page_size: 15,
        },
        controller.signal
      ).then((res) => {
        if (!controller.signal.aborted) setInventoryData(res);
      });
    }

    void task
      .then(() => {
        if (!controller.signal.aborted) {
          setErrorMsg("");
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof StaffApiError && err.status === 401) {
          router.replace("/staff/login");
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : "Failed to load report data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activeTab,
    appliedCustomFrom,
    appliedCustomTo,
    inventoryPage,
    inventorySearch,
    inventoryTxType,
    menuCategoryId,
    menuPage,
    menuSearch,
    menuSortBy,
    menuSortDir,
    ordersPage,
    ordersStatus,
    ordersType,
    paymentsMethod,
    paymentsPage,
    paymentsSettlement,
    preset,
    refreshNonce,
    router,
    salesGranularity,
    salesPage,
  ]);

  const activeWindowMeta =
    activeTab === "overview"
      ? overviewData?.window
      : activeTab === "sales"
        ? salesData?.window
        : activeTab === "orders"
          ? ordersData?.window
          : activeTab === "menu"
            ? menuData?.window
            : activeTab === "payments"
              ? paymentsData?.window
              : inventoryData?.window;

  async function handleExportCsv() {
    setExporting(true);
    setExportMsg("");
    const exportReport: ReportExportType =
      activeTab === "overview" ? "sales" : activeTab;
    const baseWindow =
      preset === "custom"
        ? { preset, date_from: appliedCustomFrom, date_to: appliedCustomTo }
        : { preset };
    try {
      const filename = await downloadManagerReportCsv({
        ...baseWindow,
        report: exportReport,
        granularity: exportReport === "sales" ? salesGranularity : undefined,
        status: exportReport === "orders" && ordersStatus !== "all" ? ordersStatus : undefined,
        order_type: exportReport === "orders" && ordersType !== "all" ? ordersType : undefined,
        category_id:
          exportReport === "menu" && menuCategoryId !== "all"
            ? Number(menuCategoryId)
            : undefined,
        search:
          exportReport === "menu"
            ? menuSearch.trim() || undefined
            : exportReport === "inventory"
              ? inventorySearch.trim() || undefined
              : undefined,
        sort_by: exportReport === "menu" ? menuSortBy : undefined,
        sort_dir: exportReport === "menu" ? menuSortDir : undefined,
        settlement: exportReport === "payments" ? paymentsSettlement : undefined,
        method_code:
          exportReport === "payments" && paymentsMethod !== "all" ? paymentsMethod : undefined,
        transaction_type:
          exportReport === "inventory" && inventoryTxType !== "all" ? inventoryTxType : undefined,
      });
      setExportMsg(`Exported ${filename}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "CSV export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.title}>Reports &amp; Analytics</h1>
          <p className={styles.subtitle}>
            Historical sales, order operations, dish performance, payment reconciliation, and stock movement in Asia/Manila (PHP).
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => {
              setLoading(true);
              setRefreshNonce((n) => n + 1);
            }}
            disabled={loading}
          >
            <RefreshIcon size={15} className={loading ? styles.spinningIcon : undefined} />
            <span>{loading ? "Refreshing..." : "Refresh"}</span>
          </button>

          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => window.print()}
          >
            Print Report
          </button>

          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleExportCsv}
            disabled={exporting || loading}
          >
            {exporting
              ? "Exporting..."
              : activeTab === "overview"
                ? "Export Sales CSV"
                : "Export CSV"}
          </button>
        </div>
      </header>

      <section className={styles.periodBar} aria-label="Reporting date window">
        <div className={styles.presetGroup} role="group" aria-label="Date range presets">
          {PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`${styles.presetBtn} ${preset === opt.value ? styles.presetBtnActive : ""}`}
              onClick={() => {
                if (opt.value === "custom") {
                  setPreset("custom");
                  return;
                }
                handlePresetSelect(opt.value);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {preset === "custom" ? (
          <div className={styles.customRangeGroup}>
            <input
              type="date"
              className={styles.dateInput}
              aria-label="Custom start date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className={styles.windowSummaryText}>to</span>
            <input
              type="date"
              className={styles.dateInput}
              aria-label="Custom end date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handleApplyCustomRange}
            >
              Apply
            </button>
          </div>
        ) : activeWindowMeta ? (
          <span className={styles.windowSummaryText}>
            {formatCalendarDate(activeWindowMeta.date_from)} –{" "}
            {formatCalendarDate(activeWindowMeta.date_to)} · {activeWindowMeta.timezone}
          </span>
        ) : null}
      </section>

      {rangeError && (
        <div className={styles.errorBanner} role="alert">
          <span>{rangeError}</span>
        </div>
      )}

      {exportMsg && (
        <div className={styles.disclosureBar} role="status">
          {exportMsg}
        </div>
      )}

      {errorMsg && (
        <div className={styles.errorBanner} role="alert">
          <span>{errorMsg}</span>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => {
              setLoading(true);
              setErrorMsg("");
              setRefreshNonce((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div className={styles.sectionTabs} role="tablist" aria-label="Report categories">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            className={`${styles.sectionTab} ${activeTab === tab.value ? styles.sectionTabActive : ""}`}
            onClick={() => {
              if (tab.value !== activeTab) {
                setLoading(true);
                setErrorMsg("");
                setActiveTab(tab.value);
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ========================= OVERVIEW TAB ========================= */}
      {activeTab === "overview" && (
        overviewData ? (
          <>
            <div className={styles.disclosureBar}>
              <strong>Executive Window:</strong>{" "}
              {formatCalendarDate(overviewData.window.date_from)} –{" "}
              {formatCalendarDate(overviewData.window.date_to)} vs prior{" "}
              {formatCalendarDate(overviewData.window.previous_date_from)} –{" "}
              {formatCalendarDate(overviewData.window.previous_date_to)}. Recognized revenue counts strictly completed orders.
            </div>

            <section className={styles.kpiGrid} aria-label="Executive KPI summary">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Recognized Revenue</span>
                <span className={styles.kpiValue}>
                  {formatPhpCurrency(overviewData.recognized_revenue.current)}
                </span>
                {(() => {
                  const d = formatDeltaSummary(
                    overviewData.recognized_revenue.delta,
                    overviewData.recognized_revenue.change_pct,
                    true
                  );
                  return <span className={`${styles.kpiMeta} ${d.className}`}>{d.text}</span>;
                })()}
              </div>

              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Orders Placed</span>
                <span className={styles.kpiValue}>
                  {overviewData.total_placed_orders.current.toLocaleString("en-PH")}
                </span>
                {(() => {
                  const d = formatDeltaSummary(
                    overviewData.total_placed_orders.delta,
                    overviewData.total_placed_orders.change_pct,
                    false
                  );
                  return <span className={`${styles.kpiMeta} ${d.className}`}>{d.text}</span>;
                })()}
              </div>

              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Completed Orders</span>
                <span className={styles.kpiValue}>
                  {overviewData.completed_orders.current.toLocaleString("en-PH")}
                </span>
                <span className={styles.kpiMeta}>
                  Completion rate: {overviewData.completion_rate.toFixed(1)}% ·{" "}
                  {overviewData.pending_orders} active / {overviewData.cancelled_orders} cancelled
                </span>
              </div>

              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Average Order Value</span>
                <span className={styles.kpiValue}>
                  {formatPhpCurrency(overviewData.average_order_value.current)}
                </span>
                {(() => {
                  const d = formatDeltaSummary(
                    overviewData.average_order_value.delta,
                    overviewData.average_order_value.change_pct,
                    true
                  );
                  return <span className={`${styles.kpiMeta} ${d.className}`}>{d.text}</span>;
                })()}
              </div>
            </section>

            <ReportBarChart
              title="Recognized Revenue Over Period"
              subtitle="Completed order totals in PHP (Asia/Manila)"
              formatMode="currency"
              data={overviewData.trend.map((pt) => ({
                key: pt.date,
                label: pt.label,
                tooltipLabel: pt.tooltip_label,
                value: pt.recognized_revenue,
                secondaryNote: `${pt.completed_orders} completed (${pt.placed_orders} placed)`,
              }))}
            />

            <div className={styles.twoColGrid}>
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Top Dishes Snapshot</h2>
                    <p className={styles.cardSubtitle}>Ranked by completed units sold</p>
                  </div>
                </div>
                {overviewData.top_dishes.length === 0 ? (
                  <div className={styles.emptyState}>No completed dish sales in this window.</div>
                ) : (
                  <div className={styles.barList}>
                    {(() => {
                      const topUnits = Math.max(1, ...overviewData.top_dishes.map((d) => d.units_sold));
                      return overviewData.top_dishes.map((dish) => (
                        <div key={dish.product_id} className={styles.barRow}>
                          <div className={styles.barRowTop}>
                            <span className={styles.barName}>
                              {dish.name} ({dish.category_name})
                            </span>
                            <span className={styles.barValue}>
                              {dish.units_sold} units · {formatPhpCurrency(dish.sales_value)}
                            </span>
                          </div>
                          <div className={styles.barTrack}>
                            <div
                              className={styles.barFillGreen}
                              style={{ width: `${(dish.units_sold / topUnits) * 100}%` }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </section>

              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Settled Collections by Method</h2>
                    <p className={styles.cardSubtitle}>Completed orders grouped by recorded method</p>
                  </div>
                </div>
                {overviewData.payment_mix.length === 0 ? (
                  <div className={styles.emptyState}>No settled collections in this window.</div>
                ) : (
                  <div className={styles.barList}>
                    {(() => {
                      const topRev = Math.max(
                        1,
                        ...overviewData.payment_mix.map((m) => m.settled_revenue)
                      );
                      return overviewData.payment_mix.map((pm) => (
                        <div key={pm.method_code} className={styles.barRow}>
                          <div className={styles.barRowTop}>
                            <span className={styles.barName}>{pm.method_label}</span>
                            <span className={styles.barValue}>
                              {pm.settled_orders} orders · {formatPhpCurrency(pm.settled_revenue)}
                            </span>
                          </div>
                          <div className={styles.barTrack}>
                            <div
                              className={styles.barFillGold}
                              style={{ width: `${(pm.settled_revenue / topRev) * 100}%` }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className={styles.card}>
            <div className={styles.emptyState}>
              {loading ? "Loading executive overview..." : "No overview data loaded."}
            </div>
          </div>
        )
      )}

      {/* ========================= SALES & REVENUE TAB ========================= */}
      {activeTab === "sales" && (
        salesData ? (
          <>
            <div className={styles.disclosureBar}>
              <strong>Revenue Recognition Policy:</strong> Gross sales, discounts, tax, and recognized revenue include only <code>completed</code> orders in the selected Asia/Manila window. Pending and cancelled orders (<code>{formatPhpCurrency(salesData.voided_amount)}</code> voided) are excluded from recognized revenue.
            </div>

            <section className={styles.kpiGridFive} aria-label="Sales financial totals">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Gross Sales</span>
                <span className={styles.kpiValue}>{formatPhpCurrency(salesData.gross_sales)}</span>
                <span className={styles.kpiMeta}>Order subtotal before discounts</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Discounts</span>
                <span className={styles.kpiValue}>{formatPhpCurrency(salesData.discount_total)}</span>
                <span className={styles.kpiMeta}>Applied promotional reductions</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Tax Collected</span>
                <span className={styles.kpiValue}>{formatPhpCurrency(salesData.tax_total)}</span>
                <span className={styles.kpiMeta}>Completed orders tax sum</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Recognized Revenue</span>
                <span className={styles.kpiValue}>{formatPhpCurrency(salesData.recognized_revenue)}</span>
                <span className={styles.kpiMeta}>{salesData.qualifying_orders} qualifying completed orders</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Voided Orders Value</span>
                <span className={styles.kpiValue}>{formatPhpCurrency(salesData.voided_amount)}</span>
                <span className={styles.kpiMeta}>Cancelled in window (excluded)</span>
              </div>
            </section>

            <div className={styles.filterToolbar}>
              <div className={styles.filterField}>
                <label htmlFor="sales-granularity" className={styles.filterLabel}>
                  Interval Granularity
                </label>
                <select
                  id="sales-granularity"
                  className={styles.selectControl}
                  value={salesGranularity}
                  onChange={(e) => {
                    setLoading(true);
                    setSalesPage(1);
                    setSalesGranularity(e.target.value as ReportGranularity);
                  }}
                >
                  <option value="daily">Daily</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>

            <ReportBarChart
              title={`Sales & Revenue Trend (${salesGranularity === "monthly" ? "Monthly" : "Daily"})`}
              subtitle="Completed order recognized revenue in PHP"
              formatMode="currency"
              data={salesData.series.map((row) => ({
                key: row.bucket,
                label: row.label,
                tooltipLabel: row.tooltip_label,
                value: row.recognized_revenue,
                secondaryNote: `${row.qualifying_orders} orders · AOV ${formatPhpCurrency(row.average_order_value)}`,
              }))}
            />

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Category Item Sales Contribution</h2>
              </div>
              {salesData.category_breakdown.length === 0 ? (
                <div className={styles.emptyState}>No completed category sales in this period.</div>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className={styles.numCol}>Units Sold</th>
                        <th className={styles.numCol}>Item Sales Value</th>
                        <th className={styles.numCol}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesData.category_breakdown.map((cat) => (
                        <tr key={cat.category_name}>
                          <td>{cat.category_name}</td>
                          <td className={styles.numCol}>{cat.units_sold}</td>
                          <td className={styles.numCol}>{formatPhpCurrency(cat.sales_value)}</td>
                          <td className={styles.numCol}>{cat.share_pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Sales Interval Ledger</h2>
                <span className={styles.windowSummaryText}>{salesData.total} intervals</span>
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Interval</th>
                      <th className={styles.numCol}>Qualifying Orders</th>
                      <th className={styles.numCol}>Gross Sales</th>
                      <th className={styles.numCol}>Discounts</th>
                      <th className={styles.numCol}>Tax</th>
                      <th className={styles.numCol}>Recognized Revenue</th>
                      <th className={styles.numCol}>Avg Order Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.ledger_items.map((row) => (
                      <tr key={row.bucket}>
                        <td>{row.tooltip_label}</td>
                        <td className={styles.numCol}>{row.qualifying_orders}</td>
                        <td className={styles.numCol}>{formatPhpCurrency(row.gross_sales)}</td>
                        <td className={styles.numCol}>{formatPhpCurrency(row.discount_total)}</td>
                        <td className={styles.numCol}>{formatPhpCurrency(row.tax_total)}</td>
                        <td className={styles.numCol}>
                          <strong>{formatPhpCurrency(row.recognized_revenue)}</strong>
                        </td>
                        <td className={styles.numCol}>{formatPhpCurrency(row.average_order_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {salesData.total > salesData.page_size && (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={salesPage <= 1}
                    onClick={() => {
                      setLoading(true);
                      setSalesPage((p) => p - 1);
                    }}
                  >
                    Previous
                  </button>
                  <span className={styles.windowSummaryText}>
                    Page {salesData.page} of {Math.ceil(salesData.total / salesData.page_size)}
                  </span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={salesPage * salesData.page_size >= salesData.total}
                    onClick={() => {
                      setLoading(true);
                      setSalesPage((p) => p + 1);
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>
            <div className={styles.emptyState}>
              {loading ? "Loading sales & revenue report..." : "No sales data loaded."}
            </div>
          </div>
        )
      )}

      {/* ========================= ORDERS TAB ========================= */}
      {activeTab === "orders" && (
        ordersData ? (
          <>
            <section className={styles.kpiGrid} aria-label="Orders report metrics">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Orders Placed</span>
                <span className={styles.kpiValue}>{ordersData.total_placed}</span>
                <span className={styles.kpiMeta}>Created inside reporting window</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Completed</span>
                <span className={styles.kpiValue}>{ordersData.completed_count}</span>
                <span className={styles.kpiMeta}>{ordersData.completion_rate.toFixed(1)}% completion rate</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Active / Pending</span>
                <span className={styles.kpiValue}>{ordersData.active_pending_count}</span>
                <span className={styles.kpiMeta}>Pending, Confirmed, Preparing, or Ready</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Cancelled</span>
                <span className={styles.kpiValue}>{ordersData.cancelled_count}</span>
                <span className={styles.kpiMeta}>{ordersData.cancellation_rate.toFixed(1)}% cancellation rate</span>
              </div>
            </section>

            <div className={styles.filterToolbar}>
              <div className={styles.filterField}>
                <label htmlFor="rep-orders-status" className={styles.filterLabel}>
                  Order Status
                </label>
                <select
                  id="rep-orders-status"
                  className={styles.selectControl}
                  value={ordersStatus}
                  onChange={(e) => {
                    setLoading(true);
                    setOrdersPage(1);
                    setOrdersStatus(e.target.value);
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="preparing">Preparing</option>
                  <option value="ready">Ready</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className={styles.filterField}>
                <label htmlFor="rep-orders-type" className={styles.filterLabel}>
                  Order Type
                </label>
                <select
                  id="rep-orders-type"
                  className={styles.selectControl}
                  value={ordersType}
                  onChange={(e) => {
                    setLoading(true);
                    setOrdersPage(1);
                    setOrdersType(e.target.value);
                  }}
                >
                  <option value="all">All Types</option>
                  <option value="dine_in">Dine-in</option>
                  <option value="takeout">Takeout</option>
                </select>
              </div>

              {(ordersStatus !== "all" || ordersType !== "all") && (
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={() => {
                    setLoading(true);
                    setOrdersPage(1);
                    setOrdersStatus("all");
                    setOrdersType("all");
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div className={styles.twoColGrid}>
              <ReportBarChart
                title="Peak Hours (Asia/Manila)"
                subtitle="Orders placed grouped by hour of day (00:00–23:00)"
                formatMode="integer"
                data={ordersData.hourly_volume.map((h) => ({
                  key: h.key,
                  label: h.label.slice(0, 2),
                  tooltipLabel: `Hour ${h.label} Manila`,
                  value: h.count,
                }))}
              />

              <ReportBarChart
                title="Orders by Weekday"
                subtitle="Volume across Monday–Sunday"
                formatMode="integer"
                accent="gold"
                data={ordersData.weekday_volume.map((w) => ({
                  key: w.key,
                  label: w.label,
                  tooltipLabel: w.label,
                  value: w.count,
                }))}
              />
            </div>

            <div className={styles.twoColGrid}>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Current Status Breakdown</h2>
                <div className={styles.barList}>
                  {ordersData.status_breakdown.map((st) => (
                    <div key={st.status} className={styles.barRow}>
                      <div className={styles.barRowTop}>
                        <span className={styles.barName}>{st.label}</span>
                        <span className={styles.barValue}>
                          {st.count} ({st.share_pct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className={styles.barTrack}>
                        <div
                          className={styles.barFillGreen}
                          style={{ width: `${st.share_pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Service Channel Split</h2>
                {ordersData.type_breakdown.length === 0 ? (
                  <div className={styles.emptyState}>No orders matched the current filter.</div>
                ) : (
                  <div className={styles.barList}>
                    {ordersData.type_breakdown.map((tp) => (
                      <div key={tp.order_type} className={styles.barRow}>
                        <div className={styles.barRowTop}>
                          <span className={styles.barName}>{tp.label}</span>
                          <span className={styles.barValue}>
                            {tp.count} ({tp.share_pct.toFixed(1)}%)
                          </span>
                        </div>
                        <div className={styles.barTrack}>
                          <div
                            className={styles.barFillGold}
                            style={{ width: `${tp.share_pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Order Cohort Records (Drill-Down to Orders)</h2>
                <span className={styles.windowSummaryText}>{ordersData.total} matching orders</span>
              </div>
              {ordersData.items.length === 0 ? (
                <div className={styles.emptyState}>No orders matched your filters.</div>
              ) : (
                <>
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Order #</th>
                          <th>Status</th>
                          <th>Type</th>
                          <th>Destination</th>
                          <th className={styles.numCol}>Total</th>
                          <th>Placed (Manila)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ordersData.items.map((ord) => (
                          <tr key={ord.id}>
                            <td>
                              <Link
                                href={`/manager/orders?search=${encodeURIComponent(ord.order_number)}`}
                                className={styles.orderLink}
                              >
                                #{ord.order_number}
                              </Link>
                            </td>
                            <td>
                              <span className={`${styles.badge} ${statusBadgeClass(ord.status)}`}>
                                {ord.status}
                              </span>
                            </td>
                            <td>{ord.order_type.replaceAll("_", " ")}</td>
                            <td>{ord.fulfillment_destination}</td>
                            <td className={styles.numCol}>{formatPhpCurrency(ord.total_amount)}</td>
                            <td>{formatDateManila(ord.ordered_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {ordersData.total > ordersData.page_size && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={ordersPage <= 1}
                        onClick={() => {
                          setLoading(true);
                          setOrdersPage((p) => p - 1);
                        }}
                      >
                        Previous
                      </button>
                      <span className={styles.windowSummaryText}>
                        Page {ordersData.page} of {Math.ceil(ordersData.total / ordersData.page_size)}
                      </span>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={ordersPage * ordersData.page_size >= ordersData.total}
                        onClick={() => {
                          setLoading(true);
                          setOrdersPage((p) => p + 1);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>
            <div className={styles.emptyState}>
              {loading ? "Loading orders report..." : "No orders data loaded."}
            </div>
          </div>
        )
      )}

      {/* ========================= MENU PERFORMANCE TAB ========================= */}
      {activeTab === "menu" && (
        menuData ? (
          <>
            <section className={styles.kpiGrid} aria-label="Menu performance summary">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Units Sold</span>
                <span className={styles.kpiValue}>
                  {menuData.total_units_sold.toLocaleString("en-PH")}
                </span>
                <span className={styles.kpiMeta}>Qualifying completed order quantities</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Recorded Item Sales Value</span>
                <span className={styles.kpiValue}>
                  {formatPhpCurrency(menuData.total_item_sales_value)}
                </span>
                <span className={styles.kpiMeta}>Sum of qualifying line totals</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Dishes Sold</span>
                <span className={styles.kpiValue}>{menuData.distinct_products_sold}</span>
                <span className={styles.kpiMeta}>Products with &gt;= 1 qualifying unit</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Categories Active in Sales</span>
                <span className={styles.kpiValue}>{menuData.category_summary.length}</span>
                <span className={styles.kpiMeta}>Soft-deleted history retained safely</span>
              </div>
            </section>

            <div className={styles.filterToolbar}>
              <div className={styles.searchField}>
                <label htmlFor="rep-menu-search" className={styles.filterLabel}>
                  Search Dish or Category
                </label>
                <input
                  id="rep-menu-search"
                  type="search"
                  className={styles.inputControl}
                  placeholder="Search menu item name..."
                  value={menuSearch}
                  onChange={(e) => {
                    setLoading(true);
                    setMenuPage(1);
                    setMenuSearch(e.target.value);
                  }}
                />
              </div>

              <div className={styles.filterField}>
                <label htmlFor="rep-menu-cat" className={styles.filterLabel}>
                  Category
                </label>
                <select
                  id="rep-menu-cat"
                  className={styles.selectControl}
                  value={menuCategoryId}
                  onChange={(e) => {
                    setLoading(true);
                    setMenuPage(1);
                    setMenuCategoryId(e.target.value);
                  }}
                >
                  <option value="all">All Categories</option>
                  {menuData.categories.map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.filterField}>
                <label htmlFor="rep-menu-sort" className={styles.filterLabel}>
                  Sort By
                </label>
                <select
                  id="rep-menu-sort"
                  className={styles.selectControl}
                  value={menuSortBy}
                  onChange={(e) => {
                    setLoading(true);
                    setMenuPage(1);
                    setMenuSortBy(e.target.value as MenuReportSortBy);
                  }}
                >
                  <option value="units_sold">Units Sold</option>
                  <option value="sales_value">Sales Value</option>
                  <option value="order_count">Order Count</option>
                  <option value="name">Dish Name</option>
                </select>
              </div>

              <div className={styles.filterField}>
                <label htmlFor="rep-menu-dir" className={styles.filterLabel}>
                  Direction
                </label>
                <select
                  id="rep-menu-dir"
                  className={styles.selectControl}
                  value={menuSortDir}
                  onChange={(e) => {
                    setLoading(true);
                    setMenuPage(1);
                    setMenuSortDir(e.target.value as SortDirection);
                  }}
                >
                  <option value="desc">Highest First</option>
                  <option value="asc">Lowest First</option>
                </select>
              </div>

              {(menuSearch || menuCategoryId !== "all" || menuSortBy !== "units_sold" || menuSortDir !== "desc") && (
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={() => {
                    setLoading(true);
                    setMenuPage(1);
                    setMenuSearch("");
                    setMenuCategoryId("all");
                    setMenuSortBy("units_sold");
                    setMenuSortDir("desc");
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div className={styles.twoColGrid}>
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Top-Selling Dishes</h2>
                    <p className={styles.cardSubtitle}>Ranked deterministically by units sold</p>
                  </div>
                </div>
                {menuData.top_selling_dishes.length === 0 ? (
                  <div className={styles.emptyState}>No dish sales recorded in this period.</div>
                ) : (
                  <div className={styles.barList}>
                    {(() => {
                      const topU = Math.max(1, ...menuData.top_selling_dishes.map((d) => d.units_sold));
                      return menuData.top_selling_dishes.map((d) => (
                        <div key={d.product_id} className={styles.barRow}>
                          <div className={styles.barRowTop}>
                            <span className={styles.barName}>{d.dish_name}</span>
                            <span className={styles.barValue}>
                              {d.units_sold} units · {formatPhpCurrency(d.sales_value)}
                            </span>
                          </div>
                          <div className={styles.barTrack}>
                            <div
                              className={styles.barFillGreen}
                              style={{ width: `${(d.units_sold / topU) * 100}%` }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </section>

              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Lowest-Selling Active Dishes</h2>
                    <p className={styles.cardSubtitle}>
                      Volume indicator only — evaluate recipe cost &amp; positioning before removing
                    </p>
                  </div>
                </div>
                {menuData.lowest_selling_active_dishes.length === 0 ? (
                  <div className={styles.emptyState}>No active catalog dishes found.</div>
                ) : (
                  <div className={styles.barList}>
                    {menuData.lowest_selling_active_dishes.map((d) => (
                      <div key={d.product_id} className={styles.barRowTop}>
                        <span className={styles.barName}>
                          {d.dish_name} ({d.category_name})
                        </span>
                        <span className={styles.barValue}>
                          {d.units_sold} units · {formatPhpCurrency(d.sales_value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Dish Performance Table</h2>
                <span className={styles.windowSummaryText}>{menuData.total} dishes</span>
              </div>
              {menuData.items.length === 0 ? (
                <div className={styles.emptyState}>No dishes matched your filter criteria.</div>
              ) : (
                <>
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Dish</th>
                          <th>Category</th>
                          <th>Catalog State</th>
                          <th className={styles.numCol}>Units Sold</th>
                          <th className={styles.numCol}>Order Count</th>
                          <th className={styles.numCol}>Sales Value</th>
                          <th className={styles.numCol}>Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {menuData.items.map((item) => (
                          <tr key={item.product_id}>
                            <td>{item.dish_name}</td>
                            <td>{item.category_name}</td>
                            <td>
                              <span
                                className={`${styles.badge} ${
                                  item.is_deleted
                                    ? styles.badgeNeutral
                                    : item.is_available
                                      ? styles.badgeCompleted
                                      : styles.badgePending
                                }`}
                              >
                                {item.is_deleted
                                  ? "Archived"
                                  : item.is_available
                                    ? "Available"
                                    : "Unavailable"}
                              </span>
                            </td>
                            <td className={styles.numCol}>{item.units_sold}</td>
                            <td className={styles.numCol}>{item.order_count}</td>
                            <td className={styles.numCol}>{formatPhpCurrency(item.sales_value)}</td>
                            <td className={styles.numCol}>{item.share_pct.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {menuData.total > menuData.page_size && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={menuPage <= 1}
                        onClick={() => {
                          setLoading(true);
                          setMenuPage((p) => p - 1);
                        }}
                      >
                        Previous
                      </button>
                      <span className={styles.windowSummaryText}>
                        Page {menuData.page} of {Math.ceil(menuData.total / menuData.page_size)}
                      </span>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={menuPage * menuData.page_size >= menuData.total}
                        onClick={() => {
                          setLoading(true);
                          setMenuPage((p) => p + 1);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>
            <div className={styles.emptyState}>
              {loading ? "Loading menu performance..." : "No menu report data loaded."}
            </div>
          </div>
        )
      )}

      {/* ========================= PAYMENTS TAB ========================= */}
      {activeTab === "payments" && (
        paymentsData ? (
          <>
            <div className={styles.disclosureBar}>
              <strong>Reconciliation Alignment:</strong> Totals reconcile directly with Manager Payments over <code>ordered_at</code>. Only completed orders represent settled collections; active orders remain pending settlement and cancelled orders are tracked separately as voided.
            </div>

            <section className={styles.kpiGrid} aria-label="Payments reconciliation summary">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Settled Collections</span>
                <span className={styles.kpiValue}>
                  {formatPhpCurrency(paymentsData.settled_revenue)}
                </span>
                <span className={styles.kpiMeta}>{paymentsData.settled_count} settled orders</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Pending Settlement</span>
                <span className={styles.kpiValue}>
                  {formatPhpCurrency(paymentsData.pending_revenue)}
                </span>
                <span className={styles.kpiMeta}>{paymentsData.pending_count} active orders</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Voided Orders</span>
                <span className={styles.kpiValue}>
                  {formatPhpCurrency(paymentsData.voided_revenue)}
                </span>
                <span className={styles.kpiMeta}>{paymentsData.voided_count} cancelled orders</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Collection Rate</span>
                <span className={styles.kpiValue}>
                  {paymentsData.collection_rate_pct.toFixed(1)}%
                </span>
                <span className={styles.kpiMeta}>Settled share of non-voided value</span>
              </div>
            </section>

            <div className={styles.filterToolbar}>
              <div className={styles.filterField}>
                <label htmlFor="rep-pay-settlement" className={styles.filterLabel}>
                  Settlement State
                </label>
                <select
                  id="rep-pay-settlement"
                  className={styles.selectControl}
                  value={paymentsSettlement}
                  onChange={(e) => {
                    setLoading(true);
                    setPaymentsPage(1);
                    setPaymentsSettlement(e.target.value as "all" | PaymentSettlementState);
                  }}
                >
                  <option value="all">All States</option>
                  <option value="settled">Settled</option>
                  <option value="pending">Pending</option>
                  <option value="voided">Voided</option>
                </select>
              </div>

              <div className={styles.filterField}>
                <label htmlFor="rep-pay-method" className={styles.filterLabel}>
                  Payment Method
                </label>
                <select
                  id="rep-pay-method"
                  className={styles.selectControl}
                  value={paymentsMethod}
                  onChange={(e) => {
                    setLoading(true);
                    setPaymentsPage(1);
                    setPaymentsMethod(e.target.value);
                  }}
                >
                  <option value="all">All Methods</option>
                  {paymentsData.method_breakdown.map((m) => (
                    <option key={m.method_code} value={m.method_code}>
                      {m.method_label}
                    </option>
                  ))}
                </select>
              </div>

              {(paymentsSettlement !== "all" || paymentsMethod !== "all") && (
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={() => {
                    setLoading(true);
                    setPaymentsPage(1);
                    setPaymentsSettlement("all");
                    setPaymentsMethod("all");
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Payment Method Breakdown</h2>
              </div>
              {paymentsData.method_breakdown.length === 0 ? (
                <div className={styles.emptyState}>No payment records in this period.</div>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Payment Method</th>
                        <th className={styles.numCol}>Settled</th>
                        <th className={styles.numCol}>Pending</th>
                        <th className={styles.numCol}>Voided</th>
                        <th className={styles.numCol}>Collected Amount</th>
                        <th className={styles.numCol}>Pending Amount</th>
                        <th className={styles.numCol}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentsData.method_breakdown.map((pm) => (
                        <tr key={pm.method_code}>
                          <td>{pm.method_label}</td>
                          <td className={styles.numCol}>{pm.settled_count}</td>
                          <td className={styles.numCol}>{pm.pending_count}</td>
                          <td className={styles.numCol}>{pm.voided_count}</td>
                          <td className={styles.numCol}>
                            <strong>{formatPhpCurrency(pm.settled_revenue)}</strong>
                          </td>
                          <td className={styles.numCol}>{formatPhpCurrency(pm.pending_revenue)}</td>
                          <td className={styles.numCol}>{pm.share_pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Transaction Reconciliation Ledger</h2>
                <span className={styles.windowSummaryText}>{paymentsData.total} records</span>
              </div>
              {paymentsData.items.length === 0 ? (
                <div className={styles.emptyState}>No transactions matched your filters.</div>
              ) : (
                <>
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Order #</th>
                          <th>Method</th>
                          <th>Settlement</th>
                          <th>Order Status</th>
                          <th className={styles.numCol}>Subtotal</th>
                          <th className={styles.numCol}>Discount</th>
                          <th className={styles.numCol}>Tax</th>
                          <th className={styles.numCol}>Total</th>
                          <th>Placed (Manila)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentsData.items.map((row) => (
                          <tr key={row.order_id}>
                            <td>
                              <Link
                                href={`/manager/orders?search=${encodeURIComponent(row.order_number)}`}
                                className={styles.orderLink}
                              >
                                #{row.order_number}
                              </Link>
                            </td>
                            <td>{row.method_label}</td>
                            <td>
                              <span className={`${styles.badge} ${statusBadgeClass(row.settlement_state)}`}>
                                {row.settlement_state}
                              </span>
                            </td>
                            <td>{row.order_status}</td>
                            <td className={styles.numCol}>{formatPhpCurrency(row.subtotal)}</td>
                            <td className={styles.numCol}>{formatPhpCurrency(row.discount_amount)}</td>
                            <td className={styles.numCol}>{formatPhpCurrency(row.tax_amount)}</td>
                            <td className={styles.numCol}>{formatPhpCurrency(row.total_amount)}</td>
                            <td>{formatDateManila(row.ordered_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {paymentsData.total > paymentsData.page_size && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={paymentsPage <= 1}
                        onClick={() => {
                          setLoading(true);
                          setPaymentsPage((p) => p - 1);
                        }}
                      >
                        Previous
                      </button>
                      <span className={styles.windowSummaryText}>
                        Page {paymentsData.page} of{" "}
                        {Math.ceil(paymentsData.total / paymentsData.page_size)}
                      </span>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={paymentsPage * paymentsData.page_size >= paymentsData.total}
                        onClick={() => {
                          setLoading(true);
                          setPaymentsPage((p) => p + 1);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>
            <div className={styles.emptyState}>
              {loading ? "Loading payments report..." : "No payment data loaded."}
            </div>
          </div>
        )
      )}

      {/* ========================= INVENTORY TAB ========================= */}
      {activeTab === "inventory" && (
        inventoryData ? (
          <>
            <div className={styles.noticeWarn}>
              <strong>Scope Disclosure:</strong> {inventoryData.profitability_note}
            </div>

            <section className={styles.kpiGrid} aria-label="Inventory health summary">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Active Ingredients</span>
                <span className={styles.kpiValue}>{inventoryData.active_items_count}</span>
                <span className={styles.kpiMeta}>Tracked with native measurement units</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Healthy Stock</span>
                <span className={styles.kpiValue}>{inventoryData.normal_stock_count}</span>
                <span className={styles.kpiMeta}>Above reorder threshold</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Low / Out of Stock</span>
                <span className={styles.kpiValue}>
                  {inventoryData.low_stock_count + inventoryData.out_of_stock_count}
                </span>
                <span className={styles.kpiMeta}>
                  {inventoryData.low_stock_count} low · {inventoryData.out_of_stock_count} out of stock
                </span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Period Movements</span>
                <span className={styles.kpiValue}>{inventoryData.total_movements_count}</span>
                <span className={styles.kpiMeta}>Recorded ledger transactions</span>
              </div>
            </section>

            <div className={styles.filterToolbar}>
              <div className={styles.searchField}>
                <label htmlFor="rep-inv-search" className={styles.filterLabel}>
                  Search Ingredient or Note
                </label>
                <input
                  id="rep-inv-search"
                  type="search"
                  className={styles.inputControl}
                  placeholder="Filter ingredient name or note..."
                  value={inventorySearch}
                  onChange={(e) => {
                    setLoading(true);
                    setInventoryPage(1);
                    setInventorySearch(e.target.value);
                  }}
                />
              </div>

              <div className={styles.filterField}>
                <label htmlFor="rep-inv-tx" className={styles.filterLabel}>
                  Transaction Type
                </label>
                <select
                  id="rep-inv-tx"
                  className={styles.selectControl}
                  value={inventoryTxType}
                  onChange={(e) => {
                    setLoading(true);
                    setInventoryPage(1);
                    setInventoryTxType(e.target.value);
                  }}
                >
                  <option value="all">All Types</option>
                  <option value="sale">Sale Deduction</option>
                  <option value="purchase">Restock Purchase</option>
                  <option value="waste">Waste</option>
                  <option value="return">Order Cancel Return</option>
                  <option value="adjustment">Adjustment</option>
                </select>
              </div>

              {(inventorySearch || inventoryTxType !== "all") && (
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={() => {
                    setLoading(true);
                    setInventoryPage(1);
                    setInventorySearch("");
                    setInventoryTxType("all");
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            {inventoryData.top_consumed_items.length > 0 && (
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Top Consumed Ingredients</h2>
                    <p className={styles.cardSubtitle}>Displayed per ingredient&apos;s native unit</p>
                  </div>
                </div>
                <div className={styles.barList}>
                  {inventoryData.top_consumed_items.map((item) => (
                    <div key={item.inventory_item_id} className={styles.barRowTop}>
                      <span className={styles.barName}>{item.name}</span>
                      <span className={styles.barValue}>
                        Consumed: {item.consumed_qty} {item.unit} (On hand: {item.current_stock} {item.unit})
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Stock Levels &amp; Period Movement Summary</h2>
              </div>
              {inventoryData.item_summaries.length === 0 ? (
                <div className={styles.emptyState}>No active ingredients matched your filter.</div>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Ingredient</th>
                        <th>Status</th>
                        <th>Unit</th>
                        <th className={styles.numCol}>On Hand</th>
                        <th className={styles.numCol}>Reorder</th>
                        <th className={styles.numCol}>Consumed</th>
                        <th className={styles.numCol}>Restocked</th>
                        <th className={styles.numCol}>Waste</th>
                        <th className={styles.numCol}>Returned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryData.item_summaries.map((item) => (
                        <tr key={item.inventory_item_id}>
                          <td>{item.name}</td>
                          <td>
                            <span className={`${styles.badge} ${statusBadgeClass(item.stock_status)}`}>
                              {item.stock_status.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td>{item.unit}</td>
                          <td className={styles.numCol}>{item.current_stock}</td>
                          <td className={styles.numCol}>{item.reorder_level}</td>
                          <td className={styles.numCol}>{item.consumed_qty}</td>
                          <td className={styles.numCol}>{item.restocked_qty}</td>
                          <td className={styles.numCol}>{item.waste_qty}</td>
                          <td className={styles.numCol}>{item.returned_qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <h2 className={styles.cardTitle}>Inventory Transaction Ledger</h2>
                <span className={styles.windowSummaryText}>{inventoryData.total} transactions</span>
              </div>
              {inventoryData.ledger_items.length === 0 ? (
                <div className={styles.emptyState}>No inventory movements recorded in this window.</div>
              ) : (
                <>
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Timestamp (Manila)</th>
                          <th>Ingredient</th>
                          <th>Type</th>
                          <th className={styles.numCol}>Qty Change</th>
                          <th>Reference</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventoryData.ledger_items.map((tx) => (
                          <tr key={tx.id}>
                            <td>{formatDateManila(tx.created_at)}</td>
                            <td>{tx.item_name}</td>
                            <td>{tx.transaction_type}</td>
                            <td className={styles.numCol}>
                              {tx.quantity_change > 0 ? `+${tx.quantity_change}` : tx.quantity_change}{" "}
                              {tx.unit}
                            </td>
                            <td>
                              {tx.reference_type
                                ? `${tx.reference_type}${tx.reference_id ? ` #${tx.reference_id}` : ""}`
                                : "—"}
                            </td>
                            <td>{tx.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {inventoryData.total > inventoryData.page_size && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={inventoryPage <= 1}
                        onClick={() => {
                          setLoading(true);
                          setInventoryPage((p) => p - 1);
                        }}
                      >
                        Previous
                      </button>
                      <span className={styles.windowSummaryText}>
                        Page {inventoryData.page} of{" "}
                        {Math.ceil(inventoryData.total / inventoryData.page_size)}
                      </span>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={inventoryPage * inventoryData.page_size >= inventoryData.total}
                        onClick={() => {
                          setLoading(true);
                          setInventoryPage((p) => p + 1);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>
            <div className={styles.emptyState}>
              {loading ? "Loading inventory report..." : "No inventory data loaded."}
            </div>
          </div>
        )
      )}
    </div>
  );
}
