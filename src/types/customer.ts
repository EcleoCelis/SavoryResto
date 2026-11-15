import type { ThemePreference } from "./auth";
import type { Product } from "./product";

export interface CustomerProfile {
  customer_id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string | null;
  preferred_payment_code: string | null;
  default_order_type: "dine_in" | "takeout" | null;
  dietary_preferences: string[];
  allergy_flags: string[];
  disliked_ingredients: string | null;
  preferred_category_ids: number[];
  allergy_consent_given: boolean;
  allergy_consent_at: string | null;
  share_allergy_with_kitchen: boolean;
  email_order_updates: boolean;
  email_promotions: boolean;
  marketing_consent_at: string | null;
  theme_preference: ThemePreference;
  preferences_updated_at: string | null;
}

export interface CustomerAddress {
  id: number;
  customer_id: number;
  label: string;
  recipient_name: string;
  phone: string;
  street_address: string;
  barangay: string | null;
  city: string;
  state_province: string | null;
  postal_code: string | null;
  delivery_instructions: string | null;
  is_default: boolean;
  is_within_service_area: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerProfileUpdateInput {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
}

export interface CustomerEmailChangeInput {
  new_email: string;
  current_password: string;
}

export interface CustomerPasswordChangeInput {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export interface CustomerDeactivateInput {
  current_password: string;
  confirm_deactivation: boolean;
  reason?: string | null;
}

export interface CustomerPreferencesUpdateInput {
  preferred_payment_code?: string | null;
  default_order_type?: "dine_in" | "takeout" | null;
  dietary_preferences: string[];
  allergy_flags: string[];
  disliked_ingredients?: string | null;
  preferred_category_ids: number[];
  allergy_consent_given: boolean;
  share_allergy_with_kitchen: boolean;
  email_order_updates: boolean;
  email_promotions: boolean;
  theme_preference: ThemePreference;
}

export interface FavoriteProduct {
  product_id: number;
  favorited_at: string;
  product: Product;
}

export interface AddressCreateInput {
  label: string;
  recipient_name: string;
  phone: string;
  street_address: string;
  barangay?: string | null;
  city: string;
  state_province?: string | null;
  postal_code?: string | null;
  delivery_instructions?: string | null;
  is_default?: boolean;
}

export type AddressUpdateInput = Partial<AddressCreateInput>;
