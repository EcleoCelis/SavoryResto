"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutCustomer } from "../../lib/api/auth";
import { staffLogout } from "../../lib/api/staff";
import {
  homePathForRole,
  loginPathForPortal,
  portalDisplayName,
  roleDisplayName,
  type AppRole,
  type PortalName,
} from "../../lib/rbac";
import styles from "./access-denied.module.css";

interface AccessDeniedProps {
  portal: PortalName;
  actualRole?: AppRole | null;
}

export function AccessDenied({ portal, actualRole }: AccessDeniedProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const portalLabel = portalDisplayName(portal);
  const currentRoleLabel = roleDisplayName(actualRole);
  const homeHref = homePathForRole(actualRole);
  const homeLabel =
    actualRole === "manager"
      ? "Return to Manager Portal"
      : actualRole === "kitchen_staff"
        ? "Return to KDS Workspace"
        : "Return to Restaurant Home";

  async function handleSwitchAccount() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (actualRole === "customer") {
        await logoutCustomer().catch(() => undefined);
      } else if (actualRole === "manager" || actualRole === "kitchen_staff") {
        await staffLogout().catch(() => undefined);
      }
    } finally {
      router.replace(loginPathForPortal(portal));
    }
  }

  return (
    <main className={styles.wrapper} role="main" aria-labelledby="access-denied-title">
      <section className={styles.card}>
        <div className={styles.badge}>
          <span aria-hidden="true">403</span>
          <span>Access Denied</span>
        </div>

        <h1 id="access-denied-title" className={styles.title}>
          You are not authorized to access {portalLabel}
        </h1>

        <p className={styles.description}>
          SavoryBites enforces strict workspace isolation between Customer, Manager, and Kitchen
          Display System (KDS) accounts. Your current role does not permit access to this area.
        </p>

        <div className={styles.roleBox}>
          <span>
            Signed-in role: <strong>{currentRoleLabel}</strong>
          </span>
          <span>
            Requested workspace: <strong>{portalLabel}</strong>
          </span>
        </div>

        <div className={styles.actions}>
          <Link href={homeHref} className={styles.primaryBtn}>
            {homeLabel}
          </Link>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void handleSwitchAccount()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign out & switch account"}
          </button>
        </div>
      </section>
    </main>
  );
}
