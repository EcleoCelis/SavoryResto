"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { KdsSidebar } from "../../components/kds/KdsSidebar";
import { getCurrentStaff, getKdsOrders, staffLogout, StaffApiError, updateKdsStatus } from "../../lib/api/staff";
import { RefreshIcon } from "../../components/ui/Icons";
import type { KdsOrder, StaffUser } from "../../types/staff";
import styles from "./kds.module.css";

type StatusFilter = Exclude<KdsOrder["status"], "cancelled"> | "overview";
const filters = new Set<StatusFilter>(["overview", "pending", "confirmed", "preparing", "ready", "completed"]);
const labels: Record<StatusFilter, { eyebrow: string; title: string; empty: string }> = {
  overview: { eyebrow: "Kitchen overview", title: "Live kitchen orders", empty: "New orders will appear here when customers place them." },
  pending: { eyebrow: "New orders", title: "Awaiting confirmation", empty: "There are no new orders to confirm." },
  confirmed: { eyebrow: "Confirmed", title: "Ready to start", empty: "There are no confirmed orders waiting to start." },
  preparing: { eyebrow: "Preparing", title: "In the kitchen", empty: "There are no orders being prepared." },
  ready: { eyebrow: "Ready", title: "Ready for fulfillment", empty: "There are no orders ready for fulfillment." },
  completed: { eyebrow: "Completed", title: "Completed orders", empty: "No completed orders are available." },
};

function nextStatus(order: KdsOrder, staff: StaffUser | null): KdsOrder["status"] | null {
  if (order.status === "pending") return "confirmed";
  if (order.status === "confirmed") return "preparing";
  if (order.status === "preparing") return "ready";
  return order.status === "ready" && staff?.role === "manager" ? "completed" : null;
}

function KdsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("status");
  const activeFilter: StatusFilter = requested !== null && filters.has(requested as StatusFilter) ? requested as StatusFilter : "overview";
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [activeOrders, setActiveOrders] = useState<KdsOrder[]>([]);
  const [completedOrders, setCompletedOrders] = useState<KdsOrder[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [currentStaff, activeQueue, completedQueue] = await Promise.all([
        getCurrentStaff(),
        getKdsOrders(),
        activeFilter === "completed" ? getKdsOrders("completed") : Promise.resolve<KdsOrder[]>([]),
      ]);
      setStaff(currentStaff);
      setActiveOrders(activeQueue);
      setCompletedOrders(completedQueue);
    } catch (requestError) {
      if (requestError instanceof StaffApiError && requestError.status === 401) { router.replace("/staff/login"); return; }
      if (requestError instanceof StaffApiError && requestError.status === 403) { setError("Your staff account is not authorized to use the kitchen display."); return; }
      setError(requestError instanceof Error ? requestError.message : "Unable to load KDS.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function refreshQueue() {
      try {
        const [currentStaff, activeQueue, completedQueue] = await Promise.all([
          getCurrentStaff(),
          getKdsOrders(),
          activeFilter === "completed" ? getKdsOrders("completed") : Promise.resolve<KdsOrder[]>([]),
        ]);
        if (!active) return;
        setStaff(currentStaff);
        setActiveOrders(activeQueue);
        setCompletedOrders(completedQueue);
        setError("");
      } catch (requestError) {
        if (!active) return;
        if (requestError instanceof StaffApiError && requestError.status === 401) { router.replace("/staff/login"); return; }
        if (requestError instanceof StaffApiError && requestError.status === 403) { setError("Your staff account is not authorized to use the kitchen display."); return; }
        setError(requestError instanceof Error ? requestError.message : "Unable to load KDS.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void refreshQueue();
    const interval = window.setInterval(() => void refreshQueue(), 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [activeFilter, router]); // The URL filter determines the visible KDS workspace.

  async function advance(order: KdsOrder) {
    const target = nextStatus(order, staff);
    if (target === null) return;
    setUpdating(order.id);
    setError("");
    try {
      const updated = await updateKdsStatus(order.id, target);
      setActiveOrders((current) => target === "completed" ? current.filter((entry) => entry.id !== updated.id) : current.map((entry) => entry.id === updated.id ? updated : entry));
      if (target === "completed") setCompletedOrders((current) => [updated, ...current]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update order.");
    } finally {
      setUpdating(null);
    }
  }

  async function logout() { await staffLogout().catch(() => undefined); router.replace("/staff/login"); }

  const visibleOrders = activeFilter === "completed" ? completedOrders : activeFilter === "overview" ? activeOrders : activeOrders.filter((order) => order.status === activeFilter);
  const counts = activeOrders.reduce<Partial<Record<KdsOrder["status"], number>>>((result, order) => ({ ...result, [order.status]: (result[order.status] ?? 0) + 1 }), {});
  const view = labels[activeFilter];

  return <main className={styles.page}>
    <KdsSidebar activeFilter={activeFilter} counts={counts} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={() => void logout()} staff={staff} />
    {sidebarOpen ? <button className={styles.overlay} type="button" aria-label="Close kitchen navigation" onClick={() => setSidebarOpen(false)} /> : null}
    <section className={styles.workspace}>
      <header className={styles.header}><button className={styles.menuButton} type="button" onClick={() => setSidebarOpen(true)} aria-label="Open kitchen navigation"><span /><span /><span /></button><div><p>{view.eyebrow}</p><h1>{view.title}</h1></div><div className={styles.refresh}><span aria-live="polite">Updates every 15 seconds</span><button type="button" onClick={() => void load(false)} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><RefreshIcon size={14} /> Refresh</button></div></header>
      <section className={styles.content}>{error ? <section className={styles.message} role="alert"><h2>Kitchen display unavailable</h2><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></section> : null}{loading ? <section className={styles.message} aria-live="polite"><p>Loading kitchen orders...</p></section> : null}{!loading && !error && visibleOrders.length === 0 ? <section className={styles.message}><h2>{activeFilter === "overview" ? "Kitchen is clear" : "Nothing here yet"}</h2><p>{view.empty}</p></section> : null}<div className={styles.grid}>{!loading && !error ? visibleOrders.map((order) => { const target = nextStatus(order, staff); return <article key={order.id} className={styles.card}><div className={styles.top}><div><p>{order.order_number}</p><span>{order.fulfillment_destination} · {order.order_type.replace("_", " ")}</span></div><b className={styles[order.status]}>{order.status.replace("_", " ")}</b></div>{order.allergy_alert ? <div className={styles.allergyBox} role="note"><strong>Allergy Alert</strong><span>{order.allergy_alert}</span></div> : null}{order.notes ? <div className={styles.notesBox}><strong>Prep Note</strong><span>{order.notes}</span></div> : null}<ul>{order.items.map((item, index) => <li key={`${item.name}-${index}`}><b>{item.quantity} x {item.name}</b><span>{[item.size, ...item.addons].filter(Boolean).join(" / ")}</span></li>)}</ul>{target ? <button type="button" onClick={() => void advance(order)} disabled={updating === order.id}>{updating === order.id ? "Updating..." : `Mark ${target}`}</button> : <p className={styles.noAction}>{order.status === "ready" ? "Manager fulfillment required" : "No further kitchen action"}</p>}</article>; }) : null}</div></section>
    </section>
  </main>;
}

export default function KdsPage() { return <Suspense fallback={<main className={styles.loadingPage}>Loading kitchen display...</main>}><KdsWorkspace /></Suspense>; }
