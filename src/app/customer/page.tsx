"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { CustomerRouteGuard } from "../../components/auth/CustomerRouteGuard";
import { useAuth } from "../../components/auth/AuthProvider";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { useTheme } from "../../components/theme/ThemeProvider";
import { AllergyConflictNotice } from "../../components/menu/AllergyConflictNotice";
import {
  AlertTriangleIcon,
  BellIcon,
  CameraIcon,
  CloseIcon,
  CreditCardIcon,
  HeartIcon,
  InfoIcon,
  LockIcon,
  LogOutIcon,
  MapPinIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  ReceiptIcon,
  RefreshIcon,
  SlidersIcon,
  SunIcon,
  TrashIcon,
  UserIcon,
} from "../../components/ui/Icons";
import { AuthApiError } from "../../lib/api/auth";
import { getPaymentMethods } from "../../lib/api/payment-methods";
import {
  changeCustomerEmail,
  changeCustomerPassword,
  createCustomerAddress,
  deactivateCustomerAccount,
  deleteCustomerAddress,
  getCustomerAddresses,
  getCustomerFavorites,
  getCustomerProfile,
  removeCustomerAvatar,
  removeCustomerFavorite,
  setDefaultAddress,
  updateCustomerAddress,
  updateCustomerPreferences,
  updateCustomerProfile,
  uploadCustomerAvatar,
} from "../../lib/api/customer";
import { getOrders } from "../../lib/api/orders";
import { getCategories } from "../../lib/api/products";
import {
  ALLERGEN_OPTIONS,
  DIETARY_PREFERENCE_OPTIONS,
  detectDishConflicts,
} from "../../lib/personalization";
import { reorderToCart } from "../../lib/reorder";
import type { ThemePreference } from "../../types/auth";
import type { PaymentMethod } from "../../types/payment-method";
import type {
  AddressCreateInput,
  CustomerAddress,
  CustomerProfile,
  FavoriteProduct,
} from "../../types/customer";
import type { OrderHistory } from "../../types/order";
import type { Category } from "../../types/product";
import styles from "./customer.module.css";

type SectionId =
  | "profile"
  | "orders"
  | "addresses"
  | "favorites"
  | "preferences"
  | "payment"
  | "notifications"
  | "appearance"
  | "security";

const VALID_SECTIONS: SectionId[] = [
  "profile",
  "orders",
  "addresses",
  "favorites",
  "preferences",
  "payment",
  "notifications",
  "appearance",
  "security",
];

const EMPTY_ADDRESS: AddressCreateInput = {
  label: "Home",
  recipient_name: "",
  phone: "",
  street_address: "",
  barangay: "",
  city: "",
  state_province: "",
  postal_code: "",
  delivery_instructions: "",
  is_default: false,
};

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function formatDate(dateStr: string | null | undefined, includeTime = false): string {
  if (!dateStr) return "Not available";
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function getReadableError(err: unknown, fallback: string): string {
  if (err instanceof AuthApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function CustomerAccountContent() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, refreshUser, logout } = useAuth();
  const { setThemePreference } = useTheme();

  const [activeSection, setActiveSection] = useState<SectionId>("profile");
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [orders, setOrders] = useState<OrderHistory | null>(null);
  const [ordersPage, setOrdersPage] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Avatar state
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [pendingAvatarPreview, setPendingAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // Personal info state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  // Email change state
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  // Address modal state
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(null);
  const [addressForm, setAddressForm] = useState<AddressCreateInput>(EMPTY_ADDRESS);
  const [addressBusy, setAddressBusy] = useState(false);

  // Preferences state
  const [defaultOrderType, setDefaultOrderType] = useState<"dine_in" | "takeout" | "">("");
  const [preferredPaymentCode, setPreferredPaymentCode] = useState<string>("");
  const [dietaryPreferences, setDietaryPreferences] = useState<string[]>([]);
  const [allergyFlags, setAllergyFlags] = useState<string[]>([]);
  const [dislikedIngredients, setDislikedIngredients] = useState("");
  const [preferredCategoryIds, setPreferredCategoryIds] = useState<number[]>([]);
  const [allergyConsentGiven, setAllergyConsentGiven] = useState(false);
  const [shareAllergyWithKitchen, setShareAllergyWithKitchen] = useState(true);
  const [emailOrderUpdates, setEmailOrderUpdates] = useState(true);
  const [emailPromotions, setEmailPromotions] = useState(false);
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const [prefsBusy, setPrefsBusy] = useState(false);

  // Security state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [deactivateConfirmed, setDeactivateConfirmed] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [deactivateBusy, setDeactivateBusy] = useState(false);

  const [reorderingOrderId, setReorderingOrderId] = useState<number | null>(null);
  const [failedFavoriteImages, setFailedFavoriteImages] = useState<Set<number>>(new Set());

  const syncFormStateFromProfile = useCallback(
    (loaded: CustomerProfile) => {
      setProfile(loaded);
      setFirstName(loaded.first_name || "");
      setLastName(loaded.last_name || "");
      setPhoneInput(loaded.phone || "");
      setNewEmail(loaded.email || "");
      setDefaultOrderType(loaded.default_order_type || "");
      setPreferredPaymentCode(loaded.preferred_payment_code || "");
      setDietaryPreferences(loaded.dietary_preferences || []);
      setAllergyFlags(loaded.allergy_flags || []);
      setDislikedIngredients(loaded.disliked_ingredients || "");
      setPreferredCategoryIds(loaded.preferred_category_ids || []);
      setAllergyConsentGiven(Boolean(loaded.allergy_consent_given));
      setShareAllergyWithKitchen(Boolean(loaded.share_allergy_with_kitchen));
      setEmailOrderUpdates(Boolean(loaded.email_order_updates));
      setEmailPromotions(Boolean(loaded.email_promotions));
      setThemePref(loaded.theme_preference || "system");
      setThemePreference(loaded.theme_preference || "system");
    },
    [setThemePreference],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const requested = new URLSearchParams(window.location.search).get("tab");
      if (requested && VALID_SECTIONS.includes(requested as SectionId)) {
        setActiveSection(requested as SectionId);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      return;
    }

    let active = true;
    void Promise.all([
      getCustomerProfile(),
      getCustomerAddresses(),
      getCustomerFavorites(),
      getOrders(1),
      getCategories(),
      getPaymentMethods(),
    ])
      .then(([loadedProfile, loadedAddresses, loadedFavorites, loadedOrders, loadedCategories, loadedPayments]) => {
        if (!active) return;
        syncFormStateFromProfile(loadedProfile);
        setAddresses(loadedAddresses);
        setFavorites(loadedFavorites);
        setOrders(loadedOrders);
        setCategories(loadedCategories);
        setPaymentMethods(loadedPayments);
      })
      .catch((err) => {
        if (active) {
          setFeedback({
            type: "error",
            text: getReadableError(err, "Unable to load your account details right now."),
          });
        }
      })
      .finally(() => {
        if (active) setDataLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [authLoading, isAuthenticated, syncFormStateFromProfile]);

  const pageLoading = authLoading || (isAuthenticated && !dataLoaded);

  useEffect(() => {
    return () => {
      if (pendingAvatarPreview) {
        URL.revokeObjectURL(pendingAvatarPreview);
      }
    };
  }, [pendingAvatarPreview]);

  function selectSection(section: SectionId) {
    setActiveSection(section);
    setFeedback(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", section);
      window.history.replaceState(null, "", url.toString());
    }
  }

  async function savePreferencesPayload(overrides?: Partial<{
    preferred_payment_code: string | null;
    default_order_type: "dine_in" | "takeout" | null;
    dietary_preferences: string[];
    allergy_flags: string[];
    disliked_ingredients: string | null;
    preferred_category_ids: number[];
    allergy_consent_given: boolean;
    share_allergy_with_kitchen: boolean;
    email_order_updates: boolean;
    email_promotions: boolean;
    theme_preference: ThemePreference;
  }>, successText = "Preferences saved.") {
    setPrefsBusy(true);
    setFeedback(null);
    try {
      const nextAllergies = overrides?.allergy_flags ?? allergyFlags;
      const nextDisliked =
        overrides && "disliked_ingredients" in overrides
          ? overrides.disliked_ingredients
          : (dislikedIngredients.trim() || null);
      const hasAllergyData = nextAllergies.length > 0 || Boolean(nextDisliked);
      const consentFlag = overrides?.allergy_consent_given ?? allergyConsentGiven;

      if (hasAllergyData && !consentFlag) {
        setFeedback({
          type: "error",
          text: "Please check the allergy consent box before saving allergy or avoided ingredient information.",
        });
        return;
      }

      const updated = await updateCustomerPreferences({
        preferred_payment_code:
          overrides && "preferred_payment_code" in overrides
            ? overrides.preferred_payment_code
            : (preferredPaymentCode || null),
        default_order_type:
          overrides && "default_order_type" in overrides
            ? overrides.default_order_type
            : (defaultOrderType || null),
        dietary_preferences: overrides?.dietary_preferences ?? dietaryPreferences,
        allergy_flags: nextAllergies,
        disliked_ingredients: nextDisliked,
        preferred_category_ids: overrides?.preferred_category_ids ?? preferredCategoryIds,
        allergy_consent_given: consentFlag,
        share_allergy_with_kitchen:
          overrides?.share_allergy_with_kitchen ?? shareAllergyWithKitchen,
        email_order_updates: overrides?.email_order_updates ?? emailOrderUpdates,
        email_promotions: overrides?.email_promotions ?? emailPromotions,
        theme_preference: overrides?.theme_preference ?? themePref,
      });
      syncFormStateFromProfile(updated);
      await refreshUser();
      setFeedback({ type: "success", text: successText });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to save preferences."),
      });
    } finally {
      setPrefsBusy(false);
    }
  }

  function handleAvatarFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFeedback({ type: "error", text: "Please select a JPEG, PNG, or WebP image." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFeedback({ type: "error", text: "Profile photos must be 5 MB or smaller." });
      return;
    }
    if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
    setPendingAvatarFile(file);
    setPendingAvatarPreview(URL.createObjectURL(file));
    setFeedback(null);
  }

  function cancelPendingAvatar() {
    if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
    setPendingAvatarFile(null);
    setPendingAvatarPreview(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  async function handleSaveAvatar() {
    if (!pendingAvatarFile) return;
    setAvatarBusy(true);
    setFeedback(null);
    try {
      const updated = await uploadCustomerAvatar(pendingAvatarFile);
      syncFormStateFromProfile(updated);
      await refreshUser();
      cancelPendingAvatar();
      setFeedback({ type: "success", text: "Profile picture updated." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to upload profile picture."),
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarBusy(true);
    setFeedback(null);
    try {
      const updated = await removeCustomerAvatar();
      syncFormStateFromProfile(updated);
      await refreshUser();
      cancelPendingAvatar();
      setFeedback({ type: "success", text: "Profile picture removed." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to remove profile picture."),
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent) {
    event.preventDefault();
    setProfileBusy(true);
    setFeedback(null);
    try {
      const updated = await updateCustomerProfile({
        first_name: firstName,
        last_name: lastName,
        phone: phoneInput.trim() ? phoneInput.trim() : null,
      });
      syncFormStateFromProfile(updated);
      await refreshUser();
      setFeedback({ type: "success", text: "Personal information updated." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to save profile details."),
      });
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    setEmailBusy(true);
    setFeedback(null);
    try {
      const updated = await changeCustomerEmail({
        new_email: newEmail.trim(),
        current_password: emailPassword,
      });
      syncFormStateFromProfile(updated);
      await refreshUser();
      setEmailPassword("");
      setFeedback({ type: "success", text: "Your account email address has been updated." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to update your email address."),
      });
    } finally {
      setEmailBusy(false);
    }
  }

  async function loadOrdersPage(nextPage: number) {
    try {
      const loaded = await getOrders(nextPage);
      setOrders(loaded);
      setOrdersPage(nextPage);
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to load order history."),
      });
    }
  }

  async function handleReorder(orderId: number) {
    setReorderingOrderId(orderId);
    setFeedback(null);
    try {
      const result = await reorderToCart(orderId);
      if (result.addedCount === 0) {
        setFeedback({ type: "error", text: result.summaryMessage });
      } else {
        router.push("/cart");
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to reorder items from this order."),
      });
    } finally {
      setReorderingOrderId(null);
    }
  }

  function openAddAddress() {
    setEditingAddress(null);
    setAddressForm({
      ...EMPTY_ADDRESS,
      recipient_name: profile?.full_name || "",
      phone: profile?.phone || "",
      is_default: addresses.length === 0,
    });
    setShowAddressModal(true);
  }

  function openEditAddress(addr: CustomerAddress) {
    setEditingAddress(addr);
    setAddressForm({
      label: addr.label,
      recipient_name: addr.recipient_name,
      phone: addr.phone,
      street_address: addr.street_address,
      barangay: addr.barangay || "",
      city: addr.city,
      state_province: addr.state_province || "",
      postal_code: addr.postal_code || "",
      delivery_instructions: addr.delivery_instructions || "",
      is_default: addr.is_default,
    });
    setShowAddressModal(true);
  }

  async function handleSaveAddress(event: FormEvent) {
    event.preventDefault();
    setAddressBusy(true);
    setFeedback(null);
    try {
      const payload: AddressCreateInput = {
        ...addressForm,
        barangay: addressForm.barangay?.trim() || null,
        state_province: addressForm.state_province?.trim() || null,
        postal_code: addressForm.postal_code?.trim() || null,
        delivery_instructions: addressForm.delivery_instructions?.trim() || null,
      };
      if (editingAddress) {
        await updateCustomerAddress(editingAddress.id, payload);
      } else {
        await createCustomerAddress(payload);
      }
      const [refreshedAddresses, refreshedProfile] = await Promise.all([
        getCustomerAddresses(),
        getCustomerProfile(),
      ]);
      setAddresses(refreshedAddresses);
      syncFormStateFromProfile(refreshedProfile);
      await refreshUser();
      setShowAddressModal(false);
      setFeedback({
        type: "success",
        text: editingAddress ? "Address updated." : "Saved address added.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to save address."),
      });
    } finally {
      setAddressBusy(false);
    }
  }

  async function handleSetDefaultAddress(addressId: number) {
    setFeedback(null);
    try {
      await setDefaultAddress(addressId);
      const [refreshedAddresses, refreshedProfile] = await Promise.all([
        getCustomerAddresses(),
        getCustomerProfile(),
      ]);
      setAddresses(refreshedAddresses);
      syncFormStateFromProfile(refreshedProfile);
      await refreshUser();
      setFeedback({ type: "success", text: "Default address updated." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to set default address."),
      });
    }
  }

  async function handleDeleteAddress(addressId: number) {
    if (!window.confirm("Remove this saved address?")) return;
    setFeedback(null);
    try {
      await deleteCustomerAddress(addressId);
      const [refreshedAddresses, refreshedProfile] = await Promise.all([
        getCustomerAddresses(),
        getCustomerProfile(),
      ]);
      setAddresses(refreshedAddresses);
      syncFormStateFromProfile(refreshedProfile);
      await refreshUser();
      setFeedback({ type: "success", text: "Saved address removed." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to delete address."),
      });
    }
  }

  async function handleRemoveFavorite(productId: number) {
    setFeedback(null);
    try {
      await removeCustomerFavorite(productId);
      setFavorites((prev) => prev.filter((item) => item.product_id !== productId));
      setFeedback({ type: "success", text: "Removed dish from favorites." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to remove favorite."),
      });
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordBusy(true);
    setFeedback(null);
    try {
      const res = await changeCustomerPassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFeedback({ type: "success", text: res.message });
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to update your password."),
      });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleDeactivateSubmit(event: FormEvent) {
    event.preventDefault();
    if (!deactivateConfirmed) {
      setFeedback({
        type: "error",
        text: "Please check the confirmation box to deactivate your account.",
      });
      return;
    }
    setDeactivateBusy(true);
    setFeedback(null);
    try {
      await deactivateCustomerAccount({
        current_password: deactivatePassword,
        confirm_deactivation: deactivateConfirmed,
        reason: deactivateReason.trim() || null,
      });
      await refreshUser();
      router.push("/");
    } catch (err) {
      setFeedback({
        type: "error",
        text: getReadableError(err, "Unable to deactivate account."),
      });
    } finally {
      setDeactivateBusy(false);
    }
  }

  function toggleArrayValue<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  const displayAvatar = pendingAvatarPreview || profile?.avatar_url || user?.avatar_url || null;
  const initials = (profile?.full_name || user?.full_name || "S").charAt(0).toUpperCase();

  const navItems: Array<{
    id: SectionId;
    label: string;
    icon: typeof UserIcon;
    badge?: number;
  }> = [
    { id: "profile", label: "My Profile", icon: UserIcon },
    { id: "orders", label: "My Orders", icon: ReceiptIcon, badge: orders?.total },
    { id: "addresses", label: "Saved Addresses", icon: MapPinIcon, badge: addresses.length },
    { id: "favorites", label: "Favorites", icon: HeartIcon, badge: favorites.length },
    { id: "preferences", label: "Food & Dining", icon: SlidersIcon },
    { id: "payment", label: "Payment Method", icon: CreditCardIcon },
    { id: "notifications", label: "Notifications", icon: BellIcon },
    { id: "appearance", label: "Appearance", icon: SunIcon },
    { id: "security", label: "Security & Account", icon: LockIcon },
  ];

  return (
    <div className={styles.page}>
      <Header />

      <main className={styles.main}>
        {authLoading || pageLoading ? (
          <div className={styles.loadingCard} aria-live="polite">
            <p>Loading your SavoryBites account...</p>
          </div>
        ) : !isAuthenticated ? (
          <section className={styles.authGateCard}>
            <p className={styles.eyebrow}>CUSTOMER ACCOUNT</p>
            <h1 className={styles.pageTitle}>Sign in to manage your profile</h1>
            <p className={styles.pageSubtitle}>
              Access your saved addresses, favorites, food allergy preferences, order history, and account settings.
            </p>
            <div className={styles.formActions} style={{ justifyContent: "center", marginTop: 24 }}>
              <Link href="/login?next=/customer" className={styles.primaryButton}>
                Sign in
              </Link>
              <Link href="/register" className={styles.secondaryButton}>
                Create account
              </Link>
            </div>
          </section>
        ) : (
          <>
            <header className={styles.pageHeader}>
              <div>
                <p className={styles.eyebrow}>SAVORYBITES ACCOUNT</p>
                <h1 className={styles.pageTitle}>Welcome back, {profile?.first_name || "Guest"}</h1>
                <p className={styles.pageSubtitle}>
                  Manage your dining details, saved addresses, food preferences, and order history.
                </p>
              </div>
              <div className={styles.headerActions}>
                <Link href="/menu" className={styles.secondaryButton}>
                  Browse menu
                </Link>
                <Link href="/start-order" className={styles.primaryButton}>
                  Start an order
                </Link>
              </div>
            </header>

            {feedback && (
              <div
                className={`${styles.noticeBanner} ${
                  feedback.type === "success" ? styles.noticeSuccess : styles.noticeError
                }`}
                role="status"
              >
                <span>{feedback.text}</span>
                <button
                  type="button"
                  className={styles.noticeDismiss}
                  onClick={() => setFeedback(null)}
                  aria-label="Dismiss message"
                >
                  ✕
                </button>
              </div>
            )}

            <div className={styles.layoutGrid}>
              <aside className={styles.sidebarColumn}>
                <div className={styles.profileSummaryCard}>
                  <div className={styles.avatarWrap}>
                    <div className={styles.avatarCircle}>
                      {displayAvatar ? (
                        <Image
                          src={displayAvatar}
                          alt={`${profile?.full_name || "Customer"} avatar`}
                          width={84}
                          height={84}
                          unoptimized
                          className={styles.avatarImage}
                        />
                      ) : (
                        initials
                      )}
                    </div>
                  </div>

                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleAvatarFileSelect}
                    className={styles.fileInputHidden}
                    aria-label="Choose profile picture"
                  />

                  <div className={styles.avatarActionsRow}>
                    {pendingAvatarFile ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.primaryButton} ${styles.smallButton}`}
                          onClick={() => void handleSaveAvatar()}
                          disabled={avatarBusy}
                        >
                          {avatarBusy ? "Saving..." : "Save Photo"}
                        </button>
                        <button
                          type="button"
                          className={`${styles.secondaryButton} ${styles.smallButton}`}
                          onClick={cancelPendingAvatar}
                          disabled={avatarBusy}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${styles.secondaryButton} ${styles.smallButton}`}
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={avatarBusy}
                        >
                          <CameraIcon size={14} />
                          <span>{profile?.avatar_url ? "Replace Photo" : "Upload Photo"}</span>
                        </button>
                        {profile?.avatar_url && (
                          <button
                            type="button"
                            className={`${styles.dangerOutlineButton} ${styles.smallButton}`}
                            onClick={() => void handleRemoveAvatar()}
                            disabled={avatarBusy}
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  <h2 className={styles.summaryName}>{profile?.full_name}</h2>
                  <p className={styles.summaryEmail}>{profile?.email || "No email on file"}</p>
                  <div className={styles.memberStatus}>
                    <span className={styles.memberStatusDot} />
                    <span>{profile?.is_active ? "Active Member" : "Inactive"}</span>
                  </div>
                  <div className={styles.memberSince}>
                    <span>Member since</span>
                    <strong>{formatDate(profile?.created_at)}</strong>
                  </div>
                </div>

                <nav className={styles.sectionNavCard} aria-label="Account sections">
                  <div className={styles.sectionNavList}>
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeSection === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`${styles.sectionNavButton} ${
                            isActive ? styles.sectionNavButtonActive : ""
                          }`}
                          onClick={() => selectSection(item.id)}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <Icon size={16} />
                          <span>{item.label}</span>
                          {typeof item.badge === "number" && item.badge > 0 && (
                            <span className={styles.navBadge}>{item.badge}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </nav>
              </aside>

              <section className={styles.panelStack} aria-live="polite">
                {activeSection === "profile" && (
                  <>
                    <div className={styles.panelCard}>
                      <div className={styles.panelHeader}>
                        <div>
                          <h2>Personal Information</h2>
                          <p>Used to greet you and prefill takeout or table orders at checkout.</p>
                        </div>
                      </div>

                      <div className={styles.metricsGrid}>
                        <div className={styles.metricBox}>
                          <span className={styles.metricLabel}>Orders</span>
                          <span className={styles.metricValue}>{orders?.total ?? 0}</span>
                        </div>
                        <div className={styles.metricBox}>
                          <span className={styles.metricLabel}>Favorites</span>
                          <span className={styles.metricValue}>{favorites.length}</span>
                        </div>
                        <div className={styles.metricBox}>
                          <span className={styles.metricLabel}>Addresses</span>
                          <span className={styles.metricValue}>{addresses.length}</span>
                        </div>
                        <div className={styles.metricBox}>
                          <span className={styles.metricLabel}>Dining Mode</span>
                          <span className={styles.metricValue} style={{ fontSize: 16 }}>
                            {profile?.default_order_type === "dine_in"
                              ? "Dine-in"
                              : profile?.default_order_type === "takeout"
                                ? "Takeout"
                                : "Ask me"}
                          </span>
                        </div>
                      </div>

                      <form className={styles.formStack} onSubmit={(e) => void handleProfileSubmit(e)}>
                        <div className={styles.fieldRow}>
                          <div className={styles.formGroup}>
                            <label htmlFor="profile-first-name">First Name</label>
                            <input
                              id="profile-first-name"
                              className={styles.input}
                              type="text"
                              required
                              maxLength={60}
                              value={firstName}
                              onChange={(e) => setFirstName(e.target.value)}
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label htmlFor="profile-last-name">Last Name</label>
                            <input
                              id="profile-last-name"
                              className={styles.input}
                              type="text"
                              maxLength={60}
                              value={lastName}
                              onChange={(e) => setLastName(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className={styles.formGroup}>
                          <label htmlFor="profile-phone">Philippine Mobile Number</label>
                          <input
                            id="profile-phone"
                            className={styles.input}
                            type="tel"
                            placeholder="09171234567"
                            maxLength={20}
                            value={phoneInput}
                            onChange={(e) => setPhoneInput(e.target.value)}
                          />
                          <span className={styles.helperText}>
                            Format: 09XXXXXXXXX or +639XXXXXXXXX. Used for order contact updates.
                          </span>
                        </div>

                        <div className={styles.formActions}>
                          <button type="submit" className={styles.primaryButton} disabled={profileBusy}>
                            {profileBusy ? "Saving..." : "Save Personal Details"}
                          </button>
                        </div>
                      </form>
                    </div>

                    <div className={styles.panelCard}>
                      <div className={styles.panelHeader}>
                        <div>
                          <h2>Contact Email Address</h2>
                          <p>Changing your login email requires verifying your current password.</p>
                        </div>
                      </div>
                      <form className={styles.formStack} onSubmit={(e) => void handleEmailSubmit(e)}>
                        <div className={styles.fieldRow}>
                          <div className={styles.formGroup}>
                            <label htmlFor="profile-new-email">Email Address</label>
                            <input
                              id="profile-new-email"
                              className={styles.input}
                              type="email"
                              required
                              value={newEmail}
                              onChange={(e) => setNewEmail(e.target.value)}
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label htmlFor="profile-email-password">Current Password</label>
                            <input
                              id="profile-email-password"
                              className={styles.input}
                              type="password"
                              required
                              value={emailPassword}
                              onChange={(e) => setEmailPassword(e.target.value)}
                              placeholder="Verify with current password"
                            />
                          </div>
                        </div>
                        <div className={styles.formActions}>
                          <button type="submit" className={styles.secondaryButton} disabled={emailBusy}>
                            {emailBusy ? "Updating..." : "Update Email Address"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </>
                )}

                {activeSection === "orders" && (
                  <div className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h2>Order History</h2>
                        <p>Review past orders, open live status trackers, or reorder validated dishes to your cart.</p>
                      </div>
                      <Link href="/orders" className={styles.secondaryButton}>
                        Full orders view
                      </Link>
                    </div>

                    {!orders || orders.items.length === 0 ? (
                      <div className={styles.emptyState}>
                        <p>You have not placed any orders with SavoryBites yet.</p>
                        <Link href="/menu" className={styles.primaryButton} style={{ marginTop: 12 }}>
                          Explore the menu
                        </Link>
                      </div>
                    ) : (
                      <>
                        <div className={styles.ordersList}>
                          {orders.items.map((order) => (
                            <div key={order.id} className={styles.orderRow}>
                              <div>
                                <div className={styles.orderMetaTop}>
                                  <span className={styles.orderNumber}>Order #{order.order_number}</span>
                                  <span className={`${styles.statusPill} ${styles[`status_${order.status}`] || ""}`}>
                                    {order.status}
                                  </span>
                                </div>
                                <p className={styles.orderSub}>
                                  {formatDate(order.ordered_at, true)} ·{" "}
                                  {order.order_type === "dine_in"
                                    ? `Dine-in${order.table_number ? ` (Table ${order.table_number})` : ""}`
                                    : "Takeout"}
                                  {order.payment_method_label ? ` · ${order.payment_method_label}` : ""} ·{" "}
                                  {order.item_count} item{order.item_count === 1 ? "" : "s"}
                                </p>
                              </div>
                              <div className={styles.orderRight}>
                                <span className={styles.orderTotal}>
                                  {currencyFormatter.format(order.total)}
                                </span>
                                <Link
                                  href={`/order-confirmation/${order.id}`}
                                  className={`${styles.secondaryButton} ${styles.smallButton}`}
                                >
                                  Track / Receipt
                                </Link>
                                <button
                                  type="button"
                                  className={`${styles.primaryButton} ${styles.smallButton}`}
                                  onClick={() => void handleReorder(order.id)}
                                  disabled={reorderingOrderId === order.id}
                                >
                                  <RefreshIcon size={13} />
                                  <span>{reorderingOrderId === order.id ? "Checking..." : "Order Again"}</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {orders.total > orders.page_size && (
                          <div className={styles.paginationRow}>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              disabled={ordersPage <= 1}
                              onClick={() => void loadOrdersPage(ordersPage - 1)}
                            >
                              Previous
                            </button>
                            <span className={styles.helperText}>
                              Page {orders.page} of {Math.ceil(orders.total / orders.page_size)}
                            </span>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              disabled={ordersPage * orders.page_size >= orders.total}
                              onClick={() => void loadOrdersPage(ordersPage + 1)}
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {activeSection === "addresses" && (
                  <div className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h2>Saved Addresses</h2>
                        <p>Used as contact and reference snapshots during checkout.</p>
                      </div>
                      <button type="button" className={styles.primaryButton} onClick={openAddAddress}>
                        <PlusIcon size={15} />
                        <span>Add New Address</span>
                      </button>
                    </div>

                    <div className={styles.infoCallout} style={{ marginBottom: 18 }}>
                      <InfoIcon size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        SavoryBites currently fulfills orders for <strong>Dine-In (Table Service)</strong> and{" "}
                        <strong>Counter Takeout</strong>. Selecting a saved address at checkout saves your contact and barangay reference securely on that order.
                      </div>
                    </div>

                    {addresses.length === 0 ? (
                      <div className={styles.emptyState}>
                        <p>No saved addresses yet. Add your home or workplace address for faster checkout.</p>
                      </div>
                    ) : (
                      <div className={styles.addressGrid}>
                        {addresses.map((addr) => (
                          <div
                            key={addr.id}
                            className={`${styles.addressCard} ${addr.is_default ? styles.addressCardDefault : ""}`}
                          >
                            <div>
                              <div className={styles.badgeRow}>
                                {addr.is_default && (
                                  <span className={`${styles.badge} ${styles.badgeDefault}`}>Default</span>
                                )}
                                <span
                                  className={`${styles.badge} ${
                                    addr.is_within_service_area ? styles.badgeGreen : styles.badgeNeutral
                                  }`}
                                >
                                  {addr.is_within_service_area
                                    ? "Within Local Area"
                                    : "Outside Local Zone"}
                                </span>
                              </div>
                              <h3 className={styles.addressTitle}>{addr.label}</h3>
                              <p className={styles.addressMeta}>
                                <strong>{addr.recipient_name}</strong> · {addr.phone}
                              </p>
                              <p className={styles.addressMeta}>
                                {addr.street_address}
                                {addr.barangay ? `, Brgy. ${addr.barangay}` : ""}
                              </p>
                              <p className={styles.addressMeta}>
                                {addr.city}
                                {addr.state_province ? `, ${addr.state_province}` : ""}
                                {addr.postal_code ? ` ${addr.postal_code}` : ""}
                              </p>
                              {addr.delivery_instructions && (
                                <p className={styles.helperText} style={{ marginTop: 6 }}>
                                  Note: {addr.delivery_instructions}
                                </p>
                              )}
                            </div>

                            <div className={styles.addressActions}>
                              {!addr.is_default && (
                                <button
                                  type="button"
                                  className={`${styles.secondaryButton} ${styles.smallButton}`}
                                  onClick={() => void handleSetDefaultAddress(addr.id)}
                                >
                                  Set Default
                                </button>
                              )}
                              <button
                                type="button"
                                className={`${styles.secondaryButton} ${styles.smallButton}`}
                                onClick={() => openEditAddress(addr)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={`${styles.dangerOutlineButton} ${styles.smallButton}`}
                                onClick={() => void handleDeleteAddress(addr.id)}
                              >
                                <TrashIcon size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeSection === "favorites" && (
                  <div className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h2>Favorite Dishes</h2>
                        <p>Live availability and current menu prices for dishes you love.</p>
                      </div>
                      <Link href="/menu" className={styles.secondaryButton}>
                        Discover more dishes
                      </Link>
                    </div>

                    {favorites.length === 0 ? (
                      <div className={styles.emptyState}>
                        <p>Tap the heart icon on any menu dish to save it to your favorites.</p>
                        <Link href="/menu" className={styles.primaryButton} style={{ marginTop: 12 }}>
                          Browse Menu
                        </Link>
                      </div>
                    ) : (
                      <div className={styles.favoritesGrid}>
                        {favorites.map(({ product }) => {
                          const conflicts = detectDishConflicts(product, profile);
                          return (
                            <div key={product.id} className={styles.favoriteCard}>
                              <div className={styles.favoriteThumb}>
                                {product.image_url && !failedFavoriteImages.has(product.id) ? (
                                  <Image
                                    src={product.image_url}
                                    alt={product.name}
                                    fill
                                    sizes="76px"
                                    style={{ objectFit: "cover" }}
                                    onError={() => {
                                      setFailedFavoriteImages((prev) => new Set(prev).add(product.id));
                                    }}
                                  />
                                ) : (
                                  product.name.slice(0, 1)
                                )}
                              </div>
                              <div className={styles.favoriteBody}>
                                <h3>{product.name}</h3>
                                <span className={styles.helperText}>{product.category.name}</span>
                                <span className={styles.favoritePrice}>
                                  {currencyFormatter.format(product.price)}
                                </span>
                                <AllergyConflictNotice conflicts={conflicts} compact />
                                <div className={styles.formActions} style={{ justifyContent: "flex-start", marginTop: "auto", paddingTop: 8 }}>
                                  {product.is_available ? (
                                    <Link
                                      href={`/menu/${product.id}`}
                                      className={`${styles.primaryButton} ${styles.smallButton}`}
                                    >
                                      Order Dish
                                    </Link>
                                  ) : (
                                    <span className={`${styles.badge} ${styles.badgeNeutral}`}>
                                      Currently Unavailable
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    className={`${styles.dangerOutlineButton} ${styles.smallButton}`}
                                    onClick={() => void handleRemoveFavorite(product.id)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeSection === "preferences" && (
                  <div className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h2>Food &amp; Dining Preferences</h2>
                        <p>Personalize your default dining mode, dietary tags, and optional allergy advisories.</p>
                      </div>
                    </div>

                    <div className={styles.safetyCallout} style={{ marginBottom: 20 }}>
                      <AlertTriangleIcon size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <strong>Allergy &amp; Cross-Contact Disclosure</strong>
                        <p style={{ margin: "4px 0 0" }}>
                          SavoryBites prepares food in a shared commercial kitchen. Menu warnings are advisory only and never guarantee an allergen-free dish. If you have a severe allergy, please speak directly with restaurant staff before placing your order.
                        </p>
                      </div>
                    </div>

                    <div className={styles.formStack}>
                      <div className={styles.formGroup}>
                        <label htmlFor="default-order-type">Default Dining Mode</label>
                        <select
                          id="default-order-type"
                          className={styles.select}
                          value={defaultOrderType}
                          onChange={(e) =>
                            setDefaultOrderType(e.target.value as "dine_in" | "takeout" | "")
                          }
                        >
                          <option value="">Ask me each time</option>
                          <option value="dine_in">Dine-in (Table Service)</option>
                          <option value="takeout">Takeout (Counter Pickup)</option>
                        </select>
                      </div>

                      <div className={styles.formGroup}>
                        <label>Dietary Preferences</label>
                        <div className={styles.chipsWrap}>
                          {DIETARY_PREFERENCE_OPTIONS.map((opt) => {
                            const selected = dietaryPreferences.includes(opt.code);
                            return (
                              <button
                                key={opt.code}
                                type="button"
                                className={`${styles.choiceChip} ${
                                  selected ? styles.choiceChipSelected : ""
                                }`}
                                aria-pressed={selected}
                                onClick={() =>
                                  setDietaryPreferences((prev) => toggleArrayValue(prev, opt.code))
                                }
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {categories.length > 0 && (
                        <div className={styles.formGroup}>
                          <label>Favorite Menu Categories</label>
                          <div className={styles.chipsWrap}>
                            {categories.map((cat) => {
                              const selected = preferredCategoryIds.includes(cat.id);
                              return (
                                <button
                                  key={cat.id}
                                  type="button"
                                  className={`${styles.choiceChip} ${
                                    selected ? styles.choiceChipSelected : ""
                                  }`}
                                  aria-pressed={selected}
                                  onClick={() =>
                                    setPreferredCategoryIds((prev) => toggleArrayValue(prev, cat.id))
                                  }
                                >
                                  {cat.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className={styles.formGroup}>
                        <label>Food Allergens</label>
                        <div className={styles.chipsWrap}>
                          {ALLERGEN_OPTIONS.map((opt) => {
                            const selected = allergyFlags.includes(opt.code);
                            return (
                              <button
                                key={opt.code}
                                type="button"
                                className={`${styles.choiceChip} ${
                                  selected ? styles.choiceChipSelected : ""
                                }`}
                                aria-pressed={selected}
                                onClick={() =>
                                  setAllergyFlags((prev) => toggleArrayValue(prev, opt.code))
                                }
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className={styles.formGroup}>
                        <label htmlFor="disliked-ingredients">Avoided or Disliked Ingredients</label>
                        <input
                          id="disliked-ingredients"
                          className={styles.input}
                          type="text"
                          maxLength={500}
                          placeholder="e.g., cilantro, onion, mayonnaise"
                          value={dislikedIngredients}
                          onChange={(e) => setDislikedIngredients(e.target.value)}
                        />
                        <span className={styles.helperText}>Separate multiple ingredients with commas.</span>
                      </div>

                      <label className={styles.toggleRow}>
                        <input
                          type="checkbox"
                          checked={allergyConsentGiven}
                          onChange={(e) => setAllergyConsentGiven(e.target.checked)}
                        />
                        <span className={styles.toggleCopy}>
                          <strong>Explicit Allergy Data Consent</strong>
                          <span>
                            I consent to SavoryBites storing my food allergy and ingredient restriction details on my profile for menu advisories.
                          </span>
                        </span>
                      </label>

                      <label className={styles.toggleRow}>
                        <input
                          type="checkbox"
                          checked={shareAllergyWithKitchen}
                          onChange={(e) => setShareAllergyWithKitchen(e.target.checked)}
                        />
                        <span className={styles.toggleCopy}>
                          <strong>Attach Allergy Note to Kitchen Orders</strong>
                          <span>
                            When enabled, your consented allergen note can be included on checkout orders and shown to kitchen staff on the Kitchen Display System without exposing other private profile fields.
                          </span>
                        </span>
                      </label>

                      <div className={styles.formActions}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={prefsBusy}
                          onClick={() => void savePreferencesPayload(undefined, "Food and dining preferences saved.")}
                        >
                          {prefsBusy ? "Saving..." : "Save Dining Preferences"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeSection === "payment" && (
                  <div className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h2>Preferred Payment Method</h2>
                        <p>Choose your default payment option for faster selection at checkout.</p>
                      </div>
                    </div>

                    <div className={styles.infoCallout} style={{ marginBottom: 18 }}>
                      <InfoIcon size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        SavoryBites does not collect or store raw credit/debit card numbers in your profile. Your preference simply pre-selects an active restaurant payment method on the payment step.
                      </div>
                    </div>

                    <div className={styles.formStack}>
                      <label className={styles.toggleRow}>
                        <input
                          type="radio"
                          name="preferred_payment"
                          checked={preferredPaymentCode === ""}
                          onChange={() => setPreferredPaymentCode("")}
                        />
                        <span className={styles.toggleCopy}>
                          <strong>Ask me at checkout</strong>
                          <span>Do not preselect a payment method automatically.</span>
                        </span>
                      </label>

                      {paymentMethods.map((method) => (
                        <label key={method.id} className={styles.toggleRow}>
                          <input
                            type="radio"
                            name="preferred_payment"
                            checked={preferredPaymentCode === method.code}
                            onChange={() => setPreferredPaymentCode(method.code)}
                          />
                          <span className={styles.toggleCopy}>
                            <strong>{method.label}</strong>
                            <span>{method.description || "Available restaurant payment option."}</span>
                          </span>
                        </label>
                      ))}

                      <div className={styles.formActions}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={prefsBusy}
                          onClick={() =>
                            void savePreferencesPayload(
                              { preferred_payment_code: preferredPaymentCode || null },
                              "Preferred payment method saved.",
                            )
                          }
                        >
                          {prefsBusy ? "Saving..." : "Save Payment Preference"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeSection === "notifications" && (
                  <div className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h2>Notification Preferences</h2>
                        <p>Manage how SavoryBites communicates order updates and promotions.</p>
                      </div>
                    </div>

                    <div className={styles.infoCallout} style={{ marginBottom: 18 }}>
                      <InfoIcon size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <strong>Email Channel Active:</strong> Transactional receipts, order confirmations, and account security alerts are delivered via email ({profile?.email || "no email set"}). SMS and mobile push notifications are not currently offered.
                      </div>
                    </div>

                    <div className={styles.formStack}>
                      <label className={styles.toggleRow}>
                        <input
                          type="checkbox"
                          checked={emailOrderUpdates}
                          onChange={(e) => setEmailOrderUpdates(e.target.checked)}
                        />
                        <span className={styles.toggleCopy}>
                          <strong>Order Confirmation &amp; Status Emails</strong>
                          <span>Receive order confirmation summaries when your order is placed.</span>
                        </span>
                      </label>

                      <label className={styles.toggleRow}>
                        <input
                          type="checkbox"
                          checked={emailPromotions}
                          onChange={(e) => setEmailPromotions(e.target.checked)}
                        />
                        <span className={styles.toggleCopy}>
                          <strong>Seasonal Specials &amp; Promotional Emails</strong>
                          <span>
                            Opt in to occasional SavoryBites menu highlights and seasonal offers.
                            {profile?.marketing_consent_at && emailPromotions
                              ? ` (Opted in ${formatDate(profile.marketing_consent_at)})`
                              : ""}
                          </span>
                        </span>
                      </label>

                      <div className={styles.formActions}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={prefsBusy}
                          onClick={() =>
                            void savePreferencesPayload(
                              {
                                email_order_updates: emailOrderUpdates,
                                email_promotions: emailPromotions,
                              },
                              "Notification preferences updated.",
                            )
                          }
                        >
                          {prefsBusy ? "Saving..." : "Save Notification Settings"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeSection === "appearance" && (
                  <div className={styles.panelCard}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h2>Appearance &amp; Theme</h2>
                        <p>Choose your preferred display theme across SavoryBites pages.</p>
                      </div>
                    </div>

                    <div className={styles.themeCards}>
                      <button
                        type="button"
                        className={`${styles.themeCard} ${themePref === "light" ? styles.themeCardActive : ""}`}
                        onClick={() => {
                          setThemePref("light");
                          setThemePreference("light");
                        }}
                      >
                        <SunIcon size={22} />
                        <strong>Warm Cream (Light)</strong>
                        <span className={styles.helperText}>Classic SavoryBites cream and forest green palette.</span>
                      </button>

                      <button
                        type="button"
                        className={`${styles.themeCard} ${themePref === "dark" ? styles.themeCardActive : ""}`}
                        onClick={() => {
                          setThemePref("dark");
                          setThemePreference("dark");
                        }}
                      >
                        <MoonIcon size={22} />
                        <strong>Deep Forest (Dark)</strong>
                        <span className={styles.helperText}>High-contrast evening palette comfortable in low light.</span>
                      </button>

                      <button
                        type="button"
                        className={`${styles.themeCard} ${themePref === "system" ? styles.themeCardActive : ""}`}
                        onClick={() => {
                          setThemePref("system");
                          setThemePreference("system");
                        }}
                      >
                        <MonitorIcon size={22} />
                        <strong>Match Device</strong>
                        <span className={styles.helperText}>Automatically follows your operating system setting.</span>
                      </button>
                    </div>

                    <div className={styles.formActions} style={{ marginTop: 20 }}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={prefsBusy}
                        onClick={() =>
                          void savePreferencesPayload(
                            { theme_preference: themePref },
                            "Appearance preference saved to your profile.",
                          )
                        }
                      >
                        {prefsBusy ? "Saving..." : "Save Appearance Preference"}
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === "security" && (
                  <>
                    <div className={styles.panelCard}>
                      <div className={styles.panelHeader}>
                        <div>
                          <h2>Change Password</h2>
                          <p>Use at least 8 characters including letters and numbers. Updating your password rotates your session token.</p>
                        </div>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void logout().then(() => router.push("/"))}
                        >
                          <LogOutIcon size={15} />
                          <span>Sign Out</span>
                        </button>
                      </div>

                      <form className={styles.formStack} onSubmit={(e) => void handlePasswordSubmit(e)}>
                        <div className={styles.formGroup}>
                          <label htmlFor="sec-current-pw">Current Password</label>
                          <input
                            id="sec-current-pw"
                            className={styles.input}
                            type="password"
                            required
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                          />
                        </div>
                        <div className={styles.fieldRow}>
                          <div className={styles.formGroup}>
                            <label htmlFor="sec-new-pw">New Password</label>
                            <input
                              id="sec-new-pw"
                              className={styles.input}
                              type="password"
                              required
                              minLength={8}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label htmlFor="sec-confirm-pw">Confirm New Password</label>
                            <input
                              id="sec-confirm-pw"
                              className={styles.input}
                              type="password"
                              required
                              minLength={8}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className={styles.formActions}>
                          <button type="submit" className={styles.primaryButton} disabled={passwordBusy}>
                            {passwordBusy ? "Updating..." : "Update Password"}
                          </button>
                        </div>
                      </form>
                    </div>

                    <div className={styles.dangerZone}>
                      <h3>Deactivate Account</h3>
                      <p className={styles.helperText} style={{ marginBottom: 14 }}>
                        Deactivating signs you out and prevents future logins while preserving restaurant order records cleanly for accounting. Contact management if you ever need your account reactivated.
                      </p>
                      <form className={styles.formStack} onSubmit={(e) => void handleDeactivateSubmit(e)}>
                        <div className={styles.fieldRow}>
                          <div className={styles.formGroup}>
                            <label htmlFor="deact-password">Verify Password</label>
                            <input
                              id="deact-password"
                              className={styles.input}
                              type="password"
                              required
                              value={deactivatePassword}
                              onChange={(e) => setDeactivatePassword(e.target.value)}
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label htmlFor="deact-reason">Reason (Optional)</label>
                            <input
                              id="deact-reason"
                              className={styles.input}
                              type="text"
                              maxLength={500}
                              value={deactivateReason}
                              onChange={(e) => setDeactivateReason(e.target.value)}
                            />
                          </div>
                        </div>
                        <label className={styles.toggleRow}>
                          <input
                            type="checkbox"
                            checked={deactivateConfirmed}
                            onChange={(e) => setDeactivateConfirmed(e.target.checked)}
                          />
                          <span className={styles.toggleCopy}>
                            <strong>I understand this will deactivate my SavoryBites login immediately.</strong>
                          </span>
                        </label>
                        <div className={styles.formActions}>
                          <button type="submit" className={styles.dangerButton} disabled={deactivateBusy}>
                            {deactivateBusy ? "Deactivating..." : "Deactivate My Account"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      {showAddressModal && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="address-modal-title">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3 id="address-modal-title">{editingAddress ? "Edit Saved Address" : "Add Saved Address"}</h3>
              <button
                type="button"
                className={styles.closeModalButton}
                onClick={() => setShowAddressModal(false)}
                aria-label="Close modal"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form className={styles.formStack} onSubmit={(e) => void handleSaveAddress(e)}>
              <div className={styles.fieldRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="addr-label">Address Label</label>
                  <input
                    id="addr-label"
                    className={styles.input}
                    required
                    maxLength={50}
                    placeholder="Home, Work, etc."
                    value={addressForm.label}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, label: e.target.value }))}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="addr-recipient">Recipient Name</label>
                  <input
                    id="addr-recipient"
                    className={styles.input}
                    required
                    minLength={2}
                    maxLength={100}
                    value={addressForm.recipient_name}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, recipient_name: e.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="addr-phone">Contact Phone (PH)</label>
                <input
                  id="addr-phone"
                  className={styles.input}
                  required
                  placeholder="09171234567"
                  value={addressForm.phone}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, phone: e.target.value }))}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="addr-street">Street Address / House / Unit</label>
                <input
                  id="addr-street"
                  className={styles.input}
                  required
                  minLength={3}
                  maxLength={255}
                  value={addressForm.street_address}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, street_address: e.target.value }))}
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="addr-barangay">Barangay</label>
                  <input
                    id="addr-barangay"
                    className={styles.input}
                    maxLength={120}
                    placeholder="e.g., Poblacion"
                    value={addressForm.barangay || ""}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, barangay: e.target.value }))}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="addr-city">City / Municipality</label>
                  <input
                    id="addr-city"
                    className={styles.input}
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="e.g., Dumaguete"
                    value={addressForm.city}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, city: e.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="addr-province">Province</label>
                  <input
                    id="addr-province"
                    className={styles.input}
                    maxLength={100}
                    value={addressForm.state_province || ""}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, state_province: e.target.value }))}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="addr-postal">Postal Code</label>
                  <input
                    id="addr-postal"
                    className={styles.input}
                    maxLength={20}
                    value={addressForm.postal_code || ""}
                    onChange={(e) => setAddressForm((prev) => ({ ...prev, postal_code: e.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="addr-instructions">Delivery / Gate / Landmark Notes</label>
                <textarea
                  id="addr-instructions"
                  className={styles.textarea}
                  rows={2}
                  maxLength={500}
                  value={addressForm.delivery_instructions || ""}
                  onChange={(e) =>
                    setAddressForm((prev) => ({ ...prev, delivery_instructions: e.target.value }))
                  }
                />
              </div>

              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={Boolean(addressForm.is_default)}
                  onChange={(e) => setAddressForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                />
                <span className={styles.toggleCopy}>
                  <strong>Set as my default saved address</strong>
                </span>
              </label>

              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowAddressModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.primaryButton} disabled={addressBusy}>
                  {addressBusy ? "Saving..." : "Save Address"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}

export default function CustomerAccountPage() {
  return (
    <CustomerRouteGuard>
      <CustomerAccountContent />
    </CustomerRouteGuard>
  );
}
