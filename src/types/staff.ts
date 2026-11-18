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

export type ManagerTableActiveOrderSummary = {
  id: number;
  order_number: string;
  status: string;
  customer_name: string;
  total_amount: number;
  ordered_at: string;
};

export type ManagerTableSummary = {
  id: number;
  table_number: string;
  seats: number;
  is_active: boolean;
  is_occupied: boolean;
  active_order: ManagerTableActiveOrderSummary | null;
  total_orders_count: number;
  created_at: string;
  updated_at: string;
};

export type ManagerTablesOverview = {
  total_tables: number;
  active_tables: number;
  available_tables: number;
  occupied_tables: number;
  total_active_seats: number;
  items: ManagerTableSummary[];
};

export type ManagerPaymentMethodSummary = {
  id: number;
  code: string;
  label: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  orders_count: number;
  collected_revenue: number;
  created_at: string;
  updated_at: string;
};

export type PaymentMethodBreakdownItem = {
  method_id: number | null;
  method_code: string;
  method_label: string;
  orders_count: number;
  completed_count: number;
  collected_revenue: number;
  pending_revenue: number;
};

export type PaymentSettlementState = "settled" | "pending" | "voided";

export type PaymentTransactionItem = {
  order_id: number;
  order_number: string;
  customer_name: string;
  customer_email: string | null;
  order_type: string;
  fulfillment_destination: string;
  payment_method_code: string | null;
  payment_method_label: string;
  order_status: string;
  settlement_state: PaymentSettlementState;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  ordered_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type ManagerPaymentsLedgerResponse = {
  currency: string;
  timezone: string;
  collected_revenue: number;
  completed_count: number;
  pending_revenue: number;
  pending_count: number;
  voided_revenue: number;
  voided_count: number;
  method_breakdown: PaymentMethodBreakdownItem[];
  items: PaymentTransactionItem[];
  page: number;
  page_size: number;
  total: number;
};

export type ReportDatePreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "custom";

export type ReportGranularity = "daily" | "monthly";
export type ReportExportType = "sales" | "orders" | "menu" | "payments" | "inventory";
export type MenuReportSortBy = "units_sold" | "sales_value" | "order_count" | "name";
export type SortDirection = "asc" | "desc";

export type ReportWindowMeta = {
  preset: ReportDatePreset;
  date_from: string;
  date_to: string;
  previous_date_from: string;
  previous_date_to: string;
  timezone: string;
  currency: string;
};

export type ComparisonMetric = {
  current: number;
  previous: number;
  delta: number;
  change_pct: number | null;
};

export type ComparisonCountMetric = {
  current: number;
  previous: number;
  delta: number;
  change_pct: number | null;
};

export type OverviewTrendPoint = {
  date: string;
  label: string;
  tooltip_label: string;
  recognized_revenue: number;
  placed_orders: number;
  completed_orders: number;
};

export type OverviewTopDishItem = {
  product_id: number;
  name: string;
  category_name: string;
  units_sold: number;
  sales_value: number;
};

export type OverviewPaymentMethodItem = {
  method_code: string;
  method_label: string;
  settled_orders: number;
  settled_revenue: number;
};

export type ManagerReportOverviewResponse = {
  window: ReportWindowMeta;
  recognized_revenue: ComparisonMetric;
  total_placed_orders: ComparisonCountMetric;
  completed_orders: ComparisonCountMetric;
  average_order_value: ComparisonMetric;
  cancelled_orders: number;
  pending_orders: number;
  completion_rate: number;
  trend: OverviewTrendPoint[];
  top_dishes: OverviewTopDishItem[];
  payment_mix: OverviewPaymentMethodItem[];
};

export type SalesIntervalRow = {
  bucket: string;
  label: string;
  tooltip_label: string;
  qualifying_orders: number;
  gross_sales: number;
  discount_total: number;
  tax_total: number;
  recognized_revenue: number;
  average_order_value: number;
};

export type SalesCategoryShareItem = {
  category_id: number | null;
  category_name: string;
  units_sold: number;
  sales_value: number;
  share_pct: number;
};

export type ManagerSalesReportResponse = {
  window: ReportWindowMeta;
  granularity: ReportGranularity;
  metric_basis: string;
  gross_sales: number;
  discount_total: number;
  tax_total: number;
  recognized_revenue: number;
  voided_amount: number;
  qualifying_orders: number;
  average_order_value: number;
  series: SalesIntervalRow[];
  category_breakdown: SalesCategoryShareItem[];
  ledger_items: SalesIntervalRow[];
  page: number;
  page_size: number;
  total: number;
};

export type OrdersStatusBreakdownItem = {
  status: string;
  label: string;
  count: number;
  share_pct: number;
};

export type OrdersTypeBreakdownItem = {
  order_type: string;
  label: string;
  count: number;
  share_pct: number;
};

export type OrdersTimeBucketItem = {
  key: string;
  label: string;
  count: number;
};

export type ManagerOrderReportRow = {
  id: number;
  order_number: string;
  status: string;
  order_type: string;
  fulfillment_destination: string;
  total_amount: number;
  ordered_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type ManagerOrdersReportResponse = {
  window: ReportWindowMeta;
  cohort_basis: string;
  total_placed: number;
  completed_count: number;
  cancelled_count: number;
  active_pending_count: number;
  completion_rate: number;
  cancellation_rate: number;
  status_breakdown: OrdersStatusBreakdownItem[];
  type_breakdown: OrdersTypeBreakdownItem[];
  weekday_volume: OrdersTimeBucketItem[];
  hourly_volume: OrdersTimeBucketItem[];
  items: ManagerOrderReportRow[];
  page: number;
  page_size: number;
  total: number;
};

export type MenuPerformanceItem = {
  product_id: number;
  dish_name: string;
  category_id: number | null;
  category_name: string;
  is_available: boolean;
  is_deleted: boolean;
  units_sold: number;
  order_count: number;
  sales_value: number;
  share_pct: number;
};

export type MenuCategoryOption = {
  id: number;
  name: string;
};

export type MenuCategorySummaryItem = {
  category_id: number | null;
  category_name: string;
  units_sold: number;
  order_count: number;
  sales_value: number;
  share_pct: number;
};

export type ManagerMenuReportResponse = {
  window: ReportWindowMeta;
  metric_basis: string;
  total_units_sold: number;
  total_item_sales_value: number;
  distinct_products_sold: number;
  categories: MenuCategoryOption[];
  category_summary: MenuCategorySummaryItem[];
  top_selling_dishes: MenuPerformanceItem[];
  lowest_selling_active_dishes: MenuPerformanceItem[];
  items: MenuPerformanceItem[];
  page: number;
  page_size: number;
  total: number;
};

export type PaymentsMethodSummaryRow = {
  method_id: number | null;
  method_code: string;
  method_label: string;
  settled_count: number;
  pending_count: number;
  voided_count: number;
  settled_revenue: number;
  pending_revenue: number;
  voided_revenue: number;
  share_pct: number;
};

export type PaymentsTransactionReportRow = {
  order_id: number;
  order_number: string;
  method_code: string | null;
  method_label: string;
  order_type: string;
  order_status: string;
  settlement_state: PaymentSettlementState;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  ordered_at: string;
  completed_at: string | null;
};

export type ManagerPaymentsReportResponse = {
  window: ReportWindowMeta;
  reconciliation_basis: string;
  settled_revenue: number;
  settled_count: number;
  pending_revenue: number;
  pending_count: number;
  voided_revenue: number;
  voided_count: number;
  collection_rate_pct: number;
  method_breakdown: PaymentsMethodSummaryRow[];
  items: PaymentsTransactionReportRow[];
  page: number;
  page_size: number;
  total: number;
};

export type InventoryTopConsumedItem = {
  inventory_item_id: number;
  name: string;
  unit: string;
  consumed_qty: number;
  current_stock: number;
};

export type InventoryItemMovementRow = {
  inventory_item_id: number;
  name: string;
  sku: string | null;
  unit: string;
  current_stock: number;
  reorder_level: number;
  stock_status: string;
  consumed_qty: number;
  restocked_qty: number;
  waste_qty: number;
  returned_qty: number;
  adjusted_qty: number;
};

export type InventoryTransactionLedgerRow = {
  id: number;
  inventory_item_id: number;
  item_name: string;
  unit: string;
  transaction_type: string;
  quantity_change: number;
  reference_type: string | null;
  reference_id: number | null;
  notes: string | null;
  created_at: string;
};

export type ManagerInventoryReportResponse = {
  window: ReportWindowMeta;
  cost_reporting_supported: boolean;
  profitability_note: string;
  active_items_count: number;
  normal_stock_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_movements_count: number;
  top_consumed_items: InventoryTopConsumedItem[];
  item_summaries: InventoryItemMovementRow[];
  ledger_items: InventoryTransactionLedgerRow[];
  page: number;
  page_size: number;
  total: number;
};

export type BusinessHourEntry = {
  day_of_week: number;
  day_name: string;
  short_day: string;
  is_open: boolean;
  open_time: string;
  close_time: string;
};

export type RestaurantInfoConfig = {
  name: string;
  tagline: string;
  locality: string;
  full_address: string;
  phone: string;
  email: string;
  timezone: string;
  kitchen_cutoff_minutes: number;
  kitchen_notice: string;
  holiday_notice: string;
};

export type OrderingPolicyConfig = {
  online_ordering_enabled: boolean;
  online_ordering_pause_reason: string | null;
  dine_in_enabled: boolean;
  takeout_enabled: boolean;
  enforce_operating_hours: boolean;
  kitchen_cutoff_minutes: number;
  minimum_order_amount: number;
};

export type NotificationPolicyConfig = {
  send_order_confirmation_emails: boolean;
  send_contact_inquiry_emails: boolean;
  smtp_configured: boolean;
};

export type SettingsSystemInfo = {
  environment: string;
  timezone: string;
  staff_session_timeout_minutes: number;
  version: number;
  updated_at: string;
};

export type PublicRestaurantSettingsResponse = {
  restaurant: RestaurantInfoConfig;
  hours: BusinessHourEntry[];
  ordering: OrderingPolicyConfig;
  is_currently_open: boolean;
  operating_status_text: string;
};

export type ManagerSettingsResponse = {
  restaurant: RestaurantInfoConfig;
  hours: BusinessHourEntry[];
  ordering: OrderingPolicyConfig;
  notifications: NotificationPolicyConfig;
  payment_methods: ManagerPaymentMethodSummary[];
  system_info: SettingsSystemInfo;
};


