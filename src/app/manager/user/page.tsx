"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PlusIcon, RefreshIcon } from "../../../components/ui/Icons";
import {
  createManagerStaffAccount,
  getCurrentStaff,
  getManagerAuditLogs,
  getManagerSecurityOverview,
  getManagerStaffList,
  StaffApiError,
  updateManagerStaffRole,
  updateManagerStaffStatus,
} from "../../../lib/api/staff";
import type {
  AuditLogEntry,
  SecurityOverview,
  StaffAccountDetail,
  StaffAccountStatus,
  StaffRole,
  StaffUser,
} from "../../../types/staff";
import styles from "./user.module.css";

type ActiveTab = "staff" | "audit";

type ConfirmMutation =
  | {
      kind: "status";
      staff: StaffAccountDetail;
      nextStatus: StaffAccountStatus;
    }
  | {
      kind: "role";
      staff: StaffAccountDetail;
      nextRole: StaffRole;
    }
  | null;

const ROLE_LABELS: Record<StaffRole, string> = {
  manager: "Manager",
  kitchen_staff: "Kitchen Staff (KDS)",
};

const SENSITIVE_DETAIL_FRAGMENTS = [
  "password",
  "token",
  "secret",
  "cookie",
  "jwt",
  "authorization",
];

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

function getPasswordChecks(pwd: string) {
  return {
    length: pwd.length >= 12,
    upper: /[A-Z]/.test(pwd),
    lower: /[a-z]/.test(pwd),
    digit: /\d/.test(pwd),
    special: /[!@#$%^&*(),.?":{}|<>\-_+=\[\]\\/`~]/.test(pwd),
  };
}

function sanitizeDetailEntries(details: Record<string, unknown> | null): Array<[string, string]> {
  if (!details) return [];
  return Object.entries(details)
    .filter(([key]) => {
      const lower = key.toLowerCase();
      return !SENSITIVE_DETAIL_FRAGMENTS.some((frag) => lower.includes(frag));
    })
    .map(([key, val]) => {
      const formattedVal =
        typeof val === "string" || typeof val === "number" || typeof val === "boolean"
          ? String(val)
          : JSON.stringify(val);
      return [key.replaceAll("_", " "), formattedVal];
    });
}

export default function ManagerUserPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>("staff");

  const [currentStaff, setCurrentStaff] = useState<StaffUser | null>(null);
  const [security, setSecurity] = useState<SecurityOverview | null>(null);
  const [staffList, setStaffList] = useState<StaffAccountDetail[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Staff filters & local pagination
  const [staffSearchInput, setStaffSearchInput] = useState("");
  const [staffRoleFilter, setStaffRoleFilter] = useState<"all" | StaffRole>("all");
  const [staffStatusFilter, setStaffStatusFilter] = useState<"all" | StaffAccountStatus>("all");
  const [staffPage, setStaffPage] = useState(1);

  // Audit log filters & server offset pagination
  const [auditSearchInput, setAuditSearchInput] = useState("");
  const [activeAuditSearch, setActiveAuditSearch] = useState("");
  const [auditOutcomeFilter, setAuditOutcomeFilter] = useState<"all" | "success" | "failure" | "denied">("all");
  const [auditEventFilter, setAuditEventFilter] = useState("");
  const [auditLimit, setAuditLimit] = useState(25);
  const [auditOffset, setAuditOffset] = useState(0);

  const [loadingStaff, setLoadingStaff] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Create Staff Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState<StaffRole>("kitchen_staff");
  const [createPassword, setCreatePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  // Role/Status confirmation modal state
  const [confirmMutation, setConfirmMutation] = useState<ConfirmMutation>(null);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getCurrentStaff(),
      getManagerStaffList(undefined, controller.signal),
      getManagerSecurityOverview(controller.signal),
    ])
      .then(([me, roster, overview]) => {
        if (controller.signal.aborted) return;
        setCurrentStaff(me);
        setStaffList(roster);
        setSecurity(overview);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof StaffApiError && err.status === 401) {
          router.replace("/staff/login");
          return;
        }
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Unable to load staff management workspace.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingStaff(false);
          setRefreshing(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [refreshNonce, router]);

  useEffect(() => {
    if (activeTab !== "audit") {
      return;
    }
    const controller = new AbortController();
    void getManagerAuditLogs(
      {
        limit: auditLimit,
        offset: auditOffset,
        outcome: auditOutcomeFilter === "all" ? undefined : auditOutcomeFilter,
        event_type: auditEventFilter || undefined,
        search: activeAuditSearch || undefined,
      },
      controller.signal
    )
      .then((logs) => {
        if (!controller.signal.aborted) {
          setAuditLogs(logs);
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
          text: err instanceof Error ? err.message : "Unable to load audit logs.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingAudit(false);
          setRefreshing(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    activeAuditSearch,
    activeTab,
    auditEventFilter,
    auditLimit,
    auditOffset,
    auditOutcomeFilter,
    refreshNonce,
    router,
  ]);

  const filteredStaff = staffList
    .filter((member) => {
      if (staffRoleFilter !== "all" && member.role !== staffRoleFilter) return false;
      if (staffStatusFilter !== "all" && member.status !== staffStatusFilter) return false;
      if (staffSearchInput.trim()) {
        const q = staffSearchInput.trim().toLowerCase();
        if (
          !member.name.toLowerCase().includes(q) &&
          !member.email.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => b.id - a.id);

  const STAFF_PAGE_SIZE = 15;
  const totalStaffPages = Math.max(1, Math.ceil(filteredStaff.length / STAFF_PAGE_SIZE));
  const safeStaffPage = Math.min(staffPage, totalStaffPages);
  const paginatedStaff = filteredStaff.slice(
    (safeStaffPage - 1) * STAFF_PAGE_SIZE,
    safeStaffPage * STAFF_PAGE_SIZE
  );

  const activeManagersCount =
    security?.active_managers_count ??
    staffList.filter((u) => u.role === "manager" && u.status === "active").length;

  const passwordChecks = getPasswordChecks(createPassword);
  const allPasswordChecksMet = Object.values(passwordChecks).every(Boolean);

  function handleRefresh() {
    setRefreshing(true);
    if (activeTab === "audit") {
      setLoadingAudit(true);
    }
    setRefreshNonce((prev) => prev + 1);
  }

  function openCreateModal() {
    setCreateName("");
    setCreateEmail("");
    setCreateRole("kitchen_staff");
    setCreatePassword("");
    setShowPassword(false);
    setCreateError("");
    setCreateModalOpen(true);
  }

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    setCreateError("");

    const cleanName = createName.trim();
    const cleanEmail = createEmail.trim().toLowerCase();
    if (cleanName.length < 2) {
      setCreateError("Full name must be at least 2 characters.");
      return;
    }
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setCreateError("Please enter a valid staff email address.");
      return;
    }
    if (!allPasswordChecksMet) {
      setCreateError("Password must meet all five enterprise security requirements below.");
      return;
    }

    setCreating(true);
    try {
      const created = await createManagerStaffAccount({
        name: cleanName,
        email: cleanEmail,
        role: createRole,
        password: createPassword,
      });
      setCreatePassword("");
      setCreateModalOpen(false);
      setRefreshNonce((prev) => prev + 1);
      setFeedback({
        type: "success",
        text: `Staff account created for ${created.name} (${ROLE_LABELS[created.role]}).`,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create staff account.");
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmMutation() {
    if (!confirmMutation) return;
    setMutating(true);
    setFeedback(null);
    try {
      if (confirmMutation.kind === "status") {
        const updated = await updateManagerStaffStatus(
          confirmMutation.staff.id,
          confirmMutation.nextStatus
        );
        setFeedback({
          type: "success",
          text:
            updated.status === "active"
              ? `${updated.name}'s account has been reactivated.`
              : `${updated.name}'s account has been deactivated and active sessions revoked.`,
        });
      } else {
        const updated = await updateManagerStaffRole(
          confirmMutation.staff.id,
          confirmMutation.nextRole
        );
        setFeedback({
          type: "success",
          text: `${updated.name}'s role is now ${ROLE_LABELS[updated.role]}. Existing sessions with the old role must re-authenticate.`,
        });
      }
      setConfirmMutation(null);
      setRefreshNonce((prev) => prev + 1);
    } catch (err) {
      setConfirmMutation(null);
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to update staff account.",
      });
    } finally {
      setMutating(false);
    }
  }

  function handleAuditSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setLoadingAudit(true);
    setAuditOffset(0);
    setActiveAuditSearch(auditSearchInput.trim());
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.title}>Staff &amp; User Management</h1>
          <p className={styles.subtitle}>
            Provision Manager and Kitchen Staff (KDS) accounts, manage role boundaries, and inspect audit logs.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshIcon size={15} className={refreshing ? styles.spinningIcon : undefined} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
          <button type="button" className={styles.btnPrimary} onClick={openCreateModal}>
            <PlusIcon size={15} />
            <span>Create Staff Account</span>
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

      <section className={styles.securityGrid} aria-label="Security overview metrics">
        <div className={styles.securityCard}>
          <span className={styles.securityLabel}>Active Managers</span>
          <span className={styles.securityValue}>{activeManagersCount}</span>
          <span className={styles.securityMeta}>
            {activeManagersCount <= 1
              ? "Last active manager safeguard locked"
              : "Multi-manager coverage active"}
          </span>
        </div>

        <div className={styles.securityCard}>
          <span className={styles.securityLabel}>Active Kitchen Staff (KDS)</span>
          <span className={styles.securityValue}>
            {security ? security.active_kitchen_staff_count : "—"}
          </span>
          <span className={styles.securityMeta}>
            Isolated strictly to /kds preparation queue
          </span>
        </div>

        <div className={styles.securityCard}>
          <span className={styles.securityLabel}>Session &amp; Lockout Policy</span>
          <span className={styles.securityValue}>
            {security ? `${security.staff_session_timeout_minutes} min` : "—"}
          </span>
          <span className={styles.securityMeta}>
            {security
              ? `Lockout after ${security.max_failed_logins_before_lockout} failures (${Math.round(
                  security.rate_limit_lockout_seconds / 60
                )}m window)`
              : "Loading policy..."}
          </span>
        </div>

        <div className={styles.securityCard}>
          <span className={styles.securityLabel}>Access Governance</span>
          <span className={styles.securityValue}>
            {security ? (security.public_manager_registration ? "Open" : "Restricted") : "—"}
          </span>
          <span className={styles.securityMeta}>
            {security
              ? `Env: ${security.environment} · Secure Cookie: ${security.cookie_secure ? "On" : "Dev"}`
              : "Verifying configuration..."}
          </span>
        </div>
      </section>

      <div className={styles.sectionTabs} role="tablist" aria-label="Staff administration sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "staff"}
          className={`${styles.sectionTab} ${activeTab === "staff" ? styles.sectionTabActive : ""}`}
          onClick={() => setActiveTab("staff")}
        >
          <span>Staff Directory</span>
          <span className={styles.tabBadge}>{staffList.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "audit"}
          className={`${styles.sectionTab} ${activeTab === "audit" ? styles.sectionTabActive : ""}`}
          onClick={() => {
            setLoadingAudit(true);
            setActiveTab("audit");
          }}
        >
          <span>Audit Logs</span>
        </button>
      </div>

      {activeTab === "staff" ? (
        <>
          <div className={styles.toolbar}>
            <div className={styles.searchForm}>
              <input
                type="search"
                className={styles.inputControl}
                placeholder="Filter by staff name or email..."
                value={staffSearchInput}
                onChange={(e) => {
                  setStaffPage(1);
                  setStaffSearchInput(e.target.value);
                }}
                aria-label="Filter staff accounts by name or email"
              />
            </div>

            <div className={styles.filterField}>
              <label htmlFor="staff-role-filter" className={styles.filterLabel}>
                Role
              </label>
              <select
                id="staff-role-filter"
                className={styles.selectControl}
                value={staffRoleFilter}
                onChange={(e) => {
                  setStaffPage(1);
                  setStaffRoleFilter(e.target.value as "all" | StaffRole);
                }}
              >
                <option value="all">All Roles</option>
                <option value="manager">Manager</option>
                <option value="kitchen_staff">Kitchen Staff (KDS)</option>
              </select>
            </div>

            <div className={styles.filterField}>
              <label htmlFor="staff-status-filter" className={styles.filterLabel}>
                Status
              </label>
              <select
                id="staff-status-filter"
                className={styles.selectControl}
                value={staffStatusFilter}
                onChange={(e) => {
                  setStaffPage(1);
                  setStaffStatusFilter(e.target.value as "all" | StaffAccountStatus);
                }}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <section className={styles.tableCard} aria-label="Staff accounts table">
            {loadingStaff ? (
              <div className={styles.emptyPanel}>Loading staff roster...</div>
            ) : paginatedStaff.length === 0 ? (
              <div className={styles.emptyPanel}>No staff accounts matched your filters.</div>
            ) : (
              <>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Staff Member</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Created (Manila)</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedStaff.map((member) => {
                        const isSelf = currentStaff?.id === member.id;
                        const isSoleActiveManager =
                          member.role === "manager" &&
                          member.status === "active" &&
                          activeManagersCount <= 1;
                        const nextRole: StaffRole =
                          member.role === "manager" ? "kitchen_staff" : "manager";
                        const nextStatus: StaffAccountStatus =
                          member.status === "active" ? "inactive" : "active";

                        return (
                          <tr key={member.id}>
                            <td>
                              <span className={styles.primaryCell}>
                                <span>{member.name}</span>
                                {isSelf && <span className={styles.selfTag}>You</span>}
                              </span>
                              <span className={styles.secondaryCell}>{member.email}</span>
                            </td>
                            <td>
                              <span
                                className={`${styles.badge} ${
                                  member.role === "manager" ? styles.roleManager : styles.roleKitchen
                                }`}
                              >
                                {ROLE_LABELS[member.role]}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`${styles.badge} ${
                                  member.status === "active"
                                    ? styles.statusActive
                                    : styles.statusInactive
                                }`}
                              >
                                <span className={styles.statusDot} aria-hidden="true" />
                                <span>{member.status === "active" ? "Active" : "Inactive"}</span>
                              </span>
                            </td>
                            <td>
                              <span className={styles.secondaryCell}>
                                {formatManilaDateTime(member.created_at)}
                              </span>
                            </td>
                            <td>
                              <div className={styles.rowActions}>
                                <button
                                  type="button"
                                  className={styles.actionBtn}
                                  disabled={isSoleActiveManager}
                                  title={
                                    isSoleActiveManager
                                      ? "At least one active Manager must remain."
                                      : `Switch role to ${ROLE_LABELS[nextRole]}`
                                  }
                                  onClick={() =>
                                    setConfirmMutation({
                                      kind: "role",
                                      staff: member,
                                      nextRole,
                                    })
                                  }
                                >
                                  {member.role === "manager" ? "Set KDS" : "Promote Manager"}
                                </button>

                                <button
                                  type="button"
                                  className={
                                    member.status === "active"
                                      ? styles.actionBtnDanger
                                      : styles.actionBtn
                                  }
                                  disabled={
                                    (isSelf && nextStatus === "inactive") ||
                                    (isSoleActiveManager && nextStatus === "inactive")
                                  }
                                  title={
                                    isSelf && nextStatus === "inactive"
                                      ? "You cannot deactivate your own active account."
                                      : isSoleActiveManager && nextStatus === "inactive"
                                        ? "Cannot deactivate the last active Manager."
                                        : nextStatus === "inactive"
                                          ? "Deactivate staff account"
                                          : "Reactivate staff account"
                                  }
                                  onClick={() =>
                                    setConfirmMutation({
                                      kind: "status",
                                      staff: member,
                                      nextStatus,
                                    })
                                  }
                                >
                                  {member.status === "active" ? "Deactivate" : "Reactivate"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {filteredStaff.length > STAFF_PAGE_SIZE && (
                  <div className={styles.pagination}>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      disabled={safeStaffPage <= 1}
                      onClick={() => setStaffPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span className={styles.secondaryCell}>
                      Page {safeStaffPage} of {totalStaffPages} ({filteredStaff.length} staff)
                    </span>
                    <button
                      type="button"
                      className={styles.pageBtn}
                      disabled={safeStaffPage >= totalStaffPages}
                      onClick={() => setStaffPage((p) => p + 1)}
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
        <>
          <div className={styles.toolbar}>
            <form className={styles.searchForm} onSubmit={handleAuditSearchSubmit}>
              <input
                type="search"
                className={styles.inputControl}
                placeholder="Search actor email, event type, target..."
                value={auditSearchInput}
                onChange={(e) => setAuditSearchInput(e.target.value)}
                aria-label="Search audit logs"
              />
              <button type="submit" className={styles.btnPrimary}>
                Search
              </button>
            </form>

            <div className={styles.filterField}>
              <label htmlFor="audit-event-filter" className={styles.filterLabel}>
                Event Type
              </label>
              <select
                id="audit-event-filter"
                className={styles.selectControl}
                value={auditEventFilter}
                onChange={(e) => {
                  setLoadingAudit(true);
                  setAuditOffset(0);
                  setAuditEventFilter(e.target.value);
                }}
              >
                <option value="">All Events</option>
                <option value="staff.login.success">Staff Login Success</option>
                <option value="staff.login.failed">Staff Login Failed</option>
                <option value="staff.login.denied">Staff Login Denied</option>
                <option value="staff.logout">Staff Logout</option>
                <option value="staff.create">Staff Created</option>
                <option value="staff.role_change">Staff Role Changed</option>
                <option value="staff.status_change">Staff Status Changed</option>
                <option value="manager.order.status_change">Order Status Updated</option>
                <option value="manager.customer.status_change">Customer Status Updated</option>
              </select>
            </div>

            <div className={styles.filterField}>
              <label htmlFor="audit-outcome-filter" className={styles.filterLabel}>
                Outcome
              </label>
              <select
                id="audit-outcome-filter"
                className={styles.selectControl}
                value={auditOutcomeFilter}
                onChange={(e) => {
                  setLoadingAudit(true);
                  setAuditOffset(0);
                  setAuditOutcomeFilter(
                    e.target.value as "all" | "success" | "failure" | "denied"
                  );
                }}
              >
                <option value="all">All Outcomes</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="denied">Denied</option>
              </select>
            </div>

            <div className={styles.filterField}>
              <label htmlFor="audit-limit-select" className={styles.filterLabel}>
                Rows
              </label>
              <select
                id="audit-limit-select"
                className={styles.selectControl}
                value={auditLimit}
                onChange={(e) => {
                  setLoadingAudit(true);
                  setAuditOffset(0);
                  setAuditLimit(Number(e.target.value));
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <section className={styles.tableCard} aria-label="Audit logs table">
            {loadingAudit ? (
              <div className={styles.emptyPanel}>Loading immutable audit logs...</div>
            ) : auditLogs.length === 0 ? (
              <div className={styles.emptyPanel}>No audit events matched your filters.</div>
            ) : (
              <>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Timestamp (Manila)</th>
                        <th>Event</th>
                        <th>Actor</th>
                        <th>Target</th>
                        <th>Outcome</th>
                        <th>Context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => {
                        const detailPairs = sanitizeDetailEntries(log.details);
                        const outcomeClass =
                          log.outcome === "success"
                            ? styles.outcomeSuccess
                            : log.outcome === "failure"
                              ? styles.outcomeFailure
                              : styles.outcomeDenied;

                        return (
                          <tr key={log.id}>
                            <td>
                              <span className={styles.secondaryCell}>
                                {formatManilaDateTime(log.created_at)}
                              </span>
                            </td>
                            <td>
                              <span className={styles.primaryCell}>{log.event_type}</span>
                            </td>
                            <td>
                              <span className={styles.primaryCell}>
                                {log.actor_email || `${log.actor_type} #${log.actor_id ?? "?"}`}
                              </span>
                              <span className={styles.secondaryCell}>{log.actor_type}</span>
                            </td>
                            <td>
                              <span className={styles.secondaryCell}>
                                {log.target_type
                                  ? `${log.target_type} #${log.target_id ?? ""}`
                                  : "—"}
                              </span>
                            </td>
                            <td>
                              <span className={`${styles.badge} ${outcomeClass}`}>
                                {log.outcome}
                              </span>
                            </td>
                            <td>
                              {detailPairs.length === 0 ? (
                                <span className={styles.secondaryCell}>—</span>
                              ) : (
                                <div className={styles.detailTags}>
                                  {detailPairs.map(([key, val]) => (
                                    <span key={key} className={styles.detailTag}>
                                      {key}: {val}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={auditOffset === 0}
                    onClick={() => {
                      setLoadingAudit(true);
                      setAuditOffset((prev) => Math.max(0, prev - auditLimit));
                    }}
                  >
                    Newer Events
                  </button>
                  <span className={styles.secondaryCell}>
                    Showing {auditOffset + 1}–{auditOffset + auditLogs.length}
                  </span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={auditLogs.length < auditLimit}
                    onClick={() => {
                      setLoadingAudit(true);
                      setAuditOffset((prev) => prev + auditLimit);
                    }}
                  >
                    Older Events
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {createModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-staff-modal-title"
        >
          <form className={styles.modalDialog} onSubmit={handleCreateSubmit}>
            <h2 id="create-staff-modal-title" className={styles.modalTitle}>
              Create Staff Account
            </h2>
            <p className={styles.modalText}>
              Provision a privileged Manager or Kitchen Staff (KDS) account. Only three canonical roles exist across SavoryBites.
            </p>

            {createError && (
              <div className={styles.bannerError} role="alert">
                {createError}
              </div>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="create-staff-name" className={styles.formLabel}>
                Full Name
              </label>
              <input
                id="create-staff-name"
                type="text"
                required
                minLength={2}
                maxLength={150}
                className={styles.inputControl}
                placeholder="e.g., Marco Reyes"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="create-staff-email" className={styles.formLabel}>
                Work Email
              </label>
              <input
                id="create-staff-email"
                type="email"
                required
                className={styles.inputControl}
                placeholder="marco.reyes@savorybites.local"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="create-staff-role" className={styles.formLabel}>
                Operational Role
              </label>
              <select
                id="create-staff-role"
                className={styles.selectControl}
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as StaffRole)}
              >
                <option value="kitchen_staff">Kitchen Staff (KDS)</option>
                <option value="manager">Manager</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="create-staff-password" className={styles.formLabel}>
                Initial Password
              </label>
              <div className={styles.passwordWrapper}>
                <input
                  id="create-staff-password"
                  type={showPassword ? "text" : "password"}
                  required
                  maxLength={128}
                  className={styles.inputControl}
                  placeholder="Minimum 12 strong characters"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.togglePwdBtn}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <ul className={styles.policyList} aria-label="Password policy requirements">
                <li
                  className={`${styles.policyItem} ${
                    passwordChecks.length ? styles.policyItemMet : ""
                  }`}
                >
                  {passwordChecks.length ? "✓" : "○"} 12+ characters
                </li>
                <li
                  className={`${styles.policyItem} ${
                    passwordChecks.upper ? styles.policyItemMet : ""
                  }`}
                >
                  {passwordChecks.upper ? "✓" : "○"} Uppercase letter (A–Z)
                </li>
                <li
                  className={`${styles.policyItem} ${
                    passwordChecks.lower ? styles.policyItemMet : ""
                  }`}
                >
                  {passwordChecks.lower ? "✓" : "○"} Lowercase letter (a–z)
                </li>
                <li
                  className={`${styles.policyItem} ${
                    passwordChecks.digit ? styles.policyItemMet : ""
                  }`}
                >
                  {passwordChecks.digit ? "✓" : "○"} Numeric digit (0–9)
                </li>
                <li
                  className={`${styles.policyItem} ${
                    passwordChecks.special ? styles.policyItemMet : ""
                  }`}
                >
                  {passwordChecks.special ? "✓" : "○"} Special character (!@#...)
                </li>
              </ul>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                disabled={creating}
                onClick={() => {
                  setCreatePassword("");
                  setCreateModalOpen(false);
                }}
              >
                Cancel
              </button>
              <button type="submit" className={styles.modalConfirmBtn} disabled={creating}>
                {creating ? "Creating..." : "Create Account"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmMutation && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-staff-mutation-title"
        >
          <div className={styles.modalDialog}>
            <h2 id="confirm-staff-mutation-title" className={styles.modalTitle}>
              {confirmMutation.kind === "status"
                ? `${confirmMutation.nextStatus === "active" ? "Reactivate" : "Deactivate"} ${confirmMutation.staff.name}?`
                : `Change Role for ${confirmMutation.staff.name}?`}
            </h2>
            {confirmMutation.kind === "status" ? (
              <p className={styles.modalText}>
                {confirmMutation.nextStatus === "inactive"
                  ? "Deactivating this account immediately blocks login and invalidates any active staff sessions. Account history and audit logs are preserved."
                  : "Reactivating this account restores staff sign-in access under their assigned role."}
              </p>
            ) : (
              <p className={styles.modalText}>
                Switch role from <strong>{ROLE_LABELS[confirmMutation.staff.role]}</strong> to{" "}
                <strong>{ROLE_LABELS[confirmMutation.nextRole]}</strong>. Existing sessions will be invalidated and must re-authenticate for the new portal scope.
                {currentStaff?.id === confirmMutation.staff.id &&
                confirmMutation.nextRole !== "manager"
                  ? " Warning: Demoting your own Manager account will immediately revoke your access to the Manager Portal."
                  : ""}
              </p>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                disabled={mutating}
                onClick={() => setConfirmMutation(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutating}
                className={`${styles.modalConfirmBtn} ${
                  confirmMutation.kind === "status" && confirmMutation.nextStatus === "inactive"
                    ? styles.modalConfirmDanger
                    : ""
                }`}
                onClick={handleConfirmMutation}
              >
                {mutating ? "Applying..." : "Confirm Change"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
