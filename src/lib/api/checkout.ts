import type { CheckoutCustomer, CheckoutQuoteLine, CheckoutQuoteRequest } from "../../types/checkout";
import { getApiBaseUrl } from "./base-url";

export class CheckoutApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, { credentials: "include", ...init });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null && "detail" in data ? data.detail : null;
    throw new CheckoutApiError(response.status, typeof detail === "string" ? detail : "Unable to prepare checkout.");
  }
  return data as T;
}

export function getCheckoutCustomer() {
  return request<CheckoutCustomer>("/api/v1/auth/me");
}

export function quoteCheckout(payload: CheckoutQuoteRequest) {
  return request<{ items: Array<Omit<CheckoutQuoteLine, "unit_price" | "subtotal"> & { unit_price: number | string; subtotal: number | string }>; subtotal: number | string; total: number | string }>("/api/v1/checkout/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((quote) => ({
    ...quote,
    items: quote.items.map((item) => ({ ...item, unit_price: Number(item.unit_price), subtotal: Number(item.subtotal) })),
    subtotal: Number(quote.subtotal),
    total: Number(quote.total),
  }));
}
