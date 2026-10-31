import type { OrderStatus } from "../types/order";

const labels: Record<OrderStatus, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    preparing: "Preparing",
    ready: "Ready",
    completed: "Completed",
    cancelled: "Cancelled",
};

export function orderStatusLabel(status: OrderStatus | string) {
  return status in labels ? labels[status as OrderStatus] : "Status unavailable";
}
