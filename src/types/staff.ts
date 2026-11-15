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

