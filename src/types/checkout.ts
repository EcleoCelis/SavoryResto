export type CheckoutCustomer = {
  customer_id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export type CheckoutQuoteRequest = {
  items: Array<{
    cart_line_id: string;
    product_id: number;
    quantity: number;
    size: string;
    addons: string[];
  }>;
};

export type CheckoutQuoteLine = {
  cart_line_id: string;
  product_id: number;
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

export type CheckoutQuote = {
  items: CheckoutQuoteLine[];
  subtotal: number;
  total: number;
};
