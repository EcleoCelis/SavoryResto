import { orderStatusLabel } from "../../lib/order-status";
import type { Order, OrderStatus } from "../../types/order";
import { CheckIcon } from "../ui/Icons";
import styles from "../../app/order-confirmation/order-confirmation.module.css";

const statuses: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "completed"];

export function OrderTracking({ order }: { order: Order }) {
  if (order.status === "cancelled") {
    return <section className={styles.tracking} aria-label="Order tracking"><h2>Order tracking</h2><p className={styles.cancelledTracking}>This order was cancelled{order.cancelled_at ? ` on ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.cancelled_at))}` : ""}.</p>{order.cancellation_reason ? <p className={styles.reason}>Reason: {order.cancellation_reason}</p> : null}</section>;
  }

  const currentIndex = statuses.indexOf(order.status);
  const readyLabel = order.fulfillment_type === "table_service" ? "Ready for table service" : "Ready for counter pickup";
  const stages = ["Order received", "Confirmed", "Preparing", readyLabel, "Completed"];

  return <section className={styles.tracking} aria-label="Order tracking"><div className={styles.trackingHeading}><h2>Order tracking</h2><span aria-live="polite">Live status: {orderStatusLabel(order.status)}</span></div><ol>{stages.map((label, index) => <li key={label} className={index < currentIndex ? styles.complete : index === currentIndex ? styles.current : ""}><span aria-hidden="true">{index < currentIndex ? <CheckIcon size={12} /> : index === currentIndex ? "•" : "○"}</span><div><b>{label}</b>{index === currentIndex ? <small>Current status</small> : null}</div></li>)}</ol><p className={styles.refreshNote}>Status refreshes automatically while this order is active.</p></section>;
}
