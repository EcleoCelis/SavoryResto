import type { CheckoutQuoteRequest } from "../../types/checkout";
import type {
  Order,
  OrderHistory,
  OrderHistoryItem,
  OrderItem,
  ReorderPreview,
} from "../../types/order";
import { getApiBaseUrl } from "./base-url";

export class OrderApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type OrderApiResponse = Omit<Order, "subtotal" | "total" | "items"> & {
  subtotal: number | string;
  total: number | string;
  items: Array<Omit<OrderItem, "unit_price" | "subtotal"> & { unit_price: number | string; subtotal: number | string }>;
};
type OrderHistoryApiResponse = Omit<OrderHistory, "items"> & { items: Array<Omit<OrderHistoryItem, "total"> & { total: number | string }> };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, { credentials: "include", ...init });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null && "detail" in data ? data.detail : null;
    throw new OrderApiError(response.status, typeof detail === "string" ? detail : "Unable to place the order.");
  }
  return data as T;
}

function normalizeOrder(order: OrderApiResponse): Order {
  return {
    ...order,
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    items: order.items.map((item) => ({ ...item, unit_price: Number(item.unit_price), subtotal: Number(item.subtotal) })),
  };
}

export function createOrder(
  payload: CheckoutQuoteRequest & {
    payment_method_code: string;
    order_type: "dine_in" | "takeout";
    fulfillment_type: "table_service" | "counter_pickup";
    restaurant_table_id: number | null;
    selected_address_id?: number | null;
    include_allergy_alert?: boolean;
    preparation_notes?: string | null;
  },
  idempotencyKey: string,
) {
  return request<OrderApiResponse>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  }).then(normalizeOrder);
}

export function getOrder(orderId: string) {
  return request<OrderApiResponse>(`/api/v1/orders/${encodeURIComponent(orderId)}`).then(normalizeOrder);
}

export function cancelOrder(orderId: number, reason?: string) {
  return request<OrderApiResponse>(`/api/v1/orders/${orderId}/cancel`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {}),
  }).then(normalizeOrder);
}

export function getOrders(page = 1) {
  return request<OrderHistoryApiResponse>(`/api/v1/orders?page=${page}&page_size=10`).then((history) => ({
    ...history,
    items: history.items.map((item) => ({ ...item, total: Number(item.total) })),
  }));
}

export function getReorderPreview(orderId: number): Promise<ReorderPreview> {
  return request<ReorderPreview>(`/api/v1/orders/${orderId}/reorder-preview`, {
    method: "POST",
  }).then((preview) => ({
    ...preview,
    available_items: (preview.available_items || []).map((item) => ({
      ...item,
      current_unit_price: Number(item.current_unit_price),
      previous_unit_price: Number(item.previous_unit_price),
    })),
  }));
}
