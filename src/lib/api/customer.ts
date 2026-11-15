import type {
  AddressCreateInput,
  AddressUpdateInput,
  CustomerAddress,
  CustomerDeactivateInput,
  CustomerEmailChangeInput,
  CustomerPasswordChangeInput,
  CustomerPreferencesUpdateInput,
  CustomerProfile,
  CustomerProfileUpdateInput,
  FavoriteProduct,
} from "../../types/customer";
import { AuthApiError } from "./auth";
import { getApiBaseUrl } from "./base-url";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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

export function getCustomerProfile(): Promise<CustomerProfile> {
  return request<CustomerProfile>("/api/v1/customers/me");
}

export function updateCustomerProfile(data: CustomerProfileUpdateInput): Promise<CustomerProfile> {
  return request<CustomerProfile>("/api/v1/customers/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: data.full_name?.trim() || undefined,
      first_name: data.first_name?.trim() || undefined,
      last_name: data.last_name?.trim() || undefined,
      phone: data.phone?.trim() ? data.phone.trim() : null,
    }),
  });
}

export function changeCustomerEmail(data: CustomerEmailChangeInput): Promise<CustomerProfile> {
  return request<CustomerProfile>("/api/v1/customers/me/email", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function uploadCustomerAvatar(file: File): Promise<CustomerProfile> {
  const formData = new FormData();
  formData.append("file", file);
  return request<CustomerProfile>("/api/v1/customers/me/avatar", {
    method: "POST",
    body: formData,
  });
}

export function removeCustomerAvatar(): Promise<CustomerProfile> {
  return request<CustomerProfile>("/api/v1/customers/me/avatar", {
    method: "DELETE",
  });
}

export function updateCustomerPreferences(
  data: CustomerPreferencesUpdateInput,
): Promise<CustomerProfile> {
  return request<CustomerProfile>("/api/v1/customers/me/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function changeCustomerPassword(
  data: CustomerPasswordChangeInput,
): Promise<{ message: string }> {
  return request<{ message: string }>("/api/v1/customers/me/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deactivateCustomerAccount(
  data: CustomerDeactivateInput,
): Promise<{ message: string }> {
  return request<{ message: string }>("/api/v1/customers/me/deactivate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function getCustomerFavorites(): Promise<FavoriteProduct[]> {
  return request<FavoriteProduct[]>("/api/v1/customers/me/favorites").then((items) =>
    items.map((item) => ({
      ...item,
      product: {
        ...item.product,
        price: Number(item.product.price),
        sizes: (item.product.sizes || []).map((s) => ({
          ...s,
          price_adjustment: Number(s.price_adjustment),
        })),
        addons: (item.product.addons || []).map((a) => ({
          ...a,
          price_adjustment: Number(a.price_adjustment),
        })),
      },
    })),
  );
}

export function addCustomerFavorite(productId: number): Promise<FavoriteProduct> {
  return request<FavoriteProduct>(`/api/v1/customers/me/favorites/${productId}`, {
    method: "POST",
  }).then((item) => ({
    ...item,
    product: {
      ...item.product,
      price: Number(item.product.price),
      sizes: (item.product.sizes || []).map((s) => ({
        ...s,
        price_adjustment: Number(s.price_adjustment),
      })),
      addons: (item.product.addons || []).map((a) => ({
        ...a,
        price_adjustment: Number(a.price_adjustment),
      })),
    },
  }));
}

export function removeCustomerFavorite(productId: number): Promise<void> {
  return request<{ message: string }>(`/api/v1/customers/me/favorites/${productId}`, {
    method: "DELETE",
  }).then(() => undefined);
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
