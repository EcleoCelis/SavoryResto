import type { KdsOrder, StaffLoginResponse, StaffRole, StaffUser } from "../../types/staff";

export class StaffApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const TOKEN_STORAGE_KEY = "savorybites_staff_token";
let inMemoryStaffToken: string | null = null;

export function getStaffToken(): string | null {
  if (inMemoryStaffToken) return inMemoryStaffToken;
  if (typeof window !== "undefined") {
    try {
      return sessionStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  return null;
}

export function setStaffToken(token: string | null): void {
  inMemoryStaffToken = token;
  if (typeof window !== "undefined") {
    try {
      if (token) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in private browsing modes
    }
  }
}

export function getStaffApiUrl(): string {
  if (typeof window !== "undefined") {
    const configured = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
    try {
      const parsed = new URL(configured);
      // In local development, align the API hostname with window.location.hostname
      // to avoid modern browser cross-site SameSite=Lax cookie restrictions between localhost and 127.0.0.1
      if (
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      ) {
        parsed.hostname = window.location.hostname;
        return parsed.origin;
      }
      return configured;
    } catch {
      return configured;
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getStaffApiUrl();
  const token = getStaffToken();

  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? (data as { detail: unknown }).detail
        : null;
    throw new StaffApiError(
      response.status,
      typeof detail === "string" ? detail : "Staff request failed."
    );
  }
  return data as T;
}

export async function staffLogin(
  email: string,
  password: string,
  rememberMe: boolean,
  requestedRole?: StaffRole
): Promise<StaffLoginResponse> {
  const data = await request<StaffLoginResponse>("/api/v1/staff/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      remember_me: rememberMe,
      requested_role: requestedRole || undefined,
    }),
  });

  if (data.access_token) {
    setStaffToken(data.access_token);
  }

  return data;
}

export function getCurrentStaff(): Promise<StaffUser> {
  return request<StaffUser>("/api/v1/staff/auth/me");
}

export async function staffLogout(): Promise<{ message: string }> {
  try {
    return await request<{ message: string }>("/api/v1/staff/auth/logout", {
      method: "POST",
    });
  } finally {
    setStaffToken(null);
  }
}

export function getKdsOrders(status?: KdsOrder["status"]): Promise<KdsOrder[]> {
  return request<KdsOrder[]>(
    `/api/v1/kds/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`
  );
}

export function getManagerOrders(): Promise<KdsOrder[]> {
  return request<KdsOrder[]>("/api/v1/manager/orders");
}

export function updateKdsStatus(
  orderId: number,
  status: KdsOrder["status"]
): Promise<KdsOrder> {
  return request<KdsOrder>(`/api/v1/kds/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
