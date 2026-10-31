export type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";

export type OrderItem = {
  product_id: number;
  name: string;
  size: string | null;
  addons: string[];
  quantity: number;
  unit_price: number;
  subtotal: number;
};

export type OrderPaymentMethod = {
  id: number;
  code: string;
  label: string;
  description: string | null;
};

export type Order = {
  id: number;
  order_number: string;
  status: OrderStatus;
  order_type: string;
  fulfillment_type: string | null;
  table_number: string | null;
  customer_id: number;
  subtotal: number;
  total: number;
  payment_method: OrderPaymentMethod | null;
  ordered_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  is_cancellable: boolean;
  items: OrderItem[];
};

export type OrderHistoryItem = {
  id: number;
  order_number: string;
  status: OrderStatus;
  order_type: string;
  fulfillment_type: string | null;
  table_number: string | null;
  total: number;
  ordered_at: string;
  item_count: number;
};

export type OrderHistory = {
  items: OrderHistoryItem[];
  page: number;
  page_size: number;
  total: number;
};
