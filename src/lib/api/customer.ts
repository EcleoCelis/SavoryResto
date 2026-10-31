import type { CustomerUser } from "../../types/auth";
import type {
  AddressCreateInput,
  AddressUpdateInput,
  CustomerAddress,
  CustomerProfileUpdateInput,
} from "../../types/customer";
import { AuthApiError } from "./auth";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    credentials: "include",
    ...init,
  });

  const contentType = response.headers.get("content-type") || "";
  const data: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    let message = "An error occurred with your account request.";
    if (typeof data === "object" && data !== null && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ");
      }
    }
    throw new AuthApiError(response.status, message);
  }

  return data as T;
}

export function updateCustomerProfile(data: CustomerProfileUpdateInput): Promise<CustomerUser> {
  return request<CustomerUser>("/api/v1/customers/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: data.full_name.trim(),
      phone: data.phone?.trim() ? data.phone.trim() : null,
    }),
  });
}

export function getCustomerAddresses(): Promise<CustomerAddress[]> {
  return request<CustomerAddress[]>("/api/v1/customers/me/addresses");
}

export function createCustomerAddress(data: AddressCreateInput): Promise<CustomerAddress> {
  return request<CustomerAddress>("/api/v1/customers/me/addresses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updateCustomerAddress(
  addressId: number,
  data: AddressUpdateInput,
): Promise<CustomerAddress> {
  return request<CustomerAddress>(`/api/v1/customers/me/addresses/${addressId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function setDefaultAddress(addressId: number): Promise<CustomerAddress> {
  return request<CustomerAddress>(`/api/v1/customers/me/addresses/${addressId}/default`, {
    method: "PATCH",
  });
}

export function deleteCustomerAddress(addressId: number): Promise<void> {
  return request<{ message: string }>(`/api/v1/customers/me/addresses/${addressId}`, {
    method: "DELETE",
  }).then(() => undefined);
}
