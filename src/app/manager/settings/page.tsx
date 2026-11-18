"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { notifyRestaurantSettingsChanged } from "../../../components/settings/RestaurantSettingsProvider";
import { useTheme } from "../../../components/theme/ThemeProvider";
import { MonitorIcon, MoonIcon, RefreshIcon, SunIcon } from "../../../components/ui/Icons";
import {
  changeStaffPassword,
  getCurrentStaff,
  getManagerSettings,
  StaffApiError,
  updateManagerBusinessHours,
  updateManagerNotificationSettings,
  updateManagerOrderingSettings,
  updateManagerPaymentMethod,
  updateManagerRestaurantInfo,
} from "../../../lib/api/staff";
import type { ThemePreference } from "../../../types/auth";
import type {
  BusinessHourEntry,
  ManagerSettingsResponse,
  NotificationPolicyConfig,
  OrderingPolicyConfig,
  RestaurantInfoConfig,
  StaffUser,
} from "../../../types/staff";
import styles from "./settings.module.css";

type SettingsSection =
  | "restaurant"
  | "hours"
  | "ordering"
  | "payments"
  | "notifications"
  | "appearance"
  | "account";

const SECTION_ITEMS: Array<{ id: SettingsSection; label: string }> = [
  { id: "restaurant", label: "Restaurant Info" },
  { id: "hours", label: "Business Hours" },
  { id: "ordering", label: "Ordering & Channels" },
  { id: "payments", label: "Payment Methods" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account & System" },
];

const THEME_OPTIONS: Array<{
  id: ThemePreference;
  shortLabel: string;
  title: string;
  description: string;
}> = [
  {
    id: "light",
    shortLabel: "Light",
    title: "Warm Cream (Light)",
    description: "Classic SavoryBites cream surfaces and high-clarity forest green accents.",
  },
  {
    id: "dark",
    shortLabel: "Dark",
    title: "Deep Forest (Dark)",
    description: "Reduced-glare evening palette comfortable for back-of-house and low-light shifts.",
  },
  {
    id: "system",
    shortLabel: "System",
    title: "Match Device",
    description: "Automatically follows your operating system light or dark preference.",
  },
];

function renderThemeIcon(mode: ThemePreference, size = 16) {
  if (mode === "light") return <SunIcon size={size} />;
  if (mode === "dark") return <MoonIcon size={size} />;
  return <MonitorIcon size={size} />;
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

export default function ManagerSettingsPage() {
  const router = useRouter();
  const { theme, resolvedTheme, setThemePreference } = useTheme();
  const [section, setSection] = useState<SettingsSection>("restaurant");
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);

  const [persisted, setPersisted] = useState<ManagerSettingsResponse | null>(null);
  const [currentStaff, setCurrentStaff] = useState<StaffUser | null>(null);

  // Editable form drafts
  const [infoDraft, setInfoDraft] = useState<RestaurantInfoConfig | null>(null);
  const [hoursDraft, setHoursDraft] = useState<BusinessHourEntry[]>([]);
  const [orderingDraft, setOrderingDraft] = useState<OrderingPolicyConfig | null>(null);
  const [minOrderText, setMinOrderText] = useState("0.00");
  const [notifDraft, setNotifDraft] = useState<NotificationPolicyConfig | null>(null);

  // Personal password change draft
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingPmId, setTogglingPmId] = useState<number | null>(null);
  const [confirmOrderingModal, setConfirmOrderingModal] = useState(false);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [refreshNonce, setRefreshNonce] = useState(0);

  const syncDraftsFromServer = useCallback((data: ManagerSettingsResponse) => {
    setPersisted(data);
    setInfoDraft({ ...data.restaurant });
    setHoursDraft(data.hours.map((h) => ({ ...h })));
    setOrderingDraft({ ...data.ordering });
    setMinOrderText(data.ordering.minimum_order_amount.toFixed(2));
    setNotifDraft({ ...data.notifications });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getManagerSettings(controller.signal),
      getCurrentStaff().catch(() => null),
    ])
      .then(([loaded, me]) => {
        if (controller.signal.aborted) return;
        syncDraftsFromServer(loaded);
        if (me) setCurrentStaff(me);
        setFeedback((prev) => (prev?.type === "error" ? null : prev));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof StaffApiError && err.status === 401) {
          router.replace("/staff/login");
          return;
        }
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to load restaurant settings.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshNonce, router, syncDraftsFromServer]);

  const restaurantDirty = Boolean(
    persisted &&
      infoDraft &&
      JSON.stringify(persisted.restaurant) !== JSON.stringify(infoDraft)
  );
  const hoursDirty = Boolean(
    persisted && JSON.stringify(persisted.hours) !== JSON.stringify(hoursDraft)
  );
  const orderingDirty = Boolean(
    persisted &&
      orderingDraft &&
      (persisted.ordering.online_ordering_enabled !== orderingDraft.online_ordering_enabled ||
        (persisted.ordering.online_ordering_pause_reason ?? "") !==
          (orderingDraft.online_ordering_pause_reason ?? "") ||
        persisted.ordering.dine_in_enabled !== orderingDraft.dine_in_enabled ||
        persisted.ordering.takeout_enabled !== orderingDraft.takeout_enabled ||
        persisted.ordering.enforce_operating_hours !== orderingDraft.enforce_operating_hours ||
        persisted.ordering.kitchen_cutoff_minutes !== orderingDraft.kitchen_cutoff_minutes ||
        persisted.ordering.minimum_order_amount.toFixed(2) !==
          (Number.isFinite(Number(minOrderText)) ? Number(minOrderText).toFixed(2) : minOrderText))
  );
  const notificationsDirty = Boolean(
    persisted &&
      notifDraft &&
      (persisted.notifications.send_order_confirmation_emails !==
        notifDraft.send_order_confirmation_emails ||
        persisted.notifications.send_contact_inquiry_emails !==
          notifDraft.send_contact_inquiry_emails)
  );

  const isSectionDirty = (sec: SettingsSection): boolean => {
    if (sec === "restaurant") return restaurantDirty;
    if (sec === "hours") return hoursDirty;
    if (sec === "ordering") return orderingDirty;
    if (sec === "notifications") return notificationsDirty;
    return false;
  };

  const anyUnsavedChanges =
    restaurantDirty || hoursDirty || orderingDirty || notificationsDirty;

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!anyUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [anyUnsavedChanges]);

  useEffect(() => {
    if (!confirmOrderingModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) {
        setConfirmOrderingModal(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmOrderingModal, saving]);

  function handleSelectSection(next: SettingsSection) {
    if (next === section) return;
    setFeedback(null);
    if (isSectionDirty(section)) {
      setPendingSection(next);
      return;
    }
    setPendingSection(null);
    setSection(next);
  }

  function handleDiscardAndSwitch() {
    if (!pendingSection || !persisted) return;
    syncDraftsFromServer(persisted);
    setSection(pendingSection);
    setPendingSection(null);
  }

  async function handleSaveRestaurant(e: FormEvent) {
    e.preventDefault();
    if (!infoDraft || !persisted) return;
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await updateManagerRestaurantInfo({
        name: infoDraft.name.trim(),
        tagline: infoDraft.tagline.trim(),
        locality: infoDraft.locality.trim(),
        full_address: infoDraft.full_address.trim(),
        phone: infoDraft.phone.trim(),
        email: infoDraft.email.trim(),
        kitchen_notice: infoDraft.kitchen_notice.trim(),
        holiday_notice: infoDraft.holiday_notice.trim(),
        expected_version: persisted.system_info.version,
      });
      syncDraftsFromServer(updated);
      notifyRestaurantSettingsChanged();
      setFeedback({
        type: "success",
        text: "Restaurant information saved and published to public pages.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save restaurant information.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveHours(e: FormEvent) {
    e.preventDefault();
    if (!persisted) return;
    const sameTimeDay = hoursDraft.find(
      (h) => h.is_open && h.open_time === h.close_time
    );
    if (sameTimeDay) {
      setFeedback({
        type: "error",
        text: `${sameTimeDay.day_name}: opening and closing times cannot be the same.`,
      });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await updateManagerBusinessHours({
        hours: hoursDraft.map((h) => ({
          day_of_week: h.day_of_week,
          is_open: h.is_open,
          open_time: h.open_time,
          close_time: h.close_time,
        })),
        expected_version: persisted.system_info.version,
      });
      syncDraftsFromServer(updated);
      notifyRestaurantSettingsChanged();
      setFeedback({
        type: "success",
        text: "Weekly operating hours updated in Asia/Manila.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save business hours.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function commitOrderingSave() {
    if (!orderingDraft || !persisted) return;
    const parsedMin = Number(minOrderText);
    if (Number.isNaN(parsedMin) || parsedMin < 0 || parsedMin > 100000) {
      setFeedback({
        type: "error",
        text: "Minimum order amount must be between PHP 0.00 and PHP 100,000.00.",
      });
      setConfirmOrderingModal(false);
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await updateManagerOrderingSettings({
        online_ordering_enabled: orderingDraft.online_ordering_enabled,
        online_ordering_pause_reason: orderingDraft.online_ordering_pause_reason?.trim() || null,
        dine_in_enabled: orderingDraft.dine_in_enabled,
        takeout_enabled: orderingDraft.takeout_enabled,
        enforce_operating_hours: orderingDraft.enforce_operating_hours,
        kitchen_cutoff_minutes: orderingDraft.kitchen_cutoff_minutes,
        minimum_order_amount: Number(parsedMin.toFixed(2)),
        expected_version: persisted.system_info.version,
      });
      syncDraftsFromServer(updated);
      notifyRestaurantSettingsChanged();
      setConfirmOrderingModal(false);
      setFeedback({
        type: "success",
        text: "Ordering and fulfillment policies updated cleanly.",
      });
    } catch (err) {
      setConfirmOrderingModal(false);
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update ordering policies.",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleOrderingSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orderingDraft || !persisted) return;
    if (
      orderingDraft.online_ordering_enabled &&
      !orderingDraft.dine_in_enabled &&
      !orderingDraft.takeout_enabled
    ) {
      setFeedback({
        type: "error",
        text: "Enable at least Dine-In or Takeout when online ordering is active.",
      });
      return;
    }
    const isPausingOrdering =
      !orderingDraft.online_ordering_enabled ||
      (persisted.ordering.dine_in_enabled && !orderingDraft.dine_in_enabled) ||
      (persisted.ordering.takeout_enabled && !orderingDraft.takeout_enabled) ||
      (!persisted.ordering.enforce_operating_hours && orderingDraft.enforce_operating_hours);

    if (isPausingOrdering) {
      setConfirmOrderingModal(true);
      return;
    }
    void commitOrderingSave();
  }

  async function handleSaveNotifications(e: FormEvent) {
    e.preventDefault();
    if (!notifDraft || !persisted) return;
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await updateManagerNotificationSettings({
        send_order_confirmation_emails: notifDraft.send_order_confirmation_emails,
        send_contact_inquiry_emails: notifDraft.send_contact_inquiry_emails,
        expected_version: persisted.system_info.version,
      });
      syncDraftsFromServer(updated);
      setFeedback({
        type: "success",
        text: "Transactional email notification preferences saved.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save notification settings.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePaymentMethod(pmId: number, currentActive: boolean, updatedAt: string) {
    setTogglingPmId(pmId);
    setFeedback(null);
    try {
      await updateManagerPaymentMethod(pmId, {
        is_active: !currentActive,
        expected_updated_at: updatedAt,
      });
      setRefreshNonce((n) => n + 1);
      setFeedback({
        type: "success",
        text: `Payment method ${!currentActive ? "enabled" : "disabled"} for customer checkout.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to toggle payment method.",
      });
    } finally {
      setTogglingPmId(null);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const checks = getPasswordChecks(newPassword);
    if (!Object.values(checks).every(Boolean)) {
      setFeedback({
        type: "error",
        text: "New password must satisfy all 5 password strength requirements.",
      });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setFeedback({
        type: "error",
        text: "New password and confirmation do not match.",
      });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await changeStaffPassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setFeedback({ type: "success", text: res.message });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Password change failed.",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  const pwdChecks = getPasswordChecks(newPassword);

  return (
    <div className={styles.workspace}>
      <header className={styles.headerRow}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.title}>Restaurant Settings</h1>
          <p className={styles.subtitle}>
            Configure public restaurant identity, Asia/Manila service hours, checkout rules, and Manager account security.
          </p>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.themeSwitcherPill} role="group" aria-label="Portal appearance theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`${styles.themePillBtn} ${theme === opt.id ? styles.themePillBtnActive : ""}`}
                aria-pressed={theme === opt.id}
                onClick={() => setThemePreference(opt.id)}
              >
                {renderThemeIcon(opt.id, 14)}
                <span>{opt.shortLabel}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setPendingSection(null);
              setRefreshNonce((n) => n + 1);
            }}
          >
            <RefreshIcon size={15} className={loading ? styles.spinningIcon : undefined} />
            <span>{loading ? "Reloading..." : "Reload Persisted"}</span>
          </button>
        </div>
      </header>

      <div className={styles.shellGrid}>
        <nav className={styles.sectionNav} aria-label="Settings sections">
          {SECTION_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navBtn} ${section === item.id ? styles.navBtnActive : ""}`}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => handleSelectSection(item.id)}
            >
              <span>{item.label}</span>
              {isSectionDirty(item.id) && (
                <span className={styles.dirtyDot} title="Unsaved changes" />
              )}
            </button>
          ))}
        </nav>

        <div className={styles.contentColumn}>
          {pendingSection && (
            <div className={styles.bannerWarn} role="alert">
              <span>
                You have unsaved changes in this section. Discard edits and switch sections?
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setPendingSection(null)}
                >
                  Stay Here
                </button>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={handleDiscardAndSwitch}
                >
                  Discard &amp; Switch
                </button>
              </div>
            </div>
          )}

          {feedback && (
            <div
              className={feedback.type === "error" ? styles.bannerError : styles.bannerSuccess}
              role={feedback.type === "error" ? "alert" : "status"}
            >
              <span>{feedback.text}</span>
              {feedback.type === "error" && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => {
                    setLoading(true);
                    setRefreshNonce((n) => n + 1);
                  }}
                >
                  Reload Latest
                </button>
              )}
            </div>
          )}

          {loading && !persisted ? (
            <div className={styles.card}>
              <p className={styles.sectionDesc}>Loading authoritative restaurant configuration...</p>
            </div>
          ) : (
            <>
              {/* 1. RESTAURANT INFO */}
              {section === "restaurant" && infoDraft && (
                <form className={styles.card} onSubmit={handleSaveRestaurant}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Restaurant Information</h2>
                    <p className={styles.sectionDesc}>
                      Public contact details and storefront metadata rendered in Footer, Hours, and Location pages.
                    </p>
                  </div>

                  <div className={styles.formGridTwo}>
                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-rest-name" className={styles.fieldLabel}>
                        Restaurant Name
                      </label>
                      <input
                        id="set-rest-name"
                        type="text"
                        required
                        minLength={2}
                        maxLength={120}
                        className={styles.inputControl}
                        value={infoDraft.name}
                        onChange={(e) => setInfoDraft({ ...infoDraft, name: e.target.value })}
                      />
                    </div>

                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-rest-locality" className={styles.fieldLabel}>
                        City / Locality
                      </label>
                      <input
                        id="set-rest-locality"
                        type="text"
                        required
                        minLength={2}
                        maxLength={150}
                        className={styles.inputControl}
                        value={infoDraft.locality}
                        onChange={(e) => setInfoDraft({ ...infoDraft, locality: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label htmlFor="set-rest-tagline" className={styles.fieldLabel}>
                      Tagline
                    </label>
                    <input
                      id="set-rest-tagline"
                      type="text"
                      required
                      minLength={2}
                      maxLength={200}
                      className={styles.inputControl}
                      value={infoDraft.tagline}
                      onChange={(e) => setInfoDraft({ ...infoDraft, tagline: e.target.value })}
                    />
                  </div>

                  <div className={styles.formGridTwo}>
                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-rest-phone" className={styles.fieldLabel}>
                        Public Telephone
                      </label>
                      <input
                        id="set-rest-phone"
                        type="tel"
                        required
                        className={styles.inputControl}
                        value={infoDraft.phone}
                        onChange={(e) => setInfoDraft({ ...infoDraft, phone: e.target.value })}
                      />
                    </div>

                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-rest-email" className={styles.fieldLabel}>
                        Public Contact Email
                      </label>
                      <input
                        id="set-rest-email"
                        type="email"
                        required
                        className={styles.inputControl}
                        value={infoDraft.email}
                        onChange={(e) => setInfoDraft({ ...infoDraft, email: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label htmlFor="set-rest-address" className={styles.fieldLabel}>
                      Full Street Address
                    </label>
                    <input
                      id="set-rest-address"
                      type="text"
                      required
                      minLength={5}
                      maxLength={300}
                      className={styles.inputControl}
                      value={infoDraft.full_address}
                      onChange={(e) => setInfoDraft({ ...infoDraft, full_address: e.target.value })}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label htmlFor="set-rest-kitchen-notice" className={styles.fieldLabel}>
                      Kitchen Cut-off Notice
                    </label>
                    <textarea
                      id="set-rest-kitchen-notice"
                      required
                      minLength={5}
                      maxLength={500}
                      className={styles.textareaControl}
                      value={infoDraft.kitchen_notice}
                      onChange={(e) =>
                        setInfoDraft({ ...infoDraft, kitchen_notice: e.target.value })
                      }
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label htmlFor="set-rest-holiday-notice" className={styles.fieldLabel}>
                      Holiday Schedule Notice
                    </label>
                    <textarea
                      id="set-rest-holiday-notice"
                      required
                      minLength={5}
                      maxLength={500}
                      className={styles.textareaControl}
                      value={infoDraft.holiday_notice}
                      onChange={(e) =>
                        setInfoDraft({ ...infoDraft, holiday_notice: e.target.value })
                      }
                    />
                  </div>

                  <div className={styles.formFooter}>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={!restaurantDirty || saving}
                      onClick={() => persisted && syncDraftsFromServer(persisted)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.btnPrimary}
                      disabled={!restaurantDirty || saving}
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              )}

              {/* 2. BUSINESS HOURS */}
              {section === "hours" && (
                <form className={styles.card} onSubmit={handleSaveHours}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Weekly Business Hours (Asia/Manila)</h2>
                    <p className={styles.sectionDesc}>
                      Configure opening and closing hours per weekday. Same-day or overnight shifts are supported; existing accepted orders remain valid across schedule updates.
                    </p>
                  </div>

                  <div className={styles.hoursList}>
                    {hoursDraft.map((day, idx) => (
                      <div key={day.day_of_week} className={styles.hoursRow}>
                        <span className={styles.hoursDayLabel}>{day.day_name}</span>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.82rem" }}>
                          <input
                            type="checkbox"
                            checked={day.is_open}
                            onChange={(e) => {
                              const next = hoursDraft.map((item, i) =>
                                i === idx ? { ...item, is_open: e.target.checked } : item
                              );
                              setHoursDraft(next);
                            }}
                          />
                          <span>{day.is_open ? "Open" : "Closed"}</span>
                        </label>
                        <input
                          type="time"
                          className={styles.timeInput}
                          aria-label={`${day.day_name} opening time`}
                          disabled={!day.is_open}
                          value={day.open_time}
                          onChange={(e) => {
                            const next = hoursDraft.map((item, i) =>
                              i === idx ? { ...item, open_time: e.target.value } : item
                            );
                            setHoursDraft(next);
                          }}
                        />
                        <span className={styles.hoursSep}>to</span>
                        <input
                          type="time"
                          className={styles.timeInput}
                          aria-label={`${day.day_name} closing time`}
                          disabled={!day.is_open}
                          value={day.close_time}
                          onChange={(e) => {
                            const next = hoursDraft.map((item, i) =>
                              i === idx ? { ...item, close_time: e.target.value } : item
                            );
                            setHoursDraft(next);
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  <div className={styles.formFooter}>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={!hoursDirty || saving}
                      onClick={() => persisted && syncDraftsFromServer(persisted)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.btnPrimary}
                      disabled={!hoursDirty || saving}
                    >
                      {saving ? "Saving..." : "Save Schedule"}
                    </button>
                  </div>
                </form>
              )}

              {/* 3. ORDERING & CHANNELS */}
              {section === "ordering" && orderingDraft && (
                <form className={styles.card} onSubmit={handleOrderingSubmit}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Ordering &amp; Fulfillment Policies</h2>
                    <p className={styles.sectionDesc}>
                      Enforced directly on backend checkout order placement. Accepted active orders and KDS preparation continue unaffected.
                    </p>
                  </div>

                  <div className={styles.switchRow}>
                    <div className={styles.switchInfo}>
                      <span className={styles.switchTitle}>Accept New Online Orders</span>
                      <span className={styles.switchDesc}>
                        When paused, customers can still browse the menu and track existing orders, while new checkouts are rejected server-side.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={orderingDraft.online_ordering_enabled}
                      aria-label="Accept new online orders"
                      className={`${styles.switchBtn} ${
                        orderingDraft.online_ordering_enabled ? styles.switchBtnOn : ""
                      }`}
                      onClick={() =>
                        setOrderingDraft({
                          ...orderingDraft,
                          online_ordering_enabled: !orderingDraft.online_ordering_enabled,
                        })
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  {!orderingDraft.online_ordering_enabled && (
                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-pause-reason" className={styles.fieldLabel}>
                        Customer Pause Message (Optional)
                      </label>
                      <input
                        id="set-pause-reason"
                        type="text"
                        maxLength={300}
                        className={styles.inputControl}
                        placeholder="e.g., Kitchen paused for scheduled maintenance until 2:00 PM."
                        value={orderingDraft.online_ordering_pause_reason ?? ""}
                        onChange={(e) =>
                          setOrderingDraft({
                            ...orderingDraft,
                            online_ordering_pause_reason: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}

                  <div className={styles.switchRow}>
                    <div className={styles.switchInfo}>
                      <span className={styles.switchTitle}>Dine-In Table Service</span>
                      <span className={styles.switchDesc}>
                        Allow customers to place seated table-service orders (tables managed under Floor Management).
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={orderingDraft.dine_in_enabled}
                      aria-label="Dine-in table service"
                      className={`${styles.switchBtn} ${
                        orderingDraft.dine_in_enabled ? styles.switchBtnOn : ""
                      }`}
                      onClick={() =>
                        setOrderingDraft({
                          ...orderingDraft,
                          dine_in_enabled: !orderingDraft.dine_in_enabled,
                        })
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.switchRow}>
                    <div className={styles.switchInfo}>
                      <span className={styles.switchTitle}>Takeout Counter Pickup</span>
                      <span className={styles.switchDesc}>
                        Allow customers to place counter pickup orders. (Delivery is currently not offered by SavoryBites.)
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={orderingDraft.takeout_enabled}
                      aria-label="Takeout counter pickup"
                      className={`${styles.switchBtn} ${
                        orderingDraft.takeout_enabled ? styles.switchBtnOn : ""
                      }`}
                      onClick={() =>
                        setOrderingDraft({
                          ...orderingDraft,
                          takeout_enabled: !orderingDraft.takeout_enabled,
                        })
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.switchRow}>
                    <div className={styles.switchInfo}>
                      <span className={styles.switchTitle}>Enforce Business Hours on Checkout</span>
                      <span className={styles.switchDesc}>
                        Automatically reject new checkout submissions outside scheduled open hours and cut-off window.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={orderingDraft.enforce_operating_hours}
                      aria-label="Enforce business hours on checkout"
                      className={`${styles.switchBtn} ${
                        orderingDraft.enforce_operating_hours ? styles.switchBtnOn : ""
                      }`}
                      onClick={() =>
                        setOrderingDraft({
                          ...orderingDraft,
                          enforce_operating_hours: !orderingDraft.enforce_operating_hours,
                        })
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formGridTwo}>
                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-cutoff-mins" className={styles.fieldLabel}>
                        Kitchen Cut-off Buffer (Minutes)
                      </label>
                      <input
                        id="set-cutoff-mins"
                        type="number"
                        min={0}
                        max={180}
                        required
                        className={styles.inputControl}
                        value={orderingDraft.kitchen_cutoff_minutes}
                        onChange={(e) =>
                          setOrderingDraft({
                            ...orderingDraft,
                            kitchen_cutoff_minutes: Math.max(0, Math.min(180, Number(e.target.value) || 0)),
                          })
                        }
                      />
                      <span className={styles.fieldHint}>
                        Minutes before closing when new orders stop (when hours enforcement is active).
                      </span>
                    </div>

                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-min-order" className={styles.fieldLabel}>
                        Minimum Order Amount (PHP)
                      </label>
                      <input
                        id="set-min-order"
                        type="number"
                        step="0.01"
                        min={0}
                        max={100000}
                        required
                        className={styles.inputControl}
                        value={minOrderText}
                        onChange={(e) => setMinOrderText(e.target.value)}
                      />
                      <span className={styles.fieldHint}>
                        Set to 0.00 to accept orders of any subtotal.
                      </span>
                    </div>
                  </div>

                  <div className={styles.formFooter}>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={!orderingDirty || saving}
                      onClick={() => persisted && syncDraftsFromServer(persisted)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.btnPrimary}
                      disabled={!orderingDirty || saving}
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              )}

              {/* 4. PAYMENT METHODS */}
              {section === "payments" && persisted && (
                <section className={styles.card}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Payment Method Availability</h2>
                    <p className={styles.sectionDesc}>
                      Controls which configured methods appear at customer checkout. Full reconciliation, labels, and method creation live in{" "}
                      <Link href="/manager/payments" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                        Payments Management
                      </Link>
                      .
                    </p>
                  </div>

                  {persisted.payment_methods.map((pm) => (
                    <div key={pm.id} className={styles.switchRow}>
                      <div className={styles.switchInfo}>
                        <span className={styles.switchTitle}>
                          {pm.label} ({pm.code})
                        </span>
                        <span className={styles.switchDesc}>
                          {pm.description || "Supported restaurant payment method"} · {pm.orders_count} historical orders
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={pm.is_active}
                        aria-label={`Toggle ${pm.label}`}
                        disabled={togglingPmId === pm.id}
                        className={`${styles.switchBtn} ${pm.is_active ? styles.switchBtnOn : ""}`}
                        onClick={() =>
                          void handleTogglePaymentMethod(pm.id, pm.is_active, pm.updated_at)
                        }
                      >
                        <span className={styles.switchThumb} />
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {/* 5. NOTIFICATIONS */}
              {section === "notifications" && notifDraft && (
                <form className={styles.card} onSubmit={handleSaveNotifications}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Email Notification Triggers</h2>
                    <p className={styles.sectionDesc}>
                      Controls backed transactional email notifications. Deployment SMTP credentials remain restricted to environment secrets.
                    </p>
                  </div>

                  <div className={styles.switchRow}>
                    <div className={styles.switchInfo}>
                      <span className={styles.switchTitle}>Mail Transport Readiness</span>
                      <span className={styles.switchDesc}>
                        {notifDraft.smtp_configured
                          ? "Production SMTP relay host configured."
                          : "Running in local development log/outbox mode (no external SMTP relay configured)."}
                      </span>
                    </div>
                    <span
                      className={`${styles.statusPill} ${
                        notifDraft.smtp_configured ? styles.statusOk : styles.statusMuted
                      }`}
                    >
                      {notifDraft.smtp_configured ? "SMTP Ready" : "Dev Outbox Mode"}
                    </span>
                  </div>

                  <div className={styles.switchRow}>
                    <div className={styles.switchInfo}>
                      <span className={styles.switchTitle}>Customer Order Confirmation Emails</span>
                      <span className={styles.switchDesc}>
                        Send order confirmation emails after checkout for guests who opt in to order updates.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifDraft.send_order_confirmation_emails}
                      aria-label="Customer order confirmation emails"
                      className={`${styles.switchBtn} ${
                        notifDraft.send_order_confirmation_emails ? styles.switchBtnOn : ""
                      }`}
                      onClick={() =>
                        setNotifDraft({
                          ...notifDraft,
                          send_order_confirmation_emails: !notifDraft.send_order_confirmation_emails,
                        })
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.switchRow}>
                    <div className={styles.switchInfo}>
                      <span className={styles.switchTitle}>Guest Contact Inquiry Emails</span>
                      <span className={styles.switchDesc}>
                        Dispatch incoming submissions from /contact to the configured restaurant inbox.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifDraft.send_contact_inquiry_emails}
                      aria-label="Guest contact inquiry emails"
                      className={`${styles.switchBtn} ${
                        notifDraft.send_contact_inquiry_emails ? styles.switchBtnOn : ""
                      }`}
                      onClick={() =>
                        setNotifDraft({
                          ...notifDraft,
                          send_contact_inquiry_emails: !notifDraft.send_contact_inquiry_emails,
                        })
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formFooter}>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={!notificationsDirty || saving}
                      onClick={() => persisted && syncDraftsFromServer(persisted)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.btnPrimary}
                      disabled={!notificationsDirty || saving}
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              )}

              {/* 6. APPEARANCE */}
              {section === "appearance" && (
                <section className={styles.card}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Appearance &amp; Theme</h2>
                    <p className={styles.sectionDesc}>
                      Switch between Light, Dark, or System appearance across this browser&apos;s Manager Portal and storefront views.
                    </p>
                  </div>

                  <div className={styles.themeCardsGrid} role="radiogroup" aria-label="Theme mode selection">
                    {THEME_OPTIONS.map((opt) => {
                      const isActive = theme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          className={`${styles.themeCard} ${isActive ? styles.themeCardActive : ""}`}
                          onClick={() => setThemePreference(opt.id)}
                        >
                          <div className={styles.themeCardTop}>
                            {renderThemeIcon(opt.id, 20)}
                            {isActive && <span className={styles.themeCardBadge}>Active</span>}
                          </div>
                          <span className={styles.themeCardTitle}>{opt.title}</span>
                          <span className={styles.themeCardDesc}>{opt.description}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className={styles.themeStatusNote}>
                    Active preference: <strong>{THEME_OPTIONS.find((o) => o.id === theme)?.title}</strong>{" "}
                    (currently rendering <strong>{resolvedTheme === "dark" ? "Dark" : "Light"}</strong> surfaces).
                    Changes apply immediately and are saved to this browser only.
                  </div>
                </section>
              )}

              {/* 7. ACCOUNT & SYSTEM */}
              {section === "account" && persisted && (
                <>
                  <section className={styles.card}>
                    <div className={styles.sectionHeader}>
                      <h2 className={styles.sectionTitle}>Signed-In Manager Account</h2>
                      <p className={styles.sectionDesc}>
                        Personal session identity. Staff role provisioning and audit logs remain separated in{" "}
                        <Link href="/manager/user" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                          User Management
                        </Link>
                        .
                      </p>
                    </div>

                    <div className={styles.metaGrid}>
                      <div className={styles.metaTile}>
                        <span className={styles.metaLabel}>Account Name</span>
                        <span className={styles.metaValue}>{currentStaff?.name || "Manager"}</span>
                      </div>
                      <div className={styles.metaTile}>
                        <span className={styles.metaLabel}>Work Email</span>
                        <span className={styles.metaValue}>{currentStaff?.email || "—"}</span>
                      </div>
                      <div className={styles.metaTile}>
                        <span className={styles.metaLabel}>Timezone</span>
                        <span className={styles.metaValue}>{persisted.system_info.timezone}</span>
                      </div>
                      <div className={styles.metaTile}>
                        <span className={styles.metaLabel}>Staff Session TTL</span>
                        <span className={styles.metaValue}>
                          {persisted.system_info.staff_session_timeout_minutes} minutes (Env: {persisted.system_info.environment})
                        </span>
                      </div>
                    </div>
                  </section>

                  <form className={styles.card} onSubmit={handlePasswordSubmit}>
                    <div className={styles.sectionHeader}>
                      <h2 className={styles.sectionTitle}>Change Your Password</h2>
                      <p className={styles.sectionDesc}>
                        Requires current password verification and enforces 12-character enterprise staff complexity.
                      </p>
                    </div>

                    <div className={styles.fieldGroup}>
                      <label htmlFor="set-cur-pwd" className={styles.fieldLabel}>
                        Current Password
                      </label>
                      <input
                        id="set-cur-pwd"
                        type="password"
                        required
                        className={styles.inputControl}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </div>

                    <div className={styles.formGridTwo}>
                      <div className={styles.fieldGroup}>
                        <label htmlFor="set-new-pwd" className={styles.fieldLabel}>
                          New Password
                        </label>
                        <input
                          id="set-new-pwd"
                          type="password"
                          required
                          minLength={12}
                          maxLength={128}
                          className={styles.inputControl}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                      </div>

                      <div className={styles.fieldGroup}>
                        <label htmlFor="set-conf-pwd" className={styles.fieldLabel}>
                          Confirm New Password
                        </label>
                        <input
                          id="set-conf-pwd"
                          type="password"
                          required
                          minLength={12}
                          maxLength={128}
                          className={styles.inputControl}
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                        />
                      </div>
                    </div>

                    <ul className={styles.policyList} aria-label="Password strength requirements">
                      <li className={`${styles.policyItem} ${pwdChecks.length ? styles.policyItemMet : ""}`}>
                        {pwdChecks.length ? "✓" : "○"} 12+ characters
                      </li>
                      <li className={`${styles.policyItem} ${pwdChecks.upper ? styles.policyItemMet : ""}`}>
                        {pwdChecks.upper ? "✓" : "○"} Uppercase letter (A–Z)
                      </li>
                      <li className={`${styles.policyItem} ${pwdChecks.lower ? styles.policyItemMet : ""}`}>
                        {pwdChecks.lower ? "✓" : "○"} Lowercase letter (a–z)
                      </li>
                      <li className={`${styles.policyItem} ${pwdChecks.digit ? styles.policyItemMet : ""}`}>
                        {pwdChecks.digit ? "✓" : "○"} Numeric digit (0–9)
                      </li>
                      <li className={`${styles.policyItem} ${pwdChecks.special ? styles.policyItemMet : ""}`}>
                        {pwdChecks.special ? "✓" : "○"} Special character (!@#...)
                      </li>
                    </ul>

                    <div className={styles.formFooter}>
                      <button
                        type="submit"
                        className={styles.btnPrimary}
                        disabled={
                          savingPassword ||
                          !currentPassword ||
                          !newPassword ||
                          !confirmNewPassword
                        }
                      >
                        {savingPassword ? "Updating..." : "Update Password"}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {confirmOrderingModal && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-ordering-policy-title"
        >
          <div className={styles.modalDialog}>
            <h2 id="confirm-ordering-policy-title" className={styles.modalTitle}>
              Apply Order Restriction Policy?
            </h2>
            <p className={styles.modalText}>
              You are pausing online ordering, disabling a service channel, or enabling automatic operating-hours checkout enforcement. Existing accepted orders remain unaffected, while new customer checkout requests outside your configured policy will be rejected by the backend.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={saving}
                onClick={() => setConfirmOrderingModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalDangerBtn}
                disabled={saving}
                onClick={() => void commitOrderingSave()}
              >
                {saving ? "Applying..." : "Confirm Policy Change"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
