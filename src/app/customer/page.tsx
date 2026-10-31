"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/auth/AuthProvider";
import {
  CheckIcon,
  CloseIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
} from "../../components/ui/Icons";
import {
  createCustomerAddress,
  deleteCustomerAddress,
  getCustomerAddresses,
  setDefaultAddress,
  updateCustomerAddress,
  updateCustomerProfile,
} from "../../lib/api/customer";
import type { CustomerAddress } from "../../types/customer";
import styles from "./customer.module.css";

interface AddressFormData {
  label: string;
  recipient_name: string;
  phone: string;
  street_address: string;
  city: string;
  state_province: string;
  postal_code: string;
  delivery_instructions: string;
  is_default: boolean;
}

const initialAddressFormData: AddressFormData = {
  label: "Home",
  recipient_name: "",
  phone: "",
  street_address: "",
  city: "Dumaguete City",
  state_province: "Negros Oriental",
  postal_code: "6200",
  delivery_instructions: "",
  is_default: false,
};

export default function CustomerPage() {
  const router = useRouter();
  const { user: customer, isLoading, logout, refreshUser } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Profile Edit State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileFullName, setProfileFullName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Address State
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(null);
  const [addressForm, setAddressForm] = useState<AddressFormData>(initialAddressFormData);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressModalError, setAddressModalError] = useState("");
  const [deletingAddressId, setDeletingAddressId] = useState<number | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<number | null>(null);

  // Auth Protection
  useEffect(() => {
    if (!isLoading && !customer) {
      router.replace("/login?next=%2Fcustomer");
    }
  }, [customer, isLoading, router]);

  // Load Addresses on customer change
  const reloadAddresses = useCallback(async () => {
    if (!customer) return;
    try {
      const data = await getCustomerAddresses();
      setAddresses(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load saved addresses.";
      setGlobalError(msg);
    }
  }, [customer]);

  useEffect(() => {
    if (!customer) return;
    let active = true;

    (async () => {
      try {
        const data = await getCustomerAddresses();
        if (active) {
          setAddresses(data);
        }
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : "Failed to load saved addresses.";
          setGlobalError(msg);
        }
      } finally {
        if (active) {
          setLoadingAddresses(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [customer]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setGlobalError("");

    try {
      await logout();
      router.replace("/login");
    } catch {
      setGlobalError("We could not sign you out. Please try again.");
      setIsLoggingOut(false);
    }
  };

  const handleRetry = async () => {
    setGlobalError("");
    const refreshed = await refreshUser();
    if (!refreshed) {
      router.replace("/login?next=%2Fcustomer");
    }
  };

  // Profile Edit Handlers
  const handleStartEditProfile = () => {
    if (!customer) return;
    setProfileFullName(customer.full_name || "");
    setProfilePhone(customer.phone || "");
    setProfileError("");
    setSuccessMessage("");
    setIsEditingProfile(true);
  };

  const handleCancelEditProfile = () => {
    if (!customer) return;
    setProfileFullName(customer.full_name || "");
    setProfilePhone(customer.phone || "");
    setProfileError("");
    setIsEditingProfile(false);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileFullName.trim()) {
      setProfileError("Full name is required.");
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    setSuccessMessage("");

    try {
      await updateCustomerProfile({
        full_name: profileFullName.trim(),
        phone: profilePhone.trim() || null,
      });
      await refreshUser();
      setIsEditingProfile(false);
      setSuccessMessage("Your profile information has been updated successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update profile. Please try again.";
      setProfileError(msg);
    } finally {
      setProfileSaving(false);
    }
  };

  // Address Modal Handlers
  const handleOpenAddAddress = () => {
    if (!customer) return;
    setEditingAddress(null);
    setAddressForm({
      ...initialAddressFormData,
      recipient_name: customer.full_name || "",
      phone: customer.phone || "",
      is_default: addresses.length === 0,
    });
    setAddressModalError("");
    setAddressModalOpen(true);
  };

  const handleOpenEditAddress = (addr: CustomerAddress) => {
    setEditingAddress(addr);
    setAddressForm({
      label: addr.label,
      recipient_name: addr.recipient_name,
      phone: addr.phone,
      street_address: addr.street_address,
      city: addr.city,
      state_province: addr.state_province || "",
      postal_code: addr.postal_code || "",
      delivery_instructions: addr.delivery_instructions || "",
      is_default: addr.is_default,
    });
    setAddressModalError("");
    setAddressModalOpen(true);
  };

  const handleCloseAddressModal = () => {
    if (addressSaving) return;
    setAddressModalOpen(false);
    setEditingAddress(null);
    setAddressModalError("");
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!addressForm.recipient_name.trim()) {
      setAddressModalError("Recipient name is required.");
      return;
    }
    if (!addressForm.phone.trim()) {
      setAddressModalError("Contact phone number is required.");
      return;
    }
    if (!addressForm.street_address.trim()) {
      setAddressModalError("Street address is required.");
      return;
    }
    if (!addressForm.city.trim()) {
      setAddressModalError("City is required.");
      return;
    }

    setAddressSaving(true);
    setAddressModalError("");

    try {
      const payload = {
        label: addressForm.label.trim() || "Home",
        recipient_name: addressForm.recipient_name.trim(),
        phone: addressForm.phone.trim(),
        street_address: addressForm.street_address.trim(),
        city: addressForm.city.trim(),
        state_province: addressForm.state_province.trim() || null,
        postal_code: addressForm.postal_code.trim() || null,
        delivery_instructions: addressForm.delivery_instructions.trim() || null,
        is_default: addressForm.is_default,
      };

      if (editingAddress) {
        await updateCustomerAddress(editingAddress.id, payload);
        setSuccessMessage("Address updated successfully.");
      } else {
        await createCustomerAddress(payload);
        setSuccessMessage("New address added successfully.");
      }

      await reloadAddresses();
      await refreshUser();
      setAddressModalOpen(false);
      setEditingAddress(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save address.";
      setAddressModalError(msg);
    } finally {
      setAddressSaving(false);
    }
  };

  const handleSetDefaultAddress = async (addressId: number) => {
    setSettingDefaultId(addressId);
    setGlobalError("");
    setSuccessMessage("");
    try {
      await setDefaultAddress(addressId);
      await reloadAddresses();
      await refreshUser();
      setSuccessMessage("Default delivery address updated.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to set default address.";
      setGlobalError(msg);
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleDeleteAddress = async (addressId: number) => {
    if (!window.confirm("Are you sure you want to remove this saved address?")) {
      return;
    }

    setDeletingAddressId(addressId);
    setGlobalError("");
    setSuccessMessage("");
    try {
      await deleteCustomerAddress(addressId);
      await reloadAddresses();
      await refreshUser();
      setSuccessMessage("Address removed successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove address.";
      setGlobalError(msg);
    } finally {
      setDeletingAddressId(null);
    }
  };

  if (isLoading) {
    return (
      <main className={styles.page} aria-busy="true">
        <div className={styles.backgroundDecoration} aria-hidden="true">
          <span className={styles.decorationCircleOne} />
          <span className={styles.decorationCircleTwo} />
        </div>

        <section className={styles.loadingCard} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p>Loading your account...</p>
        </section>
      </main>
    );
  }

  if (!customer) {
    return (
      <main className={styles.page}>
        <div className={styles.backgroundDecoration} aria-hidden="true">
          <span className={styles.decorationCircleOne} />
          <span className={styles.decorationCircleTwo} />
        </div>

        <section className={styles.errorCard} role="alert">
          <p className={styles.eyebrow}>Account unavailable</p>
          <h1>We could not load your profile.</h1>
          <p>{globalError || "Please sign in to view your account details."}</p>
          <div className={styles.errorActions}>
            <button type="button" onClick={handleRetry}>
              Try again
            </button>
            <Link href="/login?next=%2Fcustomer">Go to sign in</Link>
          </div>
        </section>
      </main>
    );
  }

  const initials = customer.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <main className={styles.page}>
      <div className={styles.backgroundDecoration} aria-hidden="true">
        <span className={styles.decorationCircleOne} />
        <span className={styles.decorationCircleTwo} />
      </div>

      <section className={styles.container} aria-labelledby="account-title">
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="SavoryBites home">
            <span className={styles.brandMark} aria-hidden="true">S</span>
            <span>
              <strong>SavoryBites</strong>
              <small>Freshly made. Simply delicious.</small>
            </span>
          </Link>

          <div className={styles.headerLinks}>
            <Link href="/orders" className={styles.menuLink}>
              Order History
            </Link>
            <Link href="/menu" className={styles.menuLink}>
              Browse Menu
            </Link>
            <button
              type="button"
              className={styles.logoutButton}
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </header>

        <div className={styles.intro}>
          <p className={styles.eyebrow}>Customer account</p>
          <h1 id="account-title">
            Welcome back, {customer.full_name.split(" ")[0]}.
          </h1>
          <p>Manage your personal profile details and saved delivery addresses.</p>
        </div>

        {globalError && (
          <p className={styles.inlineError} role="alert">
            {globalError}
          </p>
        )}

        {successMessage && (
          <div className={styles.alertSuccess} role="status">
            {successMessage}
          </div>
        )}

        {/* Profile Grid */}
        <div className={styles.accountGrid}>
          <section className={styles.identityCard} aria-label="Profile overview">
            <span className={styles.avatar} aria-hidden="true">{initials || "C"}</span>
            <p className={styles.status}><span aria-hidden="true" /> Authenticated session</p>
            <h2>{customer.full_name}</h2>
            <p>{customer.email || "Email address not provided"}</p>
            <div className={styles.accountId}>
              <span>Customer ID</span>
              <strong>#{customer.customer_id}</strong>
            </div>
          </section>

          <section className={styles.detailsCard} aria-labelledby="details-title">
            <div className={styles.detailsHeader}>
              <div>
                <p className={styles.eyebrow}>Account information</p>
                <h2 id="details-title">Your details</h2>
              </div>
              {!isEditingProfile && (
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={handleStartEditProfile}
                  aria-label="Edit personal details"
                >
                  <EditIcon size={13} style={{ display: "inline", marginRight: "5px", verticalAlign: "-2px" }} />
                  <span>Edit details</span>
                </button>
              )}
            </div>

            {isEditingProfile ? (
              <form className={styles.profileForm} onSubmit={handleSaveProfile} noValidate>
                {profileError && (
                  <p className={styles.inlineError} role="alert">
                    {profileError}
                  </p>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="profile-fullname">Full Name *</label>
                  <input
                    id="profile-fullname"
                    type="text"
                    required
                    className={styles.input}
                    value={profileFullName}
                    onChange={(e) => setProfileFullName(e.target.value)}
                    placeholder="e.g. Maria Santos"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="profile-email">Email Address</label>
                  <input
                    id="profile-email"
                    type="email"
                    disabled
                    readOnly
                    className={`${styles.input} ${styles.inputDisabled}`}
                    value={customer.email ?? ""}
                  />
                  <span className={styles.helperText}>
                    Registered email address cannot be changed directly.
                  </span>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="profile-phone">Mobile Number</label>
                  <input
                    id="profile-phone"
                    type="tel"
                    className={styles.input}
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder="09171234567 or +639171234567"
                  />
                  <span className={styles.helperText}>
                    Standard 11-digit Philippine mobile format (e.g. 09171234567).
                  </span>
                </div>

                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={handleCancelEditProfile}
                    disabled={profileSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={profileSaving}
                  >
                    {profileSaving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </form>
            ) : (
              <dl className={styles.detailsList}>
                <div><dt>Full name</dt><dd>{customer.full_name}</dd></div>
                <div><dt>Email address</dt><dd>{customer.email || "Not provided"}</dd></div>
                <div><dt>Mobile number</dt><dd>{customer.phone || "Not provided"}</dd></div>
                <div><dt>Default Address</dt><dd>{customer.address || "None set"}</dd></div>
              </dl>
            )}
          </section>
        </div>

        {/* Saved Addresses Section */}
        <section className={styles.addressesSection} aria-labelledby="addresses-title">
          <div className={styles.addressesHeader}>
            <div>
              <p className={styles.eyebrow}>Delivery destinations</p>
              <h2 id="addresses-title">Saved Addresses</h2>
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleOpenAddAddress}
            >
              <PlusIcon size={14} style={{ display: "inline", marginRight: "5px", verticalAlign: "-2px" }} />
              <span>Add New Address</span>
            </button>
          </div>

          {loadingAddresses ? (
            <p className={styles.helperText}>Loading saved addresses...</p>
          ) : addresses.length === 0 ? (
            <div className={styles.emptyAddresses}>
              <p>You don&apos;t have any saved delivery addresses yet.</p>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleOpenAddAddress}
              >
                Add your first address
              </button>
            </div>
          ) : (
            <div className={styles.addressGrid}>
              {addresses.map((addr) => (
                <article
                  key={addr.id}
                  className={`${styles.addressCard} ${addr.is_default ? styles.addressCardDefault : ""}`}
                >
                  <div>
                    <div className={styles.addressCardTop}>
                      <div className={styles.addressBadges}>
                        <span className={styles.labelBadge}>{addr.label}</span>
                        {addr.is_default && (
                          <span className={styles.defaultBadge}>
                            <CheckIcon size={11} style={{ display: "inline", marginRight: "3px", verticalAlign: "-1px" }} />
                            <span>Default</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <h3 className={styles.recipientName}>{addr.recipient_name}</h3>
                    <p className={styles.addressLine}>{addr.street_address}</p>
                    <p className={styles.addressLine}>
                      {[addr.city, addr.state_province, addr.postal_code].filter(Boolean).join(", ")}
                    </p>
                    <p className={styles.addressPhone}>Phone: {addr.phone}</p>
                    {addr.delivery_instructions && (
                      <p className={styles.deliveryNote}>
                        Note: {addr.delivery_instructions}
                      </p>
                    )}
                  </div>

                  <div className={styles.addressActions}>
                    {!addr.is_default && (
                      <button
                        type="button"
                        className={styles.cardAction}
                        onClick={() => handleSetDefaultAddress(addr.id)}
                        disabled={settingDefaultId === addr.id}
                      >
                        {settingDefaultId === addr.id ? "Setting..." : "Set as Default"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.cardAction}
                      onClick={() => handleOpenEditAddress(addr)}
                      aria-label={`Edit address ${addr.label}`}
                    >
                      <EditIcon size={12} style={{ display: "inline", marginRight: "3px", verticalAlign: "-1px" }} />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.cardAction} ${styles.cardActionDanger}`}
                      onClick={() => handleDeleteAddress(addr.id)}
                      disabled={deletingAddressId === addr.id}
                      aria-label={`Delete address ${addr.label}`}
                    >
                      <TrashIcon size={12} style={{ display: "inline", marginRight: "3px", verticalAlign: "-1px" }} />
                      <span>{deletingAddressId === addr.id ? "Removing..." : "Delete"}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {/* Add / Edit Address Modal */}
      {addressModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={handleCloseAddressModal}
        >
          <div
            className={styles.modalDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="address-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 id="address-modal-title">
                {editingAddress ? "Edit Saved Address" : "Add New Saved Address"}
              </h3>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleCloseAddressModal}
                aria-label="Close dialog"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAddress} noValidate>
              <div className={styles.modalBody}>
                {addressModalError && (
                  <p className={styles.inlineError} role="alert">
                    {addressModalError}
                  </p>
                )}

                <div className={styles.formGrid}>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label htmlFor="address-label">Label *</label>
                      <select
                        id="address-label"
                        className={styles.select}
                        value={addressForm.label}
                        onChange={(e) =>
                          setAddressForm((prev) => ({ ...prev, label: e.target.value }))
                        }
                      >
                        <option value="Home">Home</option>
                        <option value="Work">Work</option>
                        <option value="Office">Office</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label htmlFor="address-recipient">Recipient Name *</label>
                      <input
                        id="address-recipient"
                        type="text"
                        required
                        className={styles.input}
                        value={addressForm.recipient_name}
                        onChange={(e) =>
                          setAddressForm((prev) => ({
                            ...prev,
                            recipient_name: e.target.value,
                          }))
                        }
                        placeholder="Recipient full name"
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label htmlFor="address-phone">Contact Phone *</label>
                    <input
                      id="address-phone"
                      type="tel"
                      required
                      className={styles.input}
                      value={addressForm.phone}
                      onChange={(e) =>
                        setAddressForm((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      placeholder="09171234567 or +639171234567"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label htmlFor="address-street">Street Address & Landmark *</label>
                    <textarea
                      id="address-street"
                      required
                      rows={2}
                      className={styles.textarea}
                      value={addressForm.street_address}
                      onChange={(e) =>
                        setAddressForm((prev) => ({
                          ...prev,
                          street_address: e.target.value,
                        }))
                      }
                      placeholder="Unit, Building, Street, Barangay"
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label htmlFor="address-city">City *</label>
                      <input
                        id="address-city"
                        type="text"
                        required
                        className={styles.input}
                        value={addressForm.city}
                        onChange={(e) =>
                          setAddressForm((prev) => ({ ...prev, city: e.target.value }))
                        }
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label htmlFor="address-state">State / Province</label>
                      <input
                        id="address-state"
                        type="text"
                        className={styles.input}
                        value={addressForm.state_province}
                        onChange={(e) =>
                          setAddressForm((prev) => ({
                            ...prev,
                            state_province: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label htmlFor="address-postal">Postal / Zip Code</label>
                    <input
                      id="address-postal"
                      type="text"
                      className={styles.input}
                      value={addressForm.postal_code}
                      onChange={(e) =>
                        setAddressForm((prev) => ({
                          ...prev,
                          postal_code: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label htmlFor="address-instructions">Delivery Instructions</label>
                    <textarea
                      id="address-instructions"
                      rows={2}
                      className={styles.textarea}
                      value={addressForm.delivery_instructions}
                      onChange={(e) =>
                        setAddressForm((prev) => ({
                          ...prev,
                          delivery_instructions: e.target.value,
                        }))
                      }
                      placeholder="e.g. Ring doorbell, leave with guard at front desk"
                    />
                  </div>

                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={addressForm.is_default}
                      disabled={editingAddress?.is_default}
                      onChange={(e) =>
                        setAddressForm((prev) => ({
                          ...prev,
                          is_default: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Set as default delivery address
                      {editingAddress?.is_default ? " (Currently default)" : ""}
                    </span>
                  </label>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleCloseAddressModal}
                  disabled={addressSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={addressSaving}
                >
                  {addressSaving ? "Saving..." : editingAddress ? "Save Changes" : "Add Address"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
