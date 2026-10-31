"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DashboardIcon,
  BookOpenIcon,
  TableIcon,
  ClipboardListIcon,
  CreditCardIcon,
  UsersIcon,
  MessageSquareIcon,
  UserCogIcon,
  BarChartIcon,
  SettingsIcon,
  LogOutIcon,
  CloseIcon,
} from "../ui/Icons";
import { staffLogout } from "../../lib/api/staff";
import type { StaffUser } from "../../types/staff";
import styles from "./manager-sidebar.module.css";

interface ManagerSidebarProps {
  staff: StaffUser | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItemConfig {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
}

interface NavGroupConfig {
  title: string;
  items: NavItemConfig[];
}

const NAV_GROUPS: NavGroupConfig[] = [
  {
    title: "Menu",
    items: [
      { id: "dashboard", label: "Dashboard", href: "/manager", icon: DashboardIcon },
      { id: "menu", label: "Menu", href: "/manager/menu", icon: BookOpenIcon },
      { id: "tables", label: "Tables", href: "/manager/tables", icon: TableIcon },
    ],
  },
  {
    title: "Offering",
    items: [
      { id: "orders", label: "Orders", href: "/manager/orders", icon: ClipboardListIcon },
      { id: "payments", label: "Payments", href: "/manager/payments", icon: CreditCardIcon, badge: "New" },
      { id: "customer", label: "Customer", href: "/manager/customer", icon: UsersIcon },
    ],
  },
  {
    title: "Back Office",
    items: [
      { id: "testimonial", label: "Testimonial", href: "/manager/testimonial", icon: MessageSquareIcon },
      { id: "user", label: "User", href: "/manager/user", icon: UserCogIcon },
      { id: "reports", label: "Reports", href: "/manager/reports", icon: BarChartIcon },
      { id: "settings", label: "Settings", href: "/manager/settings", icon: SettingsIcon },
    ],
  },
];

export function ManagerSidebar({ staff, mobileOpen, onCloseMobile }: ManagerSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const sidebarRef = useRef<HTMLElement>(null);

  // Close mobile drawer on route navigation
  useEffect(() => {
    onCloseMobile();
  }, [pathname, onCloseMobile]);

  // Handle ESC key press to close drawer
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && mobileOpen) {
        onCloseMobile();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  async function handleLogout() {
    await staffLogout().catch(() => undefined);
    router.replace("/staff/login");
  }

  function isItemActive(href: string): boolean {
    if (href === "/manager") {
      return pathname === "/manager";
    }
    return pathname.startsWith(href);
  }

  const staffName = staff?.name || "Manager";
  const userInitials = staffName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "SB";

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`${styles.mobileOverlay} ${mobileOpen ? styles.mobileOverlayOpen : ""}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside
        ref={sidebarRef}
        className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ""}`}
        aria-label="Manager Navigation"
      >
        {/* Brand header */}
        <div className={styles.brand}>
          <div className={styles.brandLogo} aria-hidden="true">
            SB
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>SavoryBites</span>
            <span className={styles.brandSub}>Restaurant Admin</span>
          </div>
          {mobileOpen && (
            <button
              type="button"
              className="lg:hidden ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              onClick={onCloseMobile}
              aria-label="Close navigation menu"
            >
              <CloseIcon size={20} />
            </button>
          )}
        </div>

        {/* User Profile Card */}
        <div className={styles.userProfile}>
          <div className={styles.userAvatar} aria-hidden="true">
            {userInitials}
          </div>
          <div className={styles.userInfo}>
            <span className={styles.userName} title={staffName}>
              {staffName}
            </span>
            <span className={styles.userRole}>
              <span className={styles.userStatusDot} aria-hidden="true" />
              Manager
            </span>
          </div>
        </div>

        {/* Grouped Navigation Links */}
        <nav className={styles.navScroll}>
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className={styles.navGroup}>
              <span className={styles.navGroupLabel}>{group.title}</span>
              {group.items.map((item) => {
                const IconComponent = item.icon;
                const active = isItemActive(item.href);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className={styles.navIcon} aria-hidden="true">
                      <IconComponent size={18} />
                    </span>
                    <span className={styles.navItemText}>{item.label}</span>
                    {item.badge && <span className={styles.badgeNew}>{item.badge}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className={styles.footer}>
          <Link href="/kds" className={styles.kdsLink} target="_blank" rel="noopener noreferrer">
            Switch to KDS &rarr;
          </Link>
          <button
            type="button"
            className={styles.logoutButton}
            onClick={() => void handleLogout()}
            aria-label="Sign out of manager session"
          >
            <LogOutIcon size={18} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
