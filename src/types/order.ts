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

export type DeliveryAddressSnapshot = {
  id?: number;
  label?: string;
  recipient_name?: string;
  phone?: string;
  street_address?: string;
  barangay?: string | null;
  city?: string;
  state_province?: string | null;
  postal_code?: string | null;
  delivery_instructions?: string | null;
  is_within_service_area?: boolean;
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
  delivery_address_snapshot?: DeliveryAddressSnapshot | null;
  kitchen_allergy_alert?: string | null;
  notes?: string | null;
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
  payment_method_label?: string | null;
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

export type ReorderAvailableItem = {
  product_id: number;
  name: string;
  image_url: string | null;
  size: string;
  addons: string[];
  quantity: number;
  current_unit_price: number;
  previous_unit_price: number;
  price_changed: boolean;
};

export type ReorderUnavailableItem = {
  product_id: number;
  name: string;
  reason: string;
};

export type ReorderPreview = {
  order_id: number;
  order_number: string;
  available_items: ReorderAvailableItem[];
  unavailable_items: ReorderUnavailableItem[];
  has_price_changes: boolean;
};
