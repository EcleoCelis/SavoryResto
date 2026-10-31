"use client";

import { useEffect, useState } from "react";
import { getManagerOrders, StaffApiError, updateKdsStatus } from "../../lib/api/staff";
import { ClipboardListIcon, RefreshIcon } from "../../components/ui/Icons";
import type { KdsOrder } from "../../types/staff";
import styles from "./manager.module.css";

const statusConfig: Record<
  KdsOrder["status"],
  { label: string; className: string; nextStatus: KdsOrder["status"] | null; nextAction: string }
> = {
  pending: {
    label: "Pending",
    className: styles.statusPending,
    nextStatus: "confirmed",
    nextAction: "Confirm Order",
  },
  confirmed: {
    label: "Confirmed",
    className: styles.statusConfirmed,
    nextStatus: "preparing",
    nextAction: "Start Preparing",
  },
  preparing: {
    label: "In Preparation",
    className: styles.statusPreparing,
    nextStatus: "ready",
    nextAction: "Mark Ready",
  },
  ready: {
    label: "Ready to Fulfill",
    className: styles.statusReady,
    nextStatus: "completed",
    nextAction: "Complete Order",
  },
  completed: {
    label: "Completed",
    className: styles.statusCompleted,
    nextStatus: null,
    nextAction: "",
  },
  cancelled: {
    label: "Cancelled",
    className: styles.statusCompleted,
    nextStatus: null,
    nextAction: "",
  },
};

export default function ManagerDashboardPage() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    setError("");
    setActionError("");
    try {
      const activeOrders = await getManagerOrders();
      setOrders(activeOrders);
    } catch (err) {
      if (err instanceof StaffApiError && (err.status === 401 || err.status === 403)) {
        // Handled by layout
        return;
      }
      setError(err instanceof Error ? err.message : "Unable to load live restaurant orders.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function initialFetch() {
      try {
        const activeOrders = await getManagerOrders();
        if (active) setOrders(activeOrders);
      } catch (err) {
        if (!active) return;
        if (!(err instanceof StaffApiError && (err.status === 401 || err.status === 403))) {
          setError(err instanceof Error ? err.message : "Unable to load live restaurant orders.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialFetch();

    // Auto-refresh order queue every 15 seconds
    const timer = window.setInterval(() => {
      void getManagerOrders()
        .then((refreshed) => {
          if (active) setOrders(refreshed);
        })
        .catch(() => undefined);
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function handleAdvanceOrder(order: KdsOrder) {
    const config = statusConfig[order.status];
    if (!config?.nextStatus) return;

    setUpdatingId(order.id);
    setActionError("");

    try {
      const updated = await updateKdsStatus(order.id, config.nextStatus);
      if (config.nextStatus === "completed") {
        setOrders((prev) => prev.filter((o) => o.id !== updated.id));
      } else {
        setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to advance order status.");
    } finally {
      setUpdatingId(null);
    }
  }

  const preparingCount = orders.filter(
    (o) => o.status === "preparing" || o.status === "confirmed"
  ).length;
  const readyCount = orders.filter((o) => o.status === "ready").length;

  return (
    <div className={styles.pageContainer}>
      {/* Dashboard Header */}
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <h1 className={styles.pageTitle}>Dashboard</h1>
          <p className={styles.pageSubtitle}>
            Real-time restaurant operational overview, live order tracking, and kitchen fulfillment.
          </p>
        </div>
        <div className={styles.pageHeaderRight}>
          <button
            type="button"
            className={styles.btnRefresh}
            onClick={() => void loadData(false)}
            disabled={loading}
            aria-label="Refresh live orders"
          >
            <RefreshIcon size={14} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Error Notices */}
      {error && (
        <div className={`${styles.alertBox} ${styles.alertError}`} role="alert">
          {error}
        </div>
      )}
      {actionError && (
        <div className={`${styles.alertBox} ${styles.alertError}`} role="alert">
          {actionError}
        </div>
      )}

      {/* Real-Time Operational Metrics */}
      <section className={styles.metricsGrid} aria-label="Live Operational Metrics">
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Active Orders</span>
          <strong className={styles.metricValue}>{orders.length}</strong>
          <span className={styles.metricHint}>Tickets in live fulfillment</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>In Preparation</span>
          <strong className={`${styles.metricValue} ${styles.metricValuePreparing}`}>
            {preparingCount}
          </strong>
          <span className={styles.metricHint}>Kitchen stations active</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Ready to Fulfill</span>
          <strong className={`${styles.metricValue} ${styles.metricValueReady}`}>
            {readyCount}
          </strong>
          <span className={styles.metricHint}>Awaiting runner / pickup</span>
        </article>
      </section>

      {/* Live Fulfillment Queue */}
      <section className={styles.queueCard} aria-label="Order Queue Section">
        <header className={styles.queueHeader}>
          <div className={styles.queueTitleGroup}>
            <h2 className={styles.queueTitle}>Live Fulfillment Queue</h2>
            <span className={styles.queueSubtitle}>Real-time order ticket monitoring</span>
          </div>
          <div className={styles.pulseBadge} aria-live="polite">
            <span className={styles.pulseDot} aria-hidden="true" />
            <span>Auto-refreshes (15s)</span>
          </div>
        </header>

        {loading ? (
          <div className={styles.emptyState} aria-live="polite">
            <p className={styles.emptyStateTitle}>Loading active orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className={styles.emptyState}>
            <ClipboardListIcon size={36} className="text-stone-400" />
            <p className={styles.emptyStateTitle}>No active tickets in queue</p>
            <p className={styles.emptyStateDesc}>
              Incoming customer orders from dine-in tables and counter pickup will appear here
              automatically.
            </p>
          </div>
        ) : (
          <div className={styles.ordersList} role="list" aria-label="Active order tickets">
            {orders.map((order) => {
              const conf = statusConfig[order.status];
              const isUpdating = updatingId === order.id;

              return (
                <article key={order.id} className={styles.orderRow} role="listitem">
                  <div className={styles.orderIdentifier}>
                    <span className={styles.orderNumber}>{order.order_number}</span>
                    <span className={styles.orderMeta}>
                      {order.fulfillment_destination} · {order.order_type.replace("_", " ")}
                    </span>
                  </div>

                  <div>
                    <span className={`${styles.statusPill} ${conf.className}`}>{conf.label}</span>
                  </div>

                  <ul className={styles.orderItems} aria-label="Ticket items">
                    {order.items.map((item, idx) => (
                      <li key={`${item.name}-${idx}`} className={styles.orderItem}>
                        <strong>{item.quantity}x</strong> {item.name}
                      </li>
                    ))}
                  </ul>

                  <div className={styles.orderActions}>
                    {conf.nextStatus ? (
                      <button
                        type="button"
                        className={`${styles.btnAdvance} ${
                          conf.nextStatus === "completed"
                            ? styles.btnAdvanceComplete
                            : styles.btnAdvanceDefault
                        }`}
                        onClick={() => void handleAdvanceOrder(order)}
                        disabled={isUpdating}
                        aria-label={`${conf.nextAction} for ${order.order_number}`}
                      >
                        {isUpdating ? "Updating..." : conf.nextAction}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
