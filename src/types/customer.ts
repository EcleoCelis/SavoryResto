export interface CustomerAddress {
  id: number;
  customer_id: number;
  label: string;
  recipient_name: string;
  phone: string;
  street_address: string;
  city: string;
  state_province: string | null;
  postal_code: string | null;
  delivery_instructions: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerProfileUpdateInput {
  full_name: string;
  phone?: string | null;
}

export interface AddressCreateInput {
  label: string;
  recipient_name: string;
  phone: string;
  street_address: string;
  city: string;
  state_province?: string | null;
  postal_code?: string | null;
  delivery_instructions?: string | null;
  is_default?: boolean;
}

export type AddressUpdateInput = Partial<AddressCreateInput>;
