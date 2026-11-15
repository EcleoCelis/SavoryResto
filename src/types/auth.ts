export type ThemePreference = "light" | "dark" | "system";

export interface CustomerUser {
  customer_id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  avatar_url?: string | null;
  is_active?: boolean;
  created_at?: string | null;
  preferred_payment_code?: string | null;
  default_order_type?: "dine_in" | "takeout" | null;
  theme_preference?: ThemePreference;
}

export interface LoginPayload {
  email: string;
  password: string;
  remember_me?: boolean;
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  phone: string;
  password: string;
}

export interface LoginResponse {
  message: string;
  customer_id: number;
  email: string;
  full_name: string;
  access_token?: string;
  token_type?: string;
}

export interface RegisterResponse {
  message: string;
  customer_id: number;
  email: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordPayload {
  token: string;
  new_password: string;
  confirm_password: string;
}

export interface ResetPasswordResponse {
  message: string;
}
