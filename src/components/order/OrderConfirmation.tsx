"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { cancelOrder, getOrder, OrderApiError } from "../../lib/api/orders";
import { orderStatusLabel } from "../../lib/order-status";
import type { Order } from "../../types/order";
import styles from "../../app/order-confirmation/order-confirmation.module.css";
import { OrderTracking } from "./OrderTracking";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function OrderConfirmation({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [showCancellationConfirm, setShowCancellationConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationError, setCancellationError] = useState("");
  const shouldPoll =
    order === null || (order.status !== "completed" && order.status !== "cancelled");

  useEffect(() => {
    let active = true;
    if (!shouldPoll)
      return () => {
        active = false;
      };
    async function loadOrder() {
      try {
        const loadedOrder = await getOrder(orderId);
        if (active) setOrder(loadedOrder);
      } catch (requestError) {
        if (!active) return;
        if (requestError instanceof OrderApiError && requestError.status === 401) {
          router.replace("/login");
          return;
        }
        setError(
          requestError instanceof Error ? requestError.message : "Unable to load this order."
        );
      }
    }
    void loadOrder();
    const intervalId = window.setInterval(() => void loadOrder(), 15000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [orderId, router, shouldPoll]);

  async function handleCancel() {
    if (!order) return;
    setCancelling(true);
    setCancellationError("");
    try {
      const cancelledOrder = await cancelOrder(order.id);
      setOrder(cancelledOrder);
      setShowCancellationConfirm(false);
    } catch (requestError) {
      if (requestError instanceof OrderApiError && requestError.status === 401) {
        router.replace("/login");
        return;
      }
      setCancellationError(
        requestError instanceof Error ? requestError.message : "Unable to cancel this order."
      );
    } finally {
      setCancelling(false);
    }
  }

  if (error) {
    return (
      <section className={styles.card} role="alert">
        <h1>Order unavailable</h1>
        <p>{error}</p>
        <Link href="/menu">Return to menu</Link>
      </section>
    );
  }

  if (!order) {
    return (
      <section className={styles.card} aria-live="polite">
        <p>Loading your order details...</p>
      </section>
    );
  }

  const fulfillmentMessage =
    order.fulfillment_type === "table_service"
      ? `We will bring your order to ${order.table_number ?? "your table"} when it is ready.`
      : "We have received your counter-pickup order and will begin preparing it shortly.";
  const heading =
    order.status === "pending" ? "Thank You For Your Order!" : `Order ${order.order_number}`;

  return (
    <section className={styles.card} aria-labelledby="order-heading">
      <p className={styles.kicker}>
        {order.status === "pending" ? "Order Confirmed" : "Live Status"}
      </p>
      <h1 id="order-heading">{heading}</h1>
      <p className={styles.orderNumber}>Reference #{order.order_number}</p>
      <p className={styles.serviceLine}>
        Placed on {dateFormatter.format(new Date(order.ordered_at))} ·{" "}
        {order.fulfillment_type === "table_service"
          ? `Table Service (${order.table_number ?? "Assigned"})`
          : "Counter Pickup"}
      </p>

      <span className={styles.status}>{orderStatusLabel(order.status)}</span>
      <p className={styles.fulfillmentNote}>{fulfillmentMessage}</p>

      <OrderTracking order={order} />

      <div className={styles.items} aria-label="Ordered dishes list">
        {order.items.map((item) => (
          <article key={`${item.product_id}-${item.name}`}>
            <div>
              <b>{item.name}</b>
              <span>{[item.size, ...item.addons].filter(Boolean).join(" · ")}</span>
              <small>
                {item.quantity} × {currencyFormatter.format(item.unit_price)}
              </small>
            </div>
            <strong className={styles.itemSubtotal}>
              {currencyFormatter.format(item.subtotal)}
            </strong>
          </article>
        ))}
      </div>

      <div className={styles.total}>
        <span>Total Paid</span>
        <strong>{currencyFormatter.format(order.total)}</strong>
      </div>

      {order.is_cancellable ? (
        <div className={styles.cancellation}>
          <button
            type="button"
            onClick={() => {
              setCancellationError("");
              setShowCancellationConfirm(true);
            }}
          >
            Cancel this order
          </button>
          {showCancellationConfirm ? (
            <section
              className={styles.cancellationConfirm}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-order-title"
            >
              <h2 id="cancel-order-title">Cancel this order?</h2>
              <p>
                Are you sure you want to cancel order #{order.order_number}? This cannot be undone once confirmed.
              </p>
              {cancellationError ? (
                <p className={styles.cancellationError} role="alert">
                  {cancellationError}
                </p>
              ) : null}
              <div>
                <button
                  type="button"
                  onClick={() => setShowCancellationConfirm(false)}
                  disabled={cancelling}
                >
                  Keep order
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling..." : "Confirm cancellation"}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        <Link href="/orders">View all your orders</Link>
        <Link href="/menu" className={styles.menuLink}>
          Explore menu dishes
        </Link>
      </div>
    </section>
  );
}
