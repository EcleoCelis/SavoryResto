"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "./AuthProvider";
import { AccessDenied } from "./AccessDenied";
import { getCurrentStaff } from "../../lib/api/staff";
import type { AppRole } from "../../lib/rbac";

type GuardState = "checking" | "authorized" | "denied" | "unauthenticated";

export function CustomerRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, refreshUser } = useAuth();
  const [staffRole, setStaffRole] = useState<AppRole | null>(null);
  const [resolvedNonCustomer, setResolvedNonCustomer] = useState(false);

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    let active = true;

    async function checkStaffSession() {
      try {
        const staff = await getCurrentStaff();
        if (active) setStaffRole(staff.role);
      } catch {
        if (active) setStaffRole(null);
      } finally {
        if (active) setResolvedNonCustomer(true);
      }
    }

    void checkStaffSession();
    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (isLoading || isAuthenticated || !resolvedNonCustomer) return;
    if (staffRole === null) {
      const nextTarget = pathname || "/customer";
      router.replace(`/login?next=${encodeURIComponent(nextTarget)}`);
    }
  }, [isAuthenticated, isLoading, pathname, resolvedNonCustomer, router, staffRole]);

  // Re-validate session when navigating back via browser history (bfcache)
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setResolvedNonCustomer(false);
        void refreshUser().then((loaded) => {
          if (!loaded) {
            void getCurrentStaff()
              .then((staff) => setStaffRole(staff.role))
              .catch(() => setStaffRole(null))
              .finally(() => setResolvedNonCustomer(true));
          }
        });
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [refreshUser]);

  let state: GuardState = "checking";
  if (!isLoading) {
    if (isAuthenticated) {
      state = "authorized";
    } else if (resolvedNonCustomer) {
      state = staffRole ? "denied" : "unauthenticated";
    }
  }

  if (state === "denied") {
    return <AccessDenied portal="customer" actualRole={staffRole} />;
  }

  if (state !== "authorized") {
    return (
      <main
        style={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px",
        }}
        aria-live="polite"
      >
        <p style={{ color: "#4b5d53", fontSize: "0.95rem" }}>
          Verifying customer session...
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
