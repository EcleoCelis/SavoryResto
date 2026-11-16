"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
  const [statusReason, setStatusReason] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchDirectory = useCallback(async () => {
    const res = await getManagerCustomers({
      search: activeQuery,
      status: statusFilter,
      page,
    });
    return res;
  }, [activeQuery, page, statusFilter]);

  useEffect(() => {
    let active = true;
    void fetchDirectory()
      .then((res) => {
        if (!active) return;
        setDirectory(res);
        setSelectedId((prev) => {
          if (prev !== null && res.items.some((item) => item.customer_id === prev)) {
            return prev;
          }
          return res.items[0]?.customer_id ?? null;
        });
      })
      .catch((err) => {
        if (!active) return;
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
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [fetchDirectory, router]);

  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    let active = true;
    void getManagerCustomerDetail(selectedId)
      .then((loaded) => {
        if (active) setDetail(loaded);
      })
      .catch((err) => {
        if (err instanceof StaffApiError && err.status === 401) {
          router.replace("/staff/login");
          return;
        }
        if (active) {
          setFeedback({
            type: "error",
            text: err instanceof Error ? err.message : "Unable to load customer profile.",
          });
        }
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
  }, [router, selectedId]);

  const activeDetail = selectedId === null ? null : detail;

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setActiveQuery(searchInput.trim());
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

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <h1 className={styles.title}>Customer Directory</h1>
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
                setPage(1);
                setStatusFilter(tab);
              }}
            >
              {tab === "all" ? "All Accounts" : tab === "active" ? "Active" : "Deactivated"}
            </button>
          ))}
        </div>
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
                      <th className={styles.numericCol}>Total Spend</th>
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
                          onClick={() => setSelectedId(row.customer_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(row.customer_id);
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
                  <span className={styles.statLabel}>Lifetime Spend</span>
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
                        <span className={styles.orderMiniNumber}>#{order.order_number}</span> · {order.status}
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
                    onClick={() => void handleToggleAccountStatus(false)}
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
    </div>
  );
}
