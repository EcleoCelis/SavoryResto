"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessDenied } from "../../components/auth/AccessDenied";
import { ManagerSidebar } from "../../components/manager/ManagerSidebar";
import { MenuToggleIcon } from "../../components/ui/Icons";
import { getCustomerMe } from "../../lib/api/auth";
import { getCurrentStaff } from "../../lib/api/staff";
import type { AppRole } from "../../lib/rbac";
import type { StaffUser } from "../../types/staff";
import styles from "./layout.module.css";

type ManagerAuthState = "checking" | "authorized" | "denied" | "unauthenticated";

export default function ManagerLayout({ children }: LayoutProps<"/manager">) {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [authState, setAuthState] = useState<ManagerAuthState>("checking");
  const [deniedRole, setDeniedRole] = useState<AppRole | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function verifyManagerAccess() {
      try {
        const staffUser = await getCurrentStaff();
        if (!active) return;

        if (staffUser.role !== "manager") {
          setStaff(null);
          setDeniedRole(staffUser.role);
          setAuthState("denied");
          return;
        }

        setDeniedRole(null);
        setStaff(staffUser);
        setAuthState("authorized");
      } catch {
        if (!active) return;
        setStaff(null);

        // Distinguish authenticated Customer (403 Access Denied) from Unauthenticated (redirect to /staff/login)
        const customer = await getCustomerMe().catch(() => null);
        if (!active) return;

        if (customer) {
          setDeniedRole("customer");
          setAuthState("denied");
          return;
        }

        setAuthState("unauthenticated");
        router.replace("/staff/login");
      }
    }

    void verifyManagerAccess();

    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted && active) {
        setAuthState("checking");
        void verifyManagerAccess();
      }
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      active = false;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [router]);

  if (authState === "denied") {
    return <AccessDenied portal="manager" actualRole={deniedRole} />;
  }

  if (authState !== "authorized" || !staff) {
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
          <span className={styles.mobileStaffBadge}>{staff.name}</span>
        </header>

        {/* Main Content Area */}
        <main id="manager-main-content" className={styles.mainContent}>
          {children}
        </main>
      </div>
    </div>
  );
}
