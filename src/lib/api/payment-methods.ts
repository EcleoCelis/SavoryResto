import type { PaymentMethod } from "../../types/payment-method";
import { getApiBaseUrl } from "./base-url";

export class PaymentMethodApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/payment-methods`);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null && "detail" in data ? data.detail : null;
    throw new PaymentMethodApiError(response.status, typeof detail === "string" ? detail : "Unable to load payment methods.");
  }
  return data as PaymentMethod[];
}
