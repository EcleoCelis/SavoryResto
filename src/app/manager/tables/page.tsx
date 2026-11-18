"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PlusIcon, RefreshIcon } from "../../../components/ui/Icons";
import {
  createManagerTable,
  getManagerTablesOverview,
  StaffApiError,
  updateManagerTable,
} from "../../../lib/api/staff";
import type { ManagerTablesOverview, ManagerTableSummary } from "../../../types/staff";
import styles from "./tables.module.css";

type TableFilter = "all" | "available" | "occupied" | "inactive";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function formatManilaTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ManagerTablesPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<ManagerTablesOverview | null>(null);
  const [filter, setFilter] = useState<TableFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Modal state for Create or Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<ManagerTableSummary | null>(null);
  const [tableNumber, setTableNumber] = useState("");
  const [seats, setSeats] = useState(4);
  const [isActive, setIsActive] = useState(true);
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);

  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getManagerTablesOverview(controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setOverview(res);
          setLoadError("");
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof StaffApiError && err.status === 401) {
          router.replace("/staff/login");
          return;
        }
        const message =
          err instanceof Error ? err.message : "Unable to load dining tables.";
        setLoadError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [refreshNonce, router]);

  // Modal keyboard accessibility: focus primary input on open and close on Escape
  useEffect(() => {
    if (!modalOpen) return;
    const focusTimer = setTimeout(() => labelInputRef.current?.focus(), 20);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setModalOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modalOpen, saving]);

  const filteredTables = (overview?.items ?? []).filter((tbl) => {
    if (filter === "available" && (!tbl.is_active || tbl.is_occupied)) return false;
    if (filter === "occupied" && !tbl.is_occupied) return false;
    if (filter === "inactive" && tbl.is_active) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (
        !tbl.table_number.toLowerCase().includes(q) &&
        !(tbl.active_order?.order_number.toLowerCase().includes(q) ?? false) &&
        !(tbl.active_order?.customer_name.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
    }
    return true;
  });

  function triggerReload() {
    setRefreshing(true);
    setLoadError("");
    setRefreshNonce((prev) => prev + 1);
  }

  function openCreateModal() {
    setEditingTable(null);
    setTableNumber("");
    setSeats(4);
    setIsActive(true);
    setModalError("");
    setModalOpen(true);
  }

  function openEditModal(table: ManagerTableSummary) {
    setEditingTable(table);
    setTableNumber(table.table_number);
    setSeats(table.seats);
    setIsActive(table.is_active);
    setModalError("");
    setModalOpen(true);
  }

  async function handleSaveTable(event: FormEvent) {
    event.preventDefault();
    setModalError("");
    const cleanedName = tableNumber.trim();
    if (!cleanedName) {
      setModalError("Table label cannot be blank.");
      return;
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 30) {
      setModalError("Seats must be a whole number between 1 and 30.");
      return;
    }

    setSaving(true);
    try {
      if (editingTable) {
        const updated = await updateManagerTable(editingTable.id, {
          table_number: cleanedName,
          seats,
          is_active: isActive,
          expected_updated_at: editingTable.updated_at,
        });
        setFeedback({
          type: "success",
          text: `${updated.table_number} updated (${updated.seats} seats, ${updated.is_active ? "Active" : "Inactive"}).`,
        });
      } else {
        const created = await createManagerTable({
          table_number: cleanedName,
          seats,
          is_active: isActive,
        });
        setFeedback({
          type: "success",
          text: `Added ${created.table_number} (${created.seats} seats).`,
        });
      }
      setModalOpen(false);
      triggerReload();
    } catch (err) {
      if (err instanceof StaffApiError && err.status === 409) {
        triggerReload();
      }
      setModalError(err instanceof Error ? err.message : "Failed to save dining table.");
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickToggleStatus(table: ManagerTableSummary) {
    if (togglingId !== null) return;
    setTogglingId(table.id);
    setFeedback(null);
    try {
      const updated = await updateManagerTable(table.id, {
        is_active: !table.is_active,
        expected_updated_at: table.updated_at,
      });
      setFeedback({
        type: "success",
        text: `${updated.table_number} is now ${updated.is_active ? "Active" : "Inactive"}.`,
      });
      triggerReload();
    } catch (err) {
      if (err instanceof StaffApiError && err.status === 409) {
        triggerReload();
      }
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to update table availability.",
      });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.title}>Tables &amp; Floor Management</h1>
          <p className={styles.subtitle}>
            Configure restaurant dining tables, monitor live dine-in occupancy, and control active seating capacity.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={triggerReload}
            disabled={refreshing}
          >
            <RefreshIcon size={15} className={refreshing ? styles.spinningIcon : undefined} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
          <button type="button" className={styles.btnPrimary} onClick={openCreateModal}>
            <PlusIcon size={15} />
            <span>Add Table</span>
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

      <section className={styles.kpiGrid} aria-label="Dining floor summary">
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Active Tables</span>
          <span className={styles.kpiValue}>{overview ? overview.active_tables : "—"}</span>
          <span className={styles.kpiMeta}>
            {overview ? `${overview.total_tables} total configured` : "Loading..."}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Available Now</span>
          <span className={styles.kpiValue}>{overview ? overview.available_tables : "—"}</span>
          <span className={styles.kpiMeta}>Ready for dine-in guests</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Currently Occupied</span>
          <span className={styles.kpiValue}>{overview ? overview.occupied_tables : "—"}</span>
          <span className={styles.kpiMeta}>Active dine-in orders seated</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Active Seats</span>
          <span className={styles.kpiValue}>{overview ? overview.total_active_seats : "—"}</span>
          <span className={styles.kpiMeta}>Across enabled floor tables</span>
        </div>
      </section>

      <div className={styles.toolbar}>
        <div className={styles.filterGroup} role="tablist" aria-label="Filter tables by status">
          {(
            [
              ["all", "All Tables"],
              ["available", "Available"],
              ["occupied", "Occupied"],
              ["inactive", "Inactive"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`${styles.filterTab} ${filter === key ? styles.filterTabActive : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search table, guest, or order #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter dining tables"
        />
      </div>

      {loading ? (
        <div className={styles.emptyPanel}>Loading dining floor tables...</div>
      ) : loadError && !overview ? (
        <div className={styles.errorStateCard} role="alert">
          <p style={{ margin: 0, fontWeight: 600 }}>Unable to load dining tables</p>
          <p style={{ margin: 0, fontSize: "0.84rem" }}>{loadError}</p>
          <button type="button" className={styles.btnSecondary} onClick={triggerReload}>
            Retry Loading
          </button>
        </div>
      ) : filteredTables.length === 0 ? (
        <div className={styles.emptyPanel}>
          <p style={{ margin: 0 }}>No dining tables matched your filters.</p>
          {(filter !== "all" || search.trim() !== "") && (
            <div className={styles.emptyStateActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                Reset Filters
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.floorGrid}>
          {filteredTables.map((table) => {
            const badgeClass = !table.is_active
              ? styles.statusInactive
              : table.is_occupied
                ? styles.statusOccupied
                : styles.statusAvailable;
            const statusText = !table.is_active
              ? "Inactive"
              : table.is_occupied
                ? "Occupied"
                : "Available";
            const isToggling = togglingId === table.id;

            return (
              <article
                key={table.id}
                className={`${styles.tableCard} ${table.is_occupied ? styles.tableCardOccupied : ""} ${!table.is_active ? styles.tableCardInactive : ""}`}
              >
                <div className={styles.tableCardTop}>
                  <div>
                    <h2 className={styles.tableName}>{table.table_number}</h2>
                    <span className={styles.seatMeta}>{table.seats} seats</span>
                  </div>
                  <span className={`${styles.statusBadge} ${badgeClass}`}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    <span>{statusText}</span>
                  </span>
                </div>

                {table.active_order ? (
                  <div className={styles.activeOrderBox}>
                    <div className={styles.activeOrderTop}>
                      <span>{table.active_order.order_number}</span>
                      <span>{currencyFormatter.format(table.active_order.total_amount)}</span>
                    </div>
                    <div className={styles.activeOrderSub}>
                      <span>{table.active_order.customer_name}</span>
                      <span>
                        {table.active_order.status.toUpperCase()} ·{" "}
                        {formatManilaTime(table.active_order.ordered_at)}
                      </span>
                    </div>
                    <Link
                      href={`/manager/orders?search=${encodeURIComponent(table.active_order.order_number)}`}
                      className={styles.inspectOrderLink}
                    >
                      Inspect in Orders Management →
                    </Link>
                  </div>
                ) : (
                  <div className={styles.emptySlotBox}>
                    {table.is_active
                      ? "Table is currently open for dine-in guest selection."
                      : "Hidden from customer dine-in selection."}
                  </div>
                )}

                <div className={styles.tableFooter}>
                  <span className={styles.lifetimeText}>
                    {table.total_orders_count} dine-in orders total
                  </span>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={isToggling}
                      onClick={() => openEditModal(table)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={table.is_active ? styles.actionBtnDanger : styles.actionBtn}
                      disabled={(table.is_active && table.is_occupied) || isToggling}
                      title={
                        table.is_active && table.is_occupied
                          ? "Cannot deactivate while an active dine-in order is seated."
                          : undefined
                      }
                      onClick={() => void handleQuickToggleStatus(table)}
                    >
                      {isToggling ? "Saving..." : table.is_active ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="table-modal-title"
        >
          <form className={styles.modalDialog} onSubmit={handleSaveTable}>
            <h2 id="table-modal-title" className={styles.modalTitle}>
              {editingTable ? `Edit ${editingTable.table_number}` : "Add Dining Table"}
            </h2>

            {modalError && (
              <div className={styles.bannerError} role="alert">
                {modalError}
              </div>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="table-label-input" className={styles.formLabel}>
                Table Number / Label
              </label>
              <input
                ref={labelInputRef}
                id="table-label-input"
                type="text"
                required
                maxLength={20}
                className={styles.searchInput}
                placeholder="e.g., Table 11 or Patio 2"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="table-seats-input" className={styles.formLabel}>
                Seating Capacity
              </label>
              <input
                id="table-seats-input"
                type="number"
                required
                min={1}
                max={30}
                className={styles.searchInput}
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
              />
            </div>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={isActive}
                disabled={Boolean(editingTable?.is_occupied && isActive)}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span>
                Enabled for customer dine-in table selection
                {editingTable?.is_occupied ? " (occupied tables stay active)" : ""}
              </span>
            </label>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                disabled={saving}
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className={styles.modalConfirmBtn} disabled={saving}>
                {saving ? "Saving..." : editingTable ? "Save Changes" : "Create Table"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
