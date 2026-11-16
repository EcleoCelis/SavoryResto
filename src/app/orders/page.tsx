"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { CustomerRouteGuard } from "../../components/auth/CustomerRouteGuard";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { ArrowLeftIcon, ArrowRightIcon, RefreshIcon } from "../../components/ui/Icons";
import { getOrders, OrderApiError } from "../../lib/api/orders";
import { orderStatusLabel } from "../../lib/order-status";
import { reorderToCart } from "../../lib/reorder";
import type { OrderHistory } from "../../types/order";
import styles from "./orders.module.css";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

function OrdersContent() {
  const router = useRouter();
  const [history, setHistory] = useState<OrderHistory | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [reorderingId, setReorderingId] = useState<number | null>(null);
  const [reorderError, setReorderError] = useState("");

  useEffect(() => {
    let active = true;
    void getOrders(page)
      .then((loadedHistory) => {
        if (active) setHistory(loadedHistory);
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof OrderApiError && requestError.status === 401) {
          router.replace("/login");
          return;
        }
        setError(
          requestError instanceof Error ? requestError.message : "Unable to load your orders."
        );
      });
    return () => {
      active = false;
    };
  }, [page, retry, router]);

  function retryLoad() {
    setError("");
    setHistory(null);
    setRetry((current) => current + 1);
  }

  function changePage(nextPage: number) {
    setError("");
    setHistory(null);
    setPage(nextPage);
  }

  async function handleReorder(orderId: number) {
    setReorderingId(orderId);
    setReorderError("");
    try {
      const result = await reorderToCart(orderId);
      if (result.addedCount === 0) {
        setReorderError(result.summaryMessage);
      } else {
        router.push("/cart");
      }
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : "Unable to reorder items.");
    } finally {
      setReorderingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <Header />
      <main id="main-content" className={styles.content} aria-labelledby="orders-title">
        <header className={styles.intro}>
          <p>Customer Account</p>
          <h1 id="orders-title">Your Order History</h1>
          <span>Review the dishes and dining orders placed from your SavoryBites account.</span>
        </header>

        {error ? (
          <section className={styles.message} role="alert">
            <h2>Orders Unavailable</h2>
            <p>{error}</p>
            <button type="button" onClick={retryLoad}>
              Try again
            </button>
          </section>
        ) : !history ? (
          <section className={styles.message} aria-live="polite">
            <p>Loading your order history...</p>
          </section>
        ) : history.items.length === 0 ? (
          <section className={styles.message}>
            <h2>No orders placed yet</h2>
            <p>Your dining and counter pickup orders will appear here once submitted.</p>
            <Link href="/menu">Browse the menu</Link>
          </section>
        ) : (
          <>
            {reorderError && (
              <div className={styles.message} role="alert" style={{ marginBottom: 18, padding: "14px 20px" }}>
                <p style={{ margin: 0 }}>{reorderError}</p>
              </div>
            )}
            <div className={styles.orders} aria-label="List of past orders">
              {history.items.map((order) => (
                <article key={order.id}>
                  <div>
                    <p className={styles.number}>Order #{order.order_number}</p>
                    <p>
                      {dateFormatter.format(new Date(order.ordered_at))}
                      {order.payment_method_label ? ` · ${order.payment_method_label}` : ""} ·{" "}
                      {order.item_count} {order.item_count === 1 ? "dish" : "dishes"}
                    </p>
                  </div>
                  <span className={`${styles.status} ${styles[order.status] || ""}`}>
                    {orderStatusLabel(order.status)}
                  </span>
                  <strong>{currencyFormatter.format(order.total)}</strong>
                  <div className={styles.orderActions}>
                    <button
                      type="button"
                      className={styles.reorderBtn}
                      onClick={() => void handleReorder(order.id)}
                      disabled={reorderingId === order.id}
                    >
                      <RefreshIcon size={13} />
                      <span>{reorderingId === order.id ? "Checking..." : "Order Again"}</span>
                    </button>
                    <Link href={`/order-confirmation/${order.id}`}>
                      <span>View order</span>
                      <ArrowRightIcon size={14} style={{ display: "inline", marginLeft: "4px", verticalAlign: "-2px" }} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            {history.total > history.page_size ? (
              <nav className={styles.pagination} aria-label="Order history pages">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => changePage(page - 1)}
                  aria-label="Previous page"
                >
                  <ArrowLeftIcon size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
                  <span>Previous</span>
                </button>
                <span>
                  Page {history.page} of {Math.ceil(history.total / history.page_size)}
                </span>
                <button
                  type="button"
                  disabled={history.page * history.page_size >= history.total}
                  onClick={() => changePage(page + 1)}
                  aria-label="Next page"
                >
                  <span>Next</span>
                  <ArrowRightIcon size={14} style={{ display: "inline", marginLeft: "4px", verticalAlign: "-2px" }} />
                </button>
              </nav>
            ) : null}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <CustomerRouteGuard>
      <OrdersContent />
    </CustomerRouteGuard>
  );
}
