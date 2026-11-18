"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { RefreshIcon } from "../../../components/ui/Icons";
import {
  getManagerCustomerDetail,
  getManagerCustomers,
  StaffApiError,
  updateManagerCustomerStatus,
} from "../../../lib/api/staff";
import type {
  ManagerCustomerDetail,
  ManagerCustomerListResponse,
} from "../../../types/staff";
import styles from "./customerDirectory.module.css";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ManagerCustomerPage() {
  const router = useRouter();
  const [directory, setDirectory] = useState<ManagerCustomerListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ManagerCustomerDetail | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "deactivated">("all");
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statusReason, setStatusReason] = useState("");
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchDirectory = useCallback(
    async (signal?: AbortSignal) => {
      return getManagerCustomers(
        {
          search: activeQuery,
          status: statusFilter,
          page,
        },
        signal
      );
    },
    [activeQuery, page, statusFilter]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchDirectory(controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setDirectory(res);
        setSelectedId((prev) => {
          if (prev !== null && res.items.some((item) => item.customer_id === prev)) {
            return prev;
          }
          return res.items[0]?.customer_id ?? null;
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
          text: err instanceof Error ? err.message : "Unable to load customer directory.",
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
  }, [fetchDirectory, refreshNonce, router]);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    const controller = new AbortController();
    void getManagerCustomerDetail(selectedId, controller.signal)
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
          text: err instanceof Error ? err.message : "Unable to load customer profile.",
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

  useEffect(() => {
    if (!confirmDeactivateOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !updatingStatus) {
        setConfirmDeactivateOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeactivateOpen, updatingStatus]);

  const activeDetail =
    selectedId !== null && detail?.customer.customer_id === selectedId ? detail : null;

  function handleSelectCustomer(customerId: number) {
    if (customerId !== selectedId) {
      setLoadingDetail(true);
      setSelectedId(customerId);
    }
  }

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setLoadingList(true);
    setPage(1);
    setActiveQuery(searchInput.trim());
  }

  function handleResetFilters() {
    setLoadingList(true);
    setSearchInput("");
    setActiveQuery("");
    setStatusFilter("all");
    setPage(1);
    setFeedback(null);
  }

  function handleDeactivateClick() {
    if (!activeDetail) return;
    if (statusReason.trim().length < 3) {
      setFeedback({
        type: "error",
        text: "Please enter an audit reason (at least 3 characters) before deactivating this account.",
      });
      return;
    }
    setFeedback(null);
    setConfirmDeactivateOpen(true);
  }

  async function handleToggleAccountStatus(nextActive: boolean) {
    if (!activeDetail) return;
    setUpdatingStatus(true);
    setFeedback(null);
    try {
      const updated = await updateManagerCustomerStatus(
        activeDetail.customer.customer_id,
        nextActive,
        statusReason
      );
      setConfirmDeactivateOpen(false);
      setDetail(updated);
      setStatusReason("");
      const refreshed = await fetchDirectory();
      setDirectory(refreshed);
      setFeedback({
        type: "success",
        text: nextActive
          ? `${updated.customer.full_name}'s account has been reactivated.`
          : `${updated.customer.full_name}'s account has been deactivated (order history retained).`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to update customer status.",
      });
    } finally {
      setUpdatingStatus(false);
    }
  }

  const hasActiveFilters = Boolean(activeQuery) || statusFilter !== "all";

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <h1 className={styles.title}>Customer Directory</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.refreshBtn}
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              setRefreshNonce((prev) => prev + 1);
            }}
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

      <div className={styles.toolbar}>
        <form className={styles.searchForm} onSubmit={handleSearchSubmit}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by customer name, email, or phone..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search customers"
          />
          <button type="submit" className={styles.searchButton}>
            Search
          </button>
        </form>

        <div className={styles.filterGroup} role="group" aria-label="Filter by account status">
          {(["all", "active", "deactivated"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`${styles.filterTab} ${statusFilter === tab ? styles.filterTabActive : ""}`}
              onClick={() => {
                setLoadingList(true);
                setPage(1);
                setStatusFilter(tab);
              }}
            >
              {tab === "all" ? "All Accounts" : tab === "active" ? "Active" : "Deactivated"}
            </button>
          ))}
        </div>

        {hasActiveFilters && (
          <button type="button" className={styles.clearBtn} onClick={handleResetFilters}>
            Clear Filters
          </button>
        )}
      </div>

      <div className={styles.splitGrid}>
        <section className={styles.tableCard} aria-label="Customer directory table">
          {loadingList ? (
            <div className={styles.emptyPanel}>Loading customer accounts...</div>
          ) : !directory || directory.items.length === 0 ? (
            <div className={styles.emptyPanel}>No customer accounts matched your filters.</div>
          ) : (
            <>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th className={styles.numericCol}>Orders</th>
                      <th className={styles.numericCol}>Completed Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directory.items.map((row) => {
                      const isSelected = selectedId === row.customer_id;
                      return (
                        <tr
                          key={row.customer_id}
                          tabIndex={0}
                          aria-selected={isSelected}
                          className={`${styles.customerRow} ${isSelected ? styles.customerRowSelected : ""}`}
                          onClick={() => handleSelectCustomer(row.customer_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectCustomer(row.customer_id);
                            }
                          }}
                        >
                          <td>
                            <span className={styles.customerName}>{row.full_name}</span>
                            <span className={styles.customerSub}>
                              {row.email || "No email"} · {row.phone || "No phone"}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`${styles.statusBadge} ${
                                row.is_active ? styles.statusActive : styles.statusInactive
                              }`}
                            >
                              <span className={styles.statusDot} aria-hidden="true" />
                              <span>{row.is_active ? "Active" : "Inactive"}</span>
                            </span>
                          </td>
                          <td className={styles.numericCol}>{row.order_count}</td>
                          <td className={styles.numericCol}>{currencyFormatter.format(row.total_spent)}</td>
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
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span className={styles.customerSub}>
                    Page {directory.page} of {Math.ceil(directory.total / directory.page_size)} ({directory.total} total)
                  </span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={page * directory.page_size >= directory.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <aside className={styles.detailCard} aria-label="Customer detail panel">
          {loadingDetail ? (
            <div className={styles.emptyPanel}>Loading customer profile...</div>
          ) : !activeDetail ? (
            <div className={styles.emptyPanel}>Select a customer row to inspect details.</div>
          ) : (
            <div className={styles.detailBody}>
              <div className={styles.detailHeader}>
                <h2>{activeDetail.customer.full_name}</h2>
                <span className={styles.customerSub}>
                  {activeDetail.customer.email || "No email"} · {activeDetail.customer.phone || "No mobile"}
                </span>
              </div>

              <div className={styles.detailStats}>
                <div className={styles.statTile}>
                  <span className={styles.statLabel}>Orders Placed</span>
                  <span className={styles.statValue}>{activeDetail.customer.order_count}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statLabel}>Completed Spend</span>
                  <span className={styles.statValue}>
                    {currencyFormatter.format(activeDetail.customer.total_spent)}
                  </span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statLabel}>Joined</span>
                  <span className={styles.statValue}>{formatDate(activeDetail.customer.created_at)}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statLabel}>Saved Addresses</span>
                  <span className={styles.statValue}>{activeDetail.saved_addresses_count}</span>
                </div>
              </div>

              {activeDetail.operational_allergy_alert && (
                <div className={styles.allergyCallout} role="note">
                  <strong>Consented Kitchen Allergy Alert:</strong> {activeDetail.operational_allergy_alert}
                </div>
              )}

              <div className={styles.infoList}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Default Address</span>
                  <span className={styles.infoValue}>{activeDetail.default_address || "None on file"}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Marketing Emails</span>
                  <span className={styles.infoValue}>
                    {activeDetail.marketing_opt_in ? "Opted In" : "Not Opted In"}
                  </span>
                </div>
              </div>

              <h3 className={styles.ordersHeading}>Recent Orders</h3>
              {activeDetail.recent_orders.length === 0 ? (
                <p className={styles.customerSub}>No orders placed by this customer yet.</p>
              ) : (
                <div>
                  {activeDetail.recent_orders.map((order) => (
                    <div key={order.id} className={styles.orderMiniRow}>
                      <div>
                        <Link
                          href={`/manager/orders?search=${encodeURIComponent(order.order_number)}`}
                          className={styles.orderMiniLink}
                          title={`Inspect order ${order.order_number} in Orders Management`}
                        >
                          #{order.order_number}
                        </Link>{" "}
                        · {order.status}
                        <span className={styles.customerSub}>
                          {formatDate(order.ordered_at)} ·{" "}
                          {order.order_type === "dine_in"
                            ? `Dine-in ${order.table_number ?? ""}`
                            : "Takeout"}
                        </span>
                      </div>
                      <span className={styles.orderMiniTotal}>{currencyFormatter.format(order.total)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.statusControls}>
                <label htmlFor="customer-status-reason" className={styles.reasonLabel}>
                  Audit reason (optional)
                </label>
                <input
                  id="customer-status-reason"
                  type="text"
                  className={styles.reasonInput}
                  maxLength={500}
                  placeholder="e.g., Guest request, Reactivation verified"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                />
                {activeDetail.customer.is_active ? (
                  <button
                    type="button"
                    className={styles.btnDanger}
                    disabled={updatingStatus}
                    onClick={handleDeactivateClick}
                  >
                    {updatingStatus ? "Updating..." : "Deactivate Customer Account"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.btnActivate}
                    disabled={updatingStatus}
                    onClick={() => void handleToggleAccountStatus(true)}
                  >
                    {updatingStatus ? "Updating..." : "Reactivate Customer Account"}
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {confirmDeactivateOpen && activeDetail && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-deactivate-modal-title"
        >
          <div className={styles.modalDialog}>
            <h2 id="customer-deactivate-modal-title" className={styles.modalTitle}>
              Deactivate {activeDetail.customer.full_name}?
            </h2>
            <p className={styles.modalText}>
              Deactivating this account immediately invalidates active customer sessions and blocks sign-in while preserving all historical restaurant orders and receipts. Reason: <strong>{statusReason.trim()}</strong>
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                disabled={updatingStatus}
                onClick={() => setConfirmDeactivateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalDangerBtn}
                disabled={updatingStatus}
                onClick={() => void handleToggleAccountStatus(false)}
              >
                {updatingStatus ? "Deactivating..." : "Confirm Deactivation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
