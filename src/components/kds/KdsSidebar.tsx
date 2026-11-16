"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { CloseIcon } from "../ui/Icons";
import type { KdsOrder, StaffUser } from "../../types/staff";
import styles from "./KdsSidebar.module.css";

type StatusFilter = Exclude<KdsOrder["status"], "cancelled"> | "overview";

const items: Array<{ label: string; status: StatusFilter; icon: string; countable?: boolean }> = [
  { label: "Overview", status: "overview", icon: "grid" },
  { label: "New orders", status: "pending", icon: "inbox", countable: true },
  { label: "Confirmed", status: "confirmed", icon: "check", countable: true },
  { label: "Preparing", status: "preparing", icon: "flame", countable: true },
  { label: "Ready", status: "ready", icon: "bell", countable: true },
  { label: "Completed", status: "completed", icon: "archive" },
];

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    inbox: <><path d="M4 5h16v14H4z" /><path d="M4 14h5l2 3h2l2-3h5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    flame: <path d="M12 21c4 0 7-3 7-7 0-4-3-7-5-10 0 3-2 4-3 6-1-2-1-4 0-6-3 3-6 6-6 10 0 4 3 7 7 7Z" />,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 22h4" /></>,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v11h14V9M10 13h4" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{paths[name]}</svg>;
}

export type KdsSidebarProps = {
  activeFilter: StatusFilter;
  counts: Partial<Record<KdsOrder["status"], number>>;
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  staff: StaffUser | null;
};

export function KdsSidebar({ activeFilter, counts, isOpen, onClose, onLogout, staff }: KdsSidebarProps) {
  return <aside className={`${styles.sidebar} ${isOpen ? styles.open : ""}`} aria-label="Kitchen display navigation">
    <div className={styles.brand}><span className={styles.mark}>S</span><div><strong>SavoryBites</strong><span>Kitchen display</span></div><button type="button" className={styles.close} onClick={onClose} aria-label="Close kitchen navigation"><CloseIcon size={16} /></button></div>
    <nav aria-label="Kitchen navigation" className={styles.navigation}>
      <p>Kitchen</p>
      {items.map((item) => {
        const href = item.status === "overview" ? "/kds" : `/kds?status=${item.status}`;
        const isActive = activeFilter === item.status;
        const count = item.countable && item.status !== "overview" ? counts[item.status] ?? 0 : undefined;
        return <Link key={item.status} href={href} onClick={onClose} className={isActive ? styles.active : ""} aria-current={isActive ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span>{count !== undefined ? <b aria-label={`${count} ${item.label}`}>{count}</b> : null}</Link>;
      })}
    </nav>
    <div className={styles.session}>{staff ? <><span className={styles.avatar} aria-hidden="true">{staff.name.slice(0, 1).toUpperCase()}</span><div><strong>{staff.name}</strong><span>Kitchen staff</span></div></> : null}<button type="button" onClick={onLogout}>Sign out</button></div>
  </aside>;
}
