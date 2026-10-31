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
  items: Array<{ name: string; quantity: number; size: string | null; addons: string[] }>;
};

