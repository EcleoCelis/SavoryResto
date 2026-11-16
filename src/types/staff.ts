export type StaffRole = "kitchen_staff" | "manager";

export type StaffUser = {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
};

export type StaffLoginResponse = StaffUser & {
  message: string;
  target_url: string;
  authorized_roles: string[];
  access_token?: string;
  token_type?: string;
};

export type KdsOrder = {
  id: number;
  order_number: string;
  status: "pending" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";
  order_type: string;
  fulfillment_type: string | null;
  fulfillment_destination: string;
  ordered_at: string;
  allergy_alert?: string | null;
  notes?: string | null;
  items: Array<{ name: string; quantity: number; size: string | null; addons: string[] }>;
};

export type ManagerCustomerSummary = {
  customer_id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string | null;
  deactivated_at: string | null;
  order_count: number;
  total_spent: number;
  last_order_at: string | null;
};

export type ManagerCustomerListResponse = {
  items: ManagerCustomerSummary[];
  page: number;
  page_size: number;
  total: number;
};

export type ManagerCustomerOrderSummary = {
  id: number;
  order_number: string;
  status: string;
  order_type: string;
  fulfillment_type: string | null;
  table_number: string | null;
  total: number;
  ordered_at: string;
};

export type ManagerCustomerDetail = {
  customer: ManagerCustomerSummary;
  default_address: string | null;
  saved_addresses_count: number;
  marketing_opt_in: boolean;
  operational_allergy_alert: string | null;
  recent_orders: ManagerCustomerOrderSummary[];
};

export type RevenuePeriod = "last_7_days" | "last_30_days" | "last_12_months";

export type RevenueTrendPoint = {
  date: string;
  label: string;
  tooltip_label: string;
  revenue: number;
  order_count: number;
};

export type RevenueTrendResponse = {
  period: RevenuePeriod;
  currency: string;
  timezone: string;
  metric_basis: string;
  total_revenue: number;
  total_orders: number;
  data: RevenueTrendPoint[];
};

export type OrderStatusCode =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export type OrderDistributionItem = {
  status: OrderStatusCode;
  label: string;
  count: number;
};

export type OrderDistributionResponse = {
  period: RevenuePeriod;
  timezone: string;
  cohort_basis: string;
  total_orders: number;
  distribution: OrderDistributionItem[];
};

export type TopSellingDishItem = {
  product_id: number;
  name: string;
  units_sold: number;
  revenue: number;
};

export type TopSellingDishesResponse = {
  period: RevenuePeriod;
  timezone: string;
  metric: string;
  metric_basis: string;
  items: TopSellingDishItem[];
};

export type OrderVolumePoint = {
  date: string;
  label: string;
  tooltip_label: string;
  orders: number;
};

export type OrderVolumeResponse = {
  period: RevenuePeriod;
  timezone: string;
  metric: string;
  total_orders: number;
  data: OrderVolumePoint[];
};

export type KpiSummaryResponse = {
  period: RevenuePeriod;
  currency: string;
  timezone: string;
  total_revenue: number;
  total_orders: number;
  completed_orders: number;
  placed_completed_orders: number;
  completion_rate: number;
  average_order_value: number;
};

export type OperationalAlertsResponse = {
  ready_orders_count: number;
  pending_orders_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
  low_stock_names: string[];
};

export type ManagerOrderStatusFilter = "all" | "active" | OrderStatusCode;

export type ManagerFulfillmentFilter = "all" | "table_service" | "counter_pickup";

export type ManagerOrderStatusCounts = {
  all: number;
  active: number;
  pending: number;
  confirmed: number;
  preparing: number;
  ready: number;
  completed: number;
  cancelled: number;
};

export type ManagerOrderSummary = {
  id: number;
  order_number: string;
  status: OrderStatusCode;
  order_type: string;
  fulfillment_type: string | null;
  fulfillment_destination: string;
  customer_id: number;
  customer_name: string;
  customer_email: string | null;
  payment_method_label: string | null;
  item_count: number;
  total_amount: number;
  ordered_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  allergy_alert: string | null;
};

export type ManagerOrderListResponse = {
  items: ManagerOrderSummary[];
  status_counts: ManagerOrderStatusCounts;
  page: number;
  page_size: number;
  total: number;
};

export type ManagerOrderItemDetail = {
  id: number;
  menu_item_id: number;
  name: string;
  quantity: number;
  size: string | null;
  addons: string[];
  unit_price: number;
  discount_amount: number;
  line_total: number;
  status: string;
  special_instructions: string | null;
};

export type ManagerOrderDetail = {
  id: number;
  order_number: string;
  status: OrderStatusCode;
  order_type: string;
  fulfillment_type: string | null;
  fulfillment_destination: string;
  table_number: string | null;
  customer_id: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  payment_method_code: string | null;
  payment_method_label: string | null;
  delivery_address_snapshot: Record<string, unknown> | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  allergy_alert: string | null;
  notes: string | null;
  cancellation_reason: string | null;
  ordered_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
  can_complete: boolean;
  can_cancel: boolean;
  items: ManagerOrderItemDetail[];
};

export type StaffAccountStatus = "active" | "inactive";

export type StaffAccountDetail = {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
  status: StaffAccountStatus;
  created_at: string;
  updated_at: string;
};

export type StaffCreatePayload = {
  name: string;
  email: string;
  role: StaffRole;
  password: string;
};

export type AuditLogEntry = {
  id: number;
  event_type: string;
  actor_type: string;
  actor_id: number | null;
  actor_email: string | null;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  created_at: string;
  details: Record<string, unknown> | null;
};

export type SecurityOverview = {
  status: string;
  environment: string;
  cookie_secure: boolean;
  active_managers_count: number;
  active_kitchen_staff_count: number;
  staff_session_timeout_minutes: number;
  max_failed_logins_before_lockout: number;
  rate_limit_lockout_seconds: number;
  public_manager_registration: boolean;
  initial_manager_provisioned: boolean;
};



