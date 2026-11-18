"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { RefreshIcon } from "../../../components/ui/Icons";
import {
  getManagerOrderDetail,
  getManagerOrdersDirectory,
  StaffApiError,
  updateManagerOrderStatus,
} from "../../../lib/api/staff";
import type {
  ManagerFulfillmentFilter,
  ManagerOrderDetail,
  ManagerOrderListResponse,
  ManagerOrderStatusFilter,
  OrderStatusCode,
} from "../../../types/staff";
import styles from "./orders.module.css";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const STATUS_LABELS: Record<OrderStatusCode, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_TABS: Array<{ key: ManagerOrderStatusFilter; label: string }> = [
  { key: "all", label: "All Orders" },
  { key: "active", label: "Active Queue" },
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

function getStatusBadgeClass(status: OrderStatusCode): string {
  switch (status) {
    case "pending":
      return styles.statusPending;
    case "confirmed":
      return styles.statusConfirmed;
    case "preparing":
      return styles.statusPreparing;
    case "ready":
      return styles.statusReady;
    case "completed":
      return styles.statusCompleted;
    case "cancelled":
      return styles.statusCancelled;
  }
}

function formatManilaDateTime(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatOrderTypeLabel(orderType: string, fulfillmentType: string | null): string {
  const mode = orderType === "dine_in" ? "Dine-In" : "Takeout";
  if (fulfillmentType === "table_service") return `${mode} · Table Service`;
  if (fulfillmentType === "counter_pickup") return `${mode} · Counter Pickup`;
  return mode;
}

type ConfirmActionState =
  | {
      type: "completed" | "cancelled";
      orderId: number;
      orderNumber: string;
      status: OrderStatusCode;
      totalAmount: number;
      expectedUpdatedAt: string;
    }
  | null;

function formatSettlementLabel(status: OrderStatusCode): string {
  if (status === "completed") return "Settled";
  if (status === "cancelled") return "Voided";
  return "Pending settlement";
}

const VALID_ORDER_STATUS_FILTERS = new Set<ManagerOrderStatusFilter>([
  "all",
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

function ManagerOrdersWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = (searchParams.get("search") || "").trim();
  const rawStatusParam = (searchParams.get("status") || "").trim().toLowerCase() as ManagerOrderStatusFilter;
  const initialStatus: ManagerOrderStatusFilter = VALID_ORDER_STATUS_FILTERS.has(rawStatusParam)
    ? rawStatusParam
    : "all";
  const [directory, setDirectory] = useState<ManagerOrderListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ManagerOrderDetail | null>(null);

  const [searchInput, setSearchInput] = useState(initialSearch);
  const [activeSearch, setActiveSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<ManagerOrderStatusFilter>(initialStatus);
  const [fulfillmentFilter, setFulfillmentFilter] = useState<ManagerFulfillmentFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [confirmAction, setConfirmAction] = useState<ConfirmActionState>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [mutating, setMutating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadDirectory = useCallback(
    async (signal?: AbortSignal) => {
      return getManagerOrdersDirectory(
        {
          search: activeSearch,
          status: statusFilter,
          fulfillment_type: fulfillmentFilter,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          page,
          page_size: 15,
        },
        signal
      );
    },
    [activeSearch, dateFrom, dateTo, fulfillmentFilter, page, statusFilter]
  );

  useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return;
    }
    const controller = new AbortController();
    void loadDirectory(controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setDirectory(res);
        setSelectedId((prev) => {
          if (prev !== null && res.items.some((item) => item.id === prev)) {
            return prev;
          }
          return res.items[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof StaffApiError && err.status === 401) {
          router.replace("/staff/login");
          return;
        }
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Unable to load restaurant orders.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingList(false);
          setRefreshing(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [dateFrom, dateTo, loadDirectory, refreshNonce, router]);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    const controller = new AbortController();
    void getManagerOrderDetail(selectedId, controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setDetail(loaded);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof StaffApiError && err.status === 401) {
          router.replace("/staff/login");
          return;
        }
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Unable to load order receipt details.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingDetail(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [refreshNonce, router, selectedId]);

  const activeDetail = selectedId !== null && detail?.id === selectedId ? detail : null;

  function handleSelectOrder(orderId: number) {
    if (orderId !== selectedId) {
      setLoadingDetail(true);
      setSelectedId(orderId);
    }
  }

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setLoadingList(true);
    setPage(1);
    setActiveSearch(searchInput.trim());
  }

  function handleResetFilters() {
    setLoadingList(true);
    setSearchInput("");
    setActiveSearch("");
    setStatusFilter("all");
    setFulfillmentFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setFeedback(null);
    if (searchParams.toString()) {
      router.replace("/manager/orders", { scroll: false });
    }
  }

  // Visibility-aware near-real-time synchronization (30s) when idle & visible
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !mutating &&
        confirmAction === null &&
        !(dateFrom && dateTo && dateFrom > dateTo)
      ) {
        setRefreshNonce((prev) => prev + 1);
      }
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [confirmAction, dateFrom, dateTo, mutating]);

  // Escape key closes confirmation modal cleanly when not submitting
  useEffect(() => {
    if (!confirmAction) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !mutating) {
        setConfirmAction(null);
        setCancellationReason("");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmAction, mutating]);

  function handleManualRefresh() {
    setRefreshing(true);
    setRefreshNonce((prev) => prev + 1);
  }

  function handleDateRangeChange(nextFrom: string, nextTo: string) {
    setDateFrom(nextFrom);
    setDateTo(nextTo);
    setPage(1);
    if (nextFrom && nextTo && nextFrom > nextTo) {
      setFeedback({
        type: "error",
        text: "Start date cannot be later than end date.",
      });
      return;
    }
    setFeedback(null);
    setLoadingList(true);
  }

  async function handleConfirmStatusMutation() {
    if (!confirmAction) return;
    setMutating(true);
    setFeedback(null);
    try {
      await updateManagerOrderStatus(
        confirmAction.orderId,
        confirmAction.type,
        confirmAction.type === "cancelled" ? cancellationReason : undefined,
        confirmAction.expectedUpdatedAt
      );
      const updatedNumber = confirmAction.orderNumber;
      const targetType = confirmAction.type;
      setConfirmAction(null);
      setCancellationReason("");
      setRefreshNonce((prev) => prev + 1);
      setFeedback({
        type: "success",
        text:
          targetType === "completed"
            ? `Order ${updatedNumber} has been marked Completed.`
            : `Order ${updatedNumber} has been Cancelled.`,
      });
    } catch (err) {
      if (err instanceof StaffApiError && err.status === 409) {
        setConfirmAction(null);
        setCancellationReason("");
        setRefreshNonce((prev) => prev + 1);
      }
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update order status.",
      });
    } finally {
      setMutating(false);
    }
  }

  const hasActiveFilters =
    Boolean(activeSearch) ||
    statusFilter !== "all" ||
    fulfillmentFilter !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.title}>Orders Management</h1>
          <p className={styles.subtitle}>
            Monitor live kitchen queues, inspect receipts, and finalize orders ready for pickup or table completion.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            <RefreshIcon size={15} className={refreshing ? styles.spinningIcon : undefined} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </header>

      {feedback && (
        <div
          className={feedback.type === "error" ? styles.bannerError : styles.bannerSuccess}
          role="status"
        >
          {feedback.text}
        </div>
      )}

      <div className={styles.statusTabsRow} role="tablist" aria-label="Filter orders by status">
        {STATUS_TABS.map((tab) => {
          const count = directory?.status_counts ? directory.status_counts[tab.key] : null;
          const isActive = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${styles.statusTab} ${isActive ? styles.statusTabActive : ""}`}
              onClick={() => {
                if (!(dateFrom && dateTo && dateFrom > dateTo)) {
                  setLoadingList(true);
                }
                setPage(1);
                setStatusFilter(tab.key);
              }}
            >
              <span>{tab.label}</span>
              {count !== null && <span className={styles.tabCount}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.toolbar}>
        <form className={styles.searchForm} onSubmit={handleSearchSubmit}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search order #, customer name, or email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search orders by order number or customer"
          />
          <button type="submit" className={styles.searchButton}>
            Search
          </button>
        </form>

        <div className={styles.filterField}>
          <label htmlFor="orders-fulfillment-filter" className={styles.filterLabel}>
            Fulfillment
          </label>
          <select
            id="orders-fulfillment-filter"
            className={styles.selectInput}
            value={fulfillmentFilter}
            onChange={(e) => {
              setLoadingList(true);
              setPage(1);
              setFulfillmentFilter(e.target.value as ManagerFulfillmentFilter);
            }}
          >
            <option value="all">All Channels</option>
            <option value="table_service">Table Service</option>
            <option value="counter_pickup">Counter Pickup</option>
          </select>
        </div>

        <div className={styles.filterField}>
          <label htmlFor="orders-date-from" className={styles.filterLabel}>
            From (Manila)
          </label>
          <input
            id="orders-date-from"
            type="date"
            className={styles.dateInput}
            value={dateFrom}
            onChange={(e) => handleDateRangeChange(e.target.value, dateTo)}
          />
        </div>

        <div className={styles.filterField}>
          <label htmlFor="orders-date-to" className={styles.filterLabel}>
            To (Manila)
          </label>
          <input
            id="orders-date-to"
            type="date"
            className={styles.dateInput}
            value={dateTo}
            onChange={(e) => handleDateRangeChange(dateFrom, e.target.value)}
          />
        </div>

        {hasActiveFilters && (
          <button type="button" className={styles.clearBtn} onClick={handleResetFilters}>
            Clear Filters
          </button>
        )}
      </div>

      <div className={styles.splitGrid}>
        <section className={styles.tableCard} aria-label="Orders directory table">
          {loadingList ? (
            <div className={styles.emptyPanel}>Loading restaurant orders...</div>
          ) : !directory || directory.items.length === 0 ? (
            <div className={styles.emptyPanel}>
              No orders matched your current filters.
            </div>
          ) : (
            <>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer &amp; Channel</th>
                      <th>Status</th>
                      <th className={styles.numericCol}>Items</th>
                      <th className={styles.numericCol}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directory.items.map((row) => {
                      const isSelected = selectedId === row.id;
                      return (
                        <tr
                          key={row.id}
                          tabIndex={0}
                          aria-selected={isSelected}
                          className={`${styles.orderRow} ${isSelected ? styles.orderRowSelected : ""}`}
                          onClick={() => handleSelectOrder(row.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectOrder(row.id);
                            }
                          }}
                        >
                          <td>
                            <span className={styles.orderNumberCell}>{row.order_number}</span>
                            <span className={styles.secondaryCell}>
                              {formatManilaDateTime(row.ordered_at)}
                            </span>
                            {row.allergy_alert && (
                              <span className={styles.allergyTag}>Allergy Alert</span>
                            )}
                          </td>
                          <td>
                            <span className={styles.primaryCell}>{row.customer_name}</span>
                            <span className={styles.secondaryCell}>
                              {row.fulfillment_destination} · {row.order_type === "dine_in" ? "Dine-In" : "Takeout"}
                            </span>
                          </td>
                          <td>
                            <span className={`${styles.statusBadge} ${getStatusBadgeClass(row.status)}`}>
                              <span className={styles.statusDot} aria-hidden="true" />
                              <span>{STATUS_LABELS[row.status]}</span>
                            </span>
                          </td>
                          <td className={styles.numericCol}>{row.item_count}</td>
                          <td className={styles.numericCol}>
                            <span className={styles.primaryCell}>
                              {currencyFormatter.format(row.total_amount)}
                            </span>
                            {row.payment_method_label && (
                              <span className={styles.secondaryCell}>
                                {row.payment_method_label}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {directory.total > directory.page_size && (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={page <= 1}
                    onClick={() => {
                      setLoadingList(true);
                      setPage((p) => p - 1);
                    }}
                  >
                    Previous
                  </button>
                  <span className={styles.secondaryCell}>
                    Page {directory.page} of {Math.ceil(directory.total / directory.page_size)} ({directory.total} total)
                  </span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={page * directory.page_size >= directory.total}
                    onClick={() => {
                      setLoadingList(true);
                      setPage((p) => p + 1);
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <aside className={styles.detailCard} aria-label="Order receipt and actions panel">
          {loadingDetail ? (
            <div className={styles.emptyPanel}>Loading order details...</div>
          ) : !activeDetail ? (
            <div className={styles.emptyPanel}>
              Select an order row to inspect line items, customer info, and fulfillment actions.
            </div>
          ) : (
            <div className={styles.detailBody}>
              <div className={styles.detailHeader}>
                <div>
                  <h2 className={styles.detailTitle}>{activeDetail.order_number}</h2>
                  <span className={styles.secondaryCell}>
                    {formatOrderTypeLabel(activeDetail.order_type, activeDetail.fulfillment_type)}
                  </span>
                </div>
                <span className={`${styles.statusBadge} ${getStatusBadgeClass(activeDetail.status)}`}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  <span>{STATUS_LABELS[activeDetail.status]}</span>
                </span>
              </div>

              <div className={styles.detailMetaGrid}>
                <div className={styles.metaTile}>
                  <span className={styles.metaLabel}>Customer</span>
                  <span className={styles.metaValue}>{activeDetail.customer_name}</span>
                  {(activeDetail.customer_email || activeDetail.customer_phone) && (
                    <span className={styles.secondaryCell}>
                      {activeDetail.customer_phone || activeDetail.customer_email}
                    </span>
                  )}
                </div>
                <div className={styles.metaTile}>
                  <span className={styles.metaLabel}>Destination &amp; Payment</span>
                  <span className={styles.metaValue}>{activeDetail.fulfillment_destination}</span>
                  <span className={styles.secondaryCell}>
                    {activeDetail.payment_method_label || "Unrecorded method"} · {formatSettlementLabel(activeDetail.status)}
                  </span>
                </div>
                <div className={styles.metaTile}>
                  <span className={styles.metaLabel}>Ordered At (Manila)</span>
                  <span className={styles.metaValue}>
                    {formatManilaDateTime(activeDetail.ordered_at)}
                  </span>
                </div>
                <div className={styles.metaTile}>
                  <span className={styles.metaLabel}>
                    {activeDetail.cancelled_at
                      ? "Cancelled At"
                      : activeDetail.completed_at
                        ? "Completed At"
                        : "Last Updated"}
                  </span>
                  <span className={styles.metaValue}>
                    {formatManilaDateTime(
                      activeDetail.cancelled_at ||
                        activeDetail.completed_at ||
                        activeDetail.updated_at
                    )}
                  </span>
                </div>
              </div>

              {activeDetail.allergy_alert && (
                <div className={styles.calloutWarning}>
                  <strong>Kitchen Allergy Alert:</strong> {activeDetail.allergy_alert}
                </div>
              )}

              {activeDetail.notes && (
                <div className={styles.calloutInfo}>
                  <strong>Preparation Notes:</strong> {activeDetail.notes}
                </div>
              )}

              {activeDetail.cancellation_reason && (
                <div className={styles.calloutDanger}>
                  <strong>Cancellation Reason:</strong> {activeDetail.cancellation_reason}
                </div>
              )}

              <div>
                <h3 className={styles.sectionHeading}>
                  Order Items ({activeDetail.items.length})
                </h3>
                <div className={styles.itemList}>
                  {activeDetail.items.map((item) => (
                    <div key={item.id} className={styles.itemRow}>
                      <div className={styles.itemInfo}>
                        <div className={styles.itemName}>
                          {item.quantity}x {item.name}
                          {item.size ? ` (${item.size})` : ""}
                        </div>
                        <div className={styles.itemSub}>
                          Unit: {currencyFormatter.format(item.unit_price)}
                          {item.addons.length > 0 ? ` · Add-ons: ${item.addons.join(", ")}` : ""}
                        </div>
                        {item.special_instructions && (
                          <div className={styles.itemSub}>
                            Note: {item.special_instructions}
                          </div>
                        )}
                      </div>
                      <span className={styles.itemPrice}>
                        {currencyFormatter.format(item.line_total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.totalsBox}>
                <div className={styles.totalLine}>
                  <span>Subtotal</span>
                  <span>{currencyFormatter.format(activeDetail.subtotal)}</span>
                </div>
                {activeDetail.discount_amount > 0 && (
                  <div className={styles.totalLine}>
                    <span>Discounts</span>
                    <span>-{currencyFormatter.format(activeDetail.discount_amount)}</span>
                  </div>
                )}
                {activeDetail.tax_amount > 0 && (
                  <div className={styles.totalLine}>
                    <span>Tax</span>
                    <span>{currencyFormatter.format(activeDetail.tax_amount)}</span>
                  </div>
                )}
                <div className={styles.grandTotalLine}>
                  <span>Total Amount</span>
                  <span>{currencyFormatter.format(activeDetail.total_amount)}</span>
                </div>
              </div>

              <div className={styles.actionsBox}>
                {activeDetail.can_complete && (
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() =>
                      setConfirmAction({
                        type: "completed",
                        orderId: activeDetail.id,
                        orderNumber: activeDetail.order_number,
                        status: activeDetail.status,
                        totalAmount: activeDetail.total_amount,
                        expectedUpdatedAt: activeDetail.updated_at,
                      })
                    }
                  >
                    Mark Order Completed
                  </button>
                )}

                {activeDetail.can_cancel && (
                  <button
                    type="button"
                    className={styles.btnDanger}
                    onClick={() => {
                      setCancellationReason("");
                      setConfirmAction({
                        type: "cancelled",
                        orderId: activeDetail.id,
                        orderNumber: activeDetail.order_number,
                        status: activeDetail.status,
                        totalAmount: activeDetail.total_amount,
                        expectedUpdatedAt: activeDetail.updated_at,
                      });
                    }}
                  >
                    Cancel Order
                  </button>
                )}

                {!activeDetail.can_complete &&
                  activeDetail.status !== "completed" &&
                  activeDetail.status !== "cancelled" && (
                    <div className={styles.calloutInfo}>
                      Preparation steps (Confirm, Start Preparing, Mark Ready) are exclusively handled in Kitchen Display System (KDS). Once KDS marks this order Ready, you can finalize it here.
                    </div>
                  )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {confirmAction && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-action-modal-title"
        >
          <div className={styles.modalDialog}>
            <h2 id="order-action-modal-title" className={styles.modalTitle}>
              {confirmAction.type === "completed"
                ? `Complete Order ${confirmAction.orderNumber}?`
                : `Cancel Order ${confirmAction.orderNumber}?`}
            </h2>
            {confirmAction.type === "completed" ? (
              <p className={styles.modalText}>
                Confirm that the customer has received this Ready order ({currencyFormatter.format(confirmAction.totalAmount)}). Marking it Completed is terminal and will record this action in the audit log.
              </p>
            ) : (
              <>
                <p className={styles.modalText}>
                  Cancelling this {STATUS_LABELS[confirmAction.status].toLowerCase()} order is terminal.
                  {confirmAction.status === "confirmed"
                    ? " Deducted inventory quantities will be automatically restored."
                    : ""}
                </p>
                <div className={styles.filterField}>
                  <label htmlFor="manager-cancel-reason" className={styles.filterLabel}>
                    Cancellation Reason (Optional)
                  </label>
                  <textarea
                    id="manager-cancel-reason"
                    className={styles.modalTextarea}
                    placeholder="e.g., Customer requested cancellation at counter"
                    value={cancellationReason}
                    maxLength={500}
                    onChange={(e) => setCancellationReason(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                disabled={mutating}
                onClick={() => {
                  setConfirmAction(null);
                  setCancellationReason("");
                }}
              >
                Keep Order
              </button>
              <button
                type="button"
                disabled={mutating}
                className={`${styles.modalConfirmBtn} ${
                  confirmAction.type === "completed"
                    ? styles.modalConfirmComplete
                    : styles.modalConfirmDanger
                }`}
                onClick={handleConfirmStatusMutation}
              >
                {mutating
                  ? "Saving..."
                  : confirmAction.type === "completed"
                    ? "Confirm Completed"
                    : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ManagerOrdersPage() {
  return (
    <Suspense fallback={<div className={styles.emptyPanel}>Loading restaurant orders...</div>}>
      <ManagerOrdersWorkspace />
    </Suspense>
  );
}
