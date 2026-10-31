import type { PaymentMethod } from "../../types/payment-method";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

export class PaymentMethodApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const response = await fetch(`${apiUrl}/api/v1/payment-methods`);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null && "detail" in data ? data.detail : null;
    throw new PaymentMethodApiError(response.status, typeof detail === "string" ? detail : "Unable to load payment methods.");
  }
  return data as PaymentMethod[];
}
