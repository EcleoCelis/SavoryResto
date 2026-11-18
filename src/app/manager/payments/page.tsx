"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PlusIcon, RefreshIcon } from "../../../components/ui/Icons";
import {
  createManagerPaymentMethod,
  getManagerPaymentMethods,
  getManagerPaymentsLedger,
  StaffApiError,
  updateManagerPaymentMethod,
} from "../../../lib/api/staff";
import type {
  ManagerPaymentMethodSummary,
  ManagerPaymentsLedgerResponse,
  PaymentSettlementState,
} from "../../../types/staff";
import styles from "./payments.module.css";

type ActiveTab = "ledger" | "methods";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

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

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  const safeStr = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safeStr.replaceAll('"', '""')}"`;
}

export default function ManagerPaymentsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>("ledger");

  const [ledger, setLedger] = useState<ManagerPaymentsLedgerResponse | null>(null);
  const [methods, setMethods] = useState<ManagerPaymentMethodSummary[]>([]);

  // Ledger filters
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [settlementFilter, setSettlementFilter] = useState<"all" | PaymentSettlementState>("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [loadingLedger, setLoadingLedger] = useState(true);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Payment method modal state
  const [methodModalOpen, setMethodModalOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<ManagerPaymentMethodSummary | null>(null);
  const [methodCode, setMethodCode] = useState("");
  const [methodLabel, setMethodLabel] = useState("");
  const [methodDesc, setMethodDesc] = useState("");
  const [methodOrder, setMethodOrder] = useState(1);
  const [methodActive, setMethodActive] = useState(true);
  const [modalError, setModalError] = useState("");
  const [savingMethod, setSavingMethod] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getManagerPaymentMethods(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setMethods(list);
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
          text: err instanceof Error ? err.message : "Unable to load payment methods.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingMethods(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [refreshNonce, router]);

  useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return;
    }
    const controller = new AbortController();
    void getManagerPaymentsLedger(
      {
        search: activeSearch,
        settlement: settlementFilter,
        method_code: methodFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        page_size: 15,
      },
      controller.signal
    )
      .then((res) => {
        if (!controller.signal.aborted) {
          setLedger(res);
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
          text: err instanceof Error ? err.message : "Unable to load payments ledger.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingLedger(false);
          setRefreshing(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeSearch, dateFrom, dateTo, methodFilter, page, refreshNonce, router, settlementFilter]);

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setLoadingLedger(true);
    setPage(1);
    setActiveSearch(searchInput.trim());
  }

  function handleDateRangeChange(nextFrom: string, nextTo: string) {
    setDateFrom(nextFrom);
    setDateTo(nextTo);
    setPage(1);
    if (nextFrom && nextTo && nextFrom > nextTo) {
      setFeedback({ type: "error", text: "Start date cannot be later than end date." });
      return;
    }
    setFeedback(null);
    setLoadingLedger(true);
  }

  function handleResetFilters() {
    setLoadingLedger(true);
    setSearchInput("");
    setActiveSearch("");
    setSettlementFilter("all");
    setMethodFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setFeedback(null);
  }

  useEffect(() => {
    if (!methodModalOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingMethod) {
        setMethodModalOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [methodModalOpen, savingMethod]);

  function handleExportCsv() {
    if (!ledger || ledger.items.length === 0) return;
    const headers = [
      "Order Number",
      "Customer",
      "Channel",
      "Payment Method",
      "Order Status",
      "Settlement",
      "Subtotal (PHP)",
      "Discount (PHP)",
      "Tax (PHP)",
      "Total (PHP)",
      "Ordered At (Manila)",
    ];
    const rows = ledger.items.map((item) => [
      escapeCsvCell(item.order_number),
      escapeCsvCell(item.customer_name),
      escapeCsvCell(item.fulfillment_destination),
      escapeCsvCell(item.payment_method_label),
      escapeCsvCell(item.order_status),
      escapeCsvCell(item.settlement_state),
      escapeCsvCell(item.subtotal.toFixed(2)),
      escapeCsvCell(item.discount_amount.toFixed(2)),
      escapeCsvCell(item.tax_amount.toFixed(2)),
      escapeCsvCell(item.total_amount.toFixed(2)),
      escapeCsvCell(formatManilaDateTime(item.ordered_at)),
    ]);
    const csv = [headers.map(escapeCsvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `savorybites-payments-page-${ledger.page}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function openCreateMethodModal() {
    setEditingMethod(null);
    setMethodCode("");
    setMethodLabel("");
    setMethodDesc("");
    setMethodOrder(methods.length + 1);
    setMethodActive(true);
    setModalError("");
    setMethodModalOpen(true);
  }

  function openEditMethodModal(method: ManagerPaymentMethodSummary) {
    setEditingMethod(method);
    setMethodCode(method.code);
    setMethodLabel(method.label);
    setMethodDesc(method.description ?? "");
    setMethodOrder(method.display_order);
    setMethodActive(method.is_active);
    setModalError("");
    setMethodModalOpen(true);
  }

  async function handleSaveMethod(event: FormEvent) {
    event.preventDefault();
    setModalError("");

    const cleanLabel = methodLabel.trim();
    if (!cleanLabel) {
      setModalError("Label cannot be blank.");
      return;
    }
    if (!editingMethod && !/^[a-z][a-z0-9_]*$/.test(methodCode.trim())) {
      setModalError("Code must start with a lowercase letter and use only a–z, 0–9, or underscores.");
      return;
    }

    setSavingMethod(true);
    try {
      if (editingMethod) {
        const updated = await updateManagerPaymentMethod(editingMethod.id, {
          label: cleanLabel,
          description: methodDesc.trim() || null,
          is_active: methodActive,
          display_order: methodOrder,
          expected_updated_at: editingMethod.updated_at,
        });
        setFeedback({
          type: "success",
          text: `Payment method "${updated.label}" updated.`,
        });
      } else {
        const created = await createManagerPaymentMethod({
          code: methodCode.trim().toLowerCase(),
          label: cleanLabel,
          description: methodDesc.trim() || null,
          is_active: methodActive,
          display_order: methodOrder,
        });
        setFeedback({
          type: "success",
          text: `Added checkout payment method "${created.label}".`,
        });
      }
      setMethodModalOpen(false);
      setRefreshNonce((prev) => prev + 1);
    } catch (err) {
      if (err instanceof StaffApiError && err.status === 409) {
        setMethodModalOpen(false);
        setRefreshNonce((prev) => prev + 1);
        setFeedback({
          type: "error",
          text: err.message,
        });
        return;
      }
      setModalError(err instanceof Error ? err.message : "Failed to save payment method.");
    } finally {
      setSavingMethod(false);
    }
  }

  async function handleToggleMethodActive(method: ManagerPaymentMethodSummary) {
    setFeedback(null);
    try {
      const updated = await updateManagerPaymentMethod(method.id, {
        is_active: !method.is_active,
        expected_updated_at: method.updated_at,
      });
      setFeedback({
        type: "success",
        text: `${updated.label} is now ${updated.is_active ? "enabled" : "disabled"} at checkout.`,
      });
      setRefreshNonce((prev) => prev + 1);
    } catch (err) {
      if (err instanceof StaffApiError && err.status === 409) {
        setRefreshNonce((prev) => prev + 1);
      }
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to update payment method status.",
      });
    }
  }

  const hasActiveFilters =
    Boolean(activeSearch) ||
    settlementFilter !== "all" ||
    methodFilter !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const activeMethodsCount = methods.filter((m) => m.is_active).length;

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.title}>Payments &amp; Billing Reconciliation</h1>
          <p className={styles.subtitle}>
            Audit customer order settlements, track collections by payment channel, and configure accepted checkout methods.
          </p>
        </div>
        <div className={styles.headerActions}>
          {activeTab === "ledger" && (
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={!ledger || ledger.items.length === 0}
              onClick={handleExportCsv}
            >
              Export Page CSV
            </button>
          )}
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => {
              setRefreshing(true);
              setRefreshNonce((prev) => prev + 1);
            }}
            disabled={refreshing}
          >
            <RefreshIcon size={15} className={refreshing ? styles.spinningIcon : undefined} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
          <button type="button" className={styles.btnPrimary} onClick={openCreateMethodModal}>
            <PlusIcon size={15} />
            <span>Add Payment Method</span>
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

      <div className={styles.sectionTabs} role="tablist" aria-label="Payments management views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "ledger"}
          className={`${styles.sectionTab} ${activeTab === "ledger" ? styles.sectionTabActive : ""}`}
          onClick={() => setActiveTab("ledger")}
        >
          <span>Billing Ledger</span>
          {ledger && <span className={styles.tabBadge}>{ledger.total}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "methods"}
          className={`${styles.sectionTab} ${activeTab === "methods" ? styles.sectionTabActive : ""}`}
          onClick={() => setActiveTab("methods")}
        >
          <span>Accepted Payment Methods</span>
          <span className={styles.tabBadge}>{methods.length}</span>
        </button>
      </div>

      {activeTab === "ledger" ? (
        <>
          <section className={styles.kpiGrid} aria-label="Settlement totals">
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Collected Revenue (Settled)</span>
              <span className={styles.kpiValue}>
                {ledger ? currencyFormatter.format(ledger.collected_revenue) : "—"}
              </span>
              <span className={styles.kpiMeta}>
                {ledger ? `${ledger.completed_count} completed orders` : "Loading..."}
              </span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Pending Settlement (Active Queue)</span>
              <span className={styles.kpiValue}>
                {ledger ? currencyFormatter.format(ledger.pending_revenue) : "—"}
              </span>
              <span className={styles.kpiMeta}>
                {ledger ? `${ledger.pending_count} active orders in progress` : "Loading..."}
              </span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Voided (Cancelled Orders)</span>
              <span className={styles.kpiValue}>
                {ledger ? currencyFormatter.format(ledger.voided_revenue) : "—"}
              </span>
              <span className={styles.kpiMeta}>
                {ledger ? `${ledger.voided_count} cancelled orders` : "Loading..."}
              </span>
            </div>
          </section>

          {ledger && ledger.method_breakdown.length > 0 && (
            <section className={styles.breakdownGrid} aria-label="Breakdown by payment method">
              {ledger.method_breakdown.map((entry) => {
                const isSelected = methodFilter === entry.method_code;
                return (
                  <button
                    key={entry.method_code}
                    type="button"
                    className={`${styles.breakdownCard} ${isSelected ? styles.breakdownCardActive : ""}`}
                    onClick={() => {
                      setLoadingLedger(true);
                      setPage(1);
                      setMethodFilter(isSelected ? "all" : entry.method_code);
                    }}
                  >
                    <span className={styles.breakdownTitle}>{entry.method_label}</span>
                    <span className={styles.breakdownValue}>
                      {currencyFormatter.format(entry.collected_revenue)}
                    </span>
                    <span className={styles.breakdownSub}>
                      {entry.completed_count} settled · {entry.orders_count} total orders
                    </span>
                  </button>
                );
              })}
            </section>
          )}

          <div className={styles.toolbar}>
            <form className={styles.searchForm} onSubmit={handleSearchSubmit}>
              <input
                type="search"
                className={styles.inputControl}
                placeholder="Search order #, customer, or email..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search payment ledger"
              />
              <button type="submit" className={styles.btnPrimary}>
                Search
              </button>
            </form>

            <div className={styles.filterField}>
              <label htmlFor="payment-settlement-filter" className={styles.filterLabel}>
                Settlement
              </label>
              <select
                id="payment-settlement-filter"
                className={styles.selectControl}
                value={settlementFilter}
                onChange={(e) => {
                  if (!(dateFrom && dateTo && dateFrom > dateTo)) {
                    setLoadingLedger(true);
                  }
                  setPage(1);
                  setSettlementFilter(e.target.value as "all" | PaymentSettlementState);
                }}
              >
                <option value="all">All States</option>
                <option value="settled">Settled (Completed)</option>
                <option value="pending">Pending Completion</option>
                <option value="voided">Voided (Cancelled)</option>
              </select>
            </div>

            <div className={styles.filterField}>
              <label htmlFor="payment-method-filter" className={styles.filterLabel}>
                Method
              </label>
              <select
                id="payment-method-filter"
                className={styles.selectControl}
                value={methodFilter}
                onChange={(e) => {
                  if (!(dateFrom && dateTo && dateFrom > dateTo)) {
                    setLoadingLedger(true);
                  }
                  setPage(1);
                  setMethodFilter(e.target.value);
                }}
              >
                <option value="all">All Methods</option>
                {methods.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.filterField}>
              <label htmlFor="payments-date-from" className={styles.filterLabel}>
                From (Manila)
              </label>
              <input
                id="payments-date-from"
                type="date"
                className={styles.inputControl}
                value={dateFrom}
                onChange={(e) => handleDateRangeChange(e.target.value, dateTo)}
              />
            </div>

            <div className={styles.filterField}>
              <label htmlFor="payments-date-to" className={styles.filterLabel}>
                To (Manila)
              </label>
              <input
                id="payments-date-to"
                type="date"
                className={styles.inputControl}
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

          <section className={styles.tableCard} aria-label="Billing transactions table">
            {loadingLedger ? (
              <div className={styles.emptyPanel}>Loading transaction ledger...</div>
            ) : !ledger || ledger.items.length === 0 ? (
              <div className={styles.emptyPanel}>No payment records matched your filters.</div>
            ) : (
              <>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer &amp; Channel</th>
                        <th>Method</th>
                        <th>Settlement</th>
                        <th className={styles.numericCol}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.items.map((tx) => {
                        const badgeClass =
                          tx.settlement_state === "settled"
                            ? styles.badgeSettled
                            : tx.settlement_state === "pending"
                              ? styles.badgePending
                              : styles.badgeVoided;
                        const labelText =
                          tx.settlement_state === "settled"
                            ? "Settled"
                            : tx.settlement_state === "pending"
                              ? `Pending (${tx.order_status})`
                              : "Voided";

                        return (
                          <tr key={tx.order_id}>
                            <td>
                              <Link
                                href={`/manager/orders?search=${encodeURIComponent(tx.order_number)}`}
                                className={styles.orderLink}
                                title={`Inspect receipt details for ${tx.order_number}`}
                              >
                                {tx.order_number}
                              </Link>
                              <span className={styles.secondaryCell}>
                                {formatManilaDateTime(tx.ordered_at)}
                              </span>
                            </td>
                            <td>
                              <span className={styles.primaryCell}>{tx.customer_name}</span>
                              <span className={styles.secondaryCell}>
                                {tx.fulfillment_destination} ·{" "}
                                {tx.order_type === "dine_in" ? "Dine-In" : "Takeout"}
                              </span>
                            </td>
                            <td>
                              <span className={styles.primaryCell}>{tx.payment_method_label}</span>
                            </td>
                            <td>
                              <span className={`${styles.badge} ${badgeClass}`}>
                                <span className={styles.statusDot} aria-hidden="true" />
                                <span>{labelText}</span>
                              </span>
                            </td>
                            <td className={styles.numericCol}>
                              <span className={styles.primaryCell}>
                                {currencyFormatter.format(tx.total_amount)}
                              </span>
                              {tx.discount_amount > 0 && (
                                <span className={styles.secondaryCell}>
                                  Disc: -{currencyFormatter.format(tx.discount_amount)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {ledger.total > ledger.page_size && (
                  <div className={styles.pagination}>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      disabled={page <= 1}
                      onClick={() => {
                        setLoadingLedger(true);
                        setPage((p) => p - 1);
                      }}
                    >
                      Previous
                    </button>
                    <span className={styles.secondaryCell}>
                      Page {ledger.page} of {Math.ceil(ledger.total / ledger.page_size)} ({ledger.total} total)
                    </span>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      disabled={page * ledger.page_size >= ledger.total}
                      onClick={() => {
                        setLoadingLedger(true);
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
        </>
      ) : (
        <section className={styles.tableCard} aria-label="Payment methods configuration">
          {loadingMethods ? (
            <div className={styles.emptyPanel}>Loading configured payment methods...</div>
          ) : methods.length === 0 ? (
            <div className={styles.emptyPanel}>No payment methods configured.</div>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Description</th>
                    <th className={styles.numericCol}>Order Count</th>
                    <th className={styles.numericCol}>Collected</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((method) => {
                    const isSoleActive = method.is_active && activeMethodsCount <= 1;
                    return (
                      <tr key={method.id}>
                        <td>
                          <span className={styles.primaryCell}>{method.label}</span>
                          <span className={styles.secondaryCell}>
                            code: {method.code} · order #{method.display_order}
                          </span>
                        </td>
                        <td>
                          <span className={styles.secondaryCell}>
                            {method.description || "No checkout instructions"}
                          </span>
                        </td>
                        <td className={styles.numericCol}>{method.orders_count}</td>
                        <td className={styles.numericCol}>
                          {currencyFormatter.format(method.collected_revenue)}
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              method.is_active ? styles.badgeSettled : styles.badgeVoided
                            }`}
                          >
                            <span className={styles.statusDot} aria-hidden="true" />
                            <span>{method.is_active ? "Active" : "Disabled"}</span>
                          </span>
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => openEditMethodModal(method)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={method.is_active ? styles.actionBtnDanger : styles.actionBtn}
                              disabled={isSoleActive}
                              title={
                                isSoleActive
                                  ? "At least one active payment method must remain enabled."
                                  : undefined
                              }
                              onClick={() => void handleToggleMethodActive(method)}
                            >
                              {method.is_active ? "Disable" : "Enable"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {methodModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-method-modal-title"
        >
          <form className={styles.modalDialog} onSubmit={handleSaveMethod}>
            <h2 id="payment-method-modal-title" className={styles.modalTitle}>
              {editingMethod ? `Edit ${editingMethod.label}` : "Add Payment Method"}
            </h2>

            {modalError && (
              <div className={styles.bannerError} role="alert">
                {modalError}
              </div>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="pm-code-input" className={styles.formLabel}>
                Code Identifier
              </label>
              <input
                id="pm-code-input"
                type="text"
                required
                disabled={Boolean(editingMethod)}
                className={styles.inputControl}
                placeholder="e.g., maya_qr"
                value={methodCode}
                onChange={(e) => setMethodCode(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="pm-label-input" className={styles.formLabel}>
                Display Label
              </label>
              <input
                id="pm-label-input"
                type="text"
                required
                maxLength={100}
                className={styles.inputControl}
                placeholder="e.g., Maya Wallet"
                value={methodLabel}
                onChange={(e) => setMethodLabel(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="pm-desc-input" className={styles.formLabel}>
                Customer Instructions
              </label>
              <textarea
                id="pm-desc-input"
                maxLength={500}
                className={styles.modalTextarea}
                placeholder="Shown during checkout selection"
                value={methodDesc}
                onChange={(e) => setMethodDesc(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="pm-order-input" className={styles.formLabel}>
                Display Order
              </label>
              <input
                id="pm-order-input"
                type="number"
                required
                min={0}
                max={9999}
                className={styles.inputControl}
                value={methodOrder}
                onChange={(e) => setMethodOrder(Number(e.target.value))}
              />
            </div>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={methodActive}
                disabled={Boolean(editingMethod?.is_active && activeMethodsCount <= 1)}
                onChange={(e) => setMethodActive(e.target.checked)}
              />
              <span>Enabled for customer checkout</span>
            </label>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                disabled={savingMethod}
                onClick={() => setMethodModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className={styles.modalConfirmBtn} disabled={savingMethod}>
                {savingMethod ? "Saving..." : editingMethod ? "Save Changes" : "Create Method"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
