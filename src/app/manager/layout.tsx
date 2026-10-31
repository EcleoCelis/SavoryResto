"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ManagerSidebar } from "../../components/manager/ManagerSidebar";
import { MenuToggleIcon } from "../../components/ui/Icons";
import { getCurrentStaff, StaffApiError } from "../../lib/api/staff";
import type { StaffUser } from "../../types/staff";
import styles from "./layout.module.css";

export default function ManagerLayout({ children }: LayoutProps<"/manager">) {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkStaffAuth() {
      try {
        const staffUser = await getCurrentStaff();
        if (!active) return;

        if (staffUser.role !== "manager") {
          // If staff is kitchen_staff or other, redirect to KDS workspace
          router.replace("/kds");
          return;
        }

        setStaff(staffUser);
      } catch (err) {
        if (!active) return;
        if (err instanceof StaffApiError && (err.status === 401 || err.status === 403)) {
          router.replace("/staff/login");
          return;
        }
        // Fallback redirect to login
        router.replace("/staff/login");
      } finally {
        if (active) setLoading(false);
      }
    }

    void checkStaffAuth();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <div className={styles.loadingContainer} aria-live="polite">
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.loadingText}>Verifying manager credentials...</p>
      </div>
    );
  }

  return (
    <div className={styles.managerShell}>
      {/* Shared Sidebar Navigation */}
      <ManagerSidebar
        staff={staff}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className={styles.mainWrapper}>
        {/* Mobile Header Bar */}
        <header className={styles.mobileBar} aria-label="Mobile Navigation Bar">
          <div className={styles.mobileBarLeft}>
            <button
              type="button"
              className={styles.menuToggleBtn}
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open sidebar navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              <MenuToggleIcon size={20} />
            </button>
            <span className={styles.mobileBrandName}>SavoryBites</span>
          </div>
          {staff && <span className={styles.mobileStaffBadge}>{staff.name}</span>}
        </header>

        {/* Main Content Area */}
        <main id="manager-main-content" className={styles.mainContent}>
          {children}
        </main>
      </div>
    </div>
  );
}
