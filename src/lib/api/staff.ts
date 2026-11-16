import type {
  AuditLogEntry,
  KdsOrder,
  KpiSummaryResponse,
  ManagerCustomerDetail,
  ManagerCustomerListResponse,
  ManagerFulfillmentFilter,
  ManagerOrderDetail,
  ManagerOrderListResponse,
  ManagerOrderStatusFilter,
  OperationalAlertsResponse,
  OrderDistributionResponse,
  OrderVolumeResponse,
  RevenuePeriod,
  RevenueTrendResponse,
  SecurityOverview,
  StaffAccountDetail,
  StaffAccountStatus,
  StaffCreatePayload,
  StaffLoginResponse,
  StaffRole,
  StaffUser,
  TopSellingDishesResponse,
} from "../../types/staff";
import { notifyAuthStateChanged } from "../rbac";
import { getApiBaseUrl } from "./base-url";

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
  return getApiBaseUrl();
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
  notifyAuthStateChanged();

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
    notifyAuthStateChanged();
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

export function updateManagerOrderStatus(
  orderId: number,
  status: "completed" | "cancelled",
  cancellationReason?: string
): Promise<KdsOrder> {
  return request<KdsOrder>(`/api/v1/manager/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      cancellation_reason: cancellationReason?.trim() || undefined,
    }),
  });
}

export function getManagerCustomers(params?: {
  search?: string;
  status?: "all" | "active" | "deactivated";
  page?: number;
}): Promise<ManagerCustomerListResponse> {
  const sp = new URLSearchParams();
  if (params?.search?.trim()) sp.set("search", params.search.trim());
  if (params?.status) sp.set("status", params.status);
  if (params?.page) sp.set("page", String(params.page));
  const query = sp.toString();
  return request<ManagerCustomerListResponse>(
    `/api/v1/manager/customers${query ? `?${query}` : ""}`
  ).then((res) => ({
    ...res,
    items: (res.items || []).map((c) => ({
      ...c,
      total_spent: Number(c.total_spent),
    })),
  }));
}

export function getManagerCustomerDetail(customerId: number): Promise<ManagerCustomerDetail> {
  return request<ManagerCustomerDetail>(`/api/v1/manager/customers/${customerId}`).then((res) => ({
    ...res,
    customer: {
      ...res.customer,
      total_spent: Number(res.customer.total_spent),
    },
    recent_orders: (res.recent_orders || []).map((o) => ({
      ...o,
      total: Number(o.total),
    })),
  }));
}

export function updateManagerCustomerStatus(
  customerId: number,
  isActive: boolean,
  reason?: string
): Promise<ManagerCustomerDetail> {
  return request<ManagerCustomerDetail>(`/api/v1/manager/customers/${customerId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive, reason: reason?.trim() || undefined }),
  }).then((res) => ({
    ...res,
    customer: {
      ...res.customer,
      total_spent: Number(res.customer.total_spent),
    },
    recent_orders: (res.recent_orders || []).map((o) => ({
      ...o,
      total: Number(o.total),
    })),
  }));
}

function parseStrictNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

export function getManagerRevenueTrend(
  period: RevenuePeriod,
  signal?: AbortSignal
): Promise<RevenueTrendResponse> {
  const params = new URLSearchParams({ period });
  return request<RevenueTrendResponse>(
    `/api/v1/manager/analytics/revenue-trend?${params.toString()}`,
    { signal }
  ).then((res) => ({
    ...res,
    total_revenue: parseStrictNumber(res.total_revenue),
    data: Array.isArray(res.data)
      ? res.data.map((point) => ({
          ...point,
          revenue: parseStrictNumber(point.revenue),
          order_count: parseStrictNumber(point.order_count),
        }))
      : [],
  }));
}

export function getManagerOrderDistribution(
  period: RevenuePeriod,
  signal?: AbortSignal
): Promise<OrderDistributionResponse> {
  const params = new URLSearchParams({ period });
  return request<OrderDistributionResponse>(
    `/api/v1/manager/analytics/order-distribution?${params.toString()}`,
    { signal }
  ).then((res) => ({
    ...res,
    total_orders: parseStrictNumber(res.total_orders),
    distribution: Array.isArray(res.distribution)
      ? res.distribution.map((item) => ({
          ...item,
          count: parseStrictNumber(item.count),
        }))
      : [],
  }));
}

export function getManagerTopDishes(
  period: RevenuePeriod,
  signal?: AbortSignal
): Promise<TopSellingDishesResponse> {
  const params = new URLSearchParams({ period });
  return request<TopSellingDishesResponse>(
    `/api/v1/manager/analytics/top-dishes?${params.toString()}`,
    { signal }
  ).then((res) => ({
    ...res,
    items: Array.isArray(res.items)
      ? res.items.map((item) => ({
          ...item,
          product_id: parseStrictNumber(item.product_id),
          units_sold: parseStrictNumber(item.units_sold),
          revenue: parseStrictNumber(item.revenue),
        }))
      : [],
  }));
}

export function getManagerOrderVolume(
  period: RevenuePeriod,
  signal?: AbortSignal
): Promise<OrderVolumeResponse> {
  const params = new URLSearchParams({ period });
  return request<OrderVolumeResponse>(
    `/api/v1/manager/analytics/order-volume?${params.toString()}`,
    { signal }
  ).then((res) => ({
    ...res,
    total_orders: parseStrictNumber(res.total_orders),
    data: Array.isArray(res.data)
      ? res.data.map((point) => ({
          ...point,
          orders: parseStrictNumber(point.orders),
        }))
      : [],
  }));
}

export function getManagerKpiSummary(
  period: RevenuePeriod,
  signal?: AbortSignal
): Promise<KpiSummaryResponse> {
  const params = new URLSearchParams({ period });
  return request<KpiSummaryResponse>(
    `/api/v1/manager/analytics/kpi-summary?${params.toString()}`,
    { signal }
  ).then((res) => ({
    ...res,
    total_revenue: parseStrictNumber(res.total_revenue),
    total_orders: parseStrictNumber(res.total_orders),
    completed_orders: parseStrictNumber(res.completed_orders),
    placed_completed_orders: parseStrictNumber(res.placed_completed_orders),
    completion_rate: parseStrictNumber(res.completion_rate),
    average_order_value: parseStrictNumber(res.average_order_value),
  }));
}

export function getManagerOperationalAlerts(
  signal?: AbortSignal
): Promise<OperationalAlertsResponse> {
  return request<OperationalAlertsResponse>("/api/v1/manager/analytics/operational-alerts", {
    signal,
  }).then((res) => ({
    ready_orders_count: parseStrictNumber(res.ready_orders_count),
    pending_orders_count: parseStrictNumber(res.pending_orders_count),
    low_stock_count: parseStrictNumber(res.low_stock_count),
    out_of_stock_count: parseStrictNumber(res.out_of_stock_count),
    low_stock_names: Array.isArray(res.low_stock_names)
      ? res.low_stock_names.filter((name): name is string => typeof name === "string")
      : [],
  }));
}

export function getManagerOrdersDirectory(
  params?: {
    search?: string;
    status?: ManagerOrderStatusFilter;
    fulfillment_type?: ManagerFulfillmentFilter;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
  },
  signal?: AbortSignal
): Promise<ManagerOrderListResponse> {
  const sp = new URLSearchParams();
  if (params?.search?.trim()) sp.set("search", params.search.trim());
  if (params?.status) sp.set("status", params.status);
  if (params?.fulfillment_type) sp.set("fulfillment_type", params.fulfillment_type);
  if (params?.date_from) sp.set("date_from", params.date_from);
  if (params?.date_to) sp.set("date_to", params.date_to);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.page_size) sp.set("page_size", String(params.page_size));
  const query = sp.toString();
  return request<ManagerOrderListResponse>(
    `/api/v1/manager/orders/directory${query ? `?${query}` : ""}`,
    { signal }
  ).then((res) => ({
    ...res,
    items: (res.items || []).map((order) => ({
      ...order,
      item_count: parseStrictNumber(order.item_count),
      total_amount: parseStrictNumber(order.total_amount),
    })),
  }));
}

export function getManagerOrderDetail(
  orderId: number,
  signal?: AbortSignal
): Promise<ManagerOrderDetail> {
  return request<ManagerOrderDetail>(`/api/v1/manager/orders/${orderId}`, { signal }).then(
    (res) => ({
      ...res,
      subtotal: parseStrictNumber(res.subtotal),
      discount_amount: parseStrictNumber(res.discount_amount),
      tax_amount: parseStrictNumber(res.tax_amount),
      total_amount: parseStrictNumber(res.total_amount),
      items: (res.items || []).map((item) => ({
        ...item,
        quantity: parseStrictNumber(item.quantity),
        unit_price: parseStrictNumber(item.unit_price),
        discount_amount: parseStrictNumber(item.discount_amount),
        line_total: parseStrictNumber(item.line_total),
      })),
    })
  );
}

export function getManagerStaffList(
  params?: {
    search?: string;
    role?: StaffRole;
    status?: StaffAccountStatus;
  },
  signal?: AbortSignal
): Promise<StaffAccountDetail[]> {
  const sp = new URLSearchParams();
  if (params?.search?.trim()) sp.set("search", params.search.trim());
  if (params?.role) sp.set("role", params.role);
  if (params?.status) sp.set("status", params.status);
  const query = sp.toString();
  return request<StaffAccountDetail[]>(
    `/api/v1/manager/staff${query ? `?${query}` : ""}`,
    { signal }
  );
}

export function createManagerStaffAccount(
  payload: StaffCreatePayload
): Promise<StaffAccountDetail> {
  return request<StaffAccountDetail>("/api/v1/manager/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateManagerStaffStatus(
  staffId: number,
  status: StaffAccountStatus
): Promise<StaffAccountDetail> {
  return request<StaffAccountDetail>(`/api/v1/manager/staff/${staffId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export function updateManagerStaffRole(
  staffId: number,
  role: StaffRole
): Promise<StaffAccountDetail> {
  return request<StaffAccountDetail>(`/api/v1/manager/staff/${staffId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export function getManagerAuditLogs(
  params?: {
    limit?: number;
    offset?: number;
    event_type?: string;
    outcome?: string;
    search?: string;
  },
  signal?: AbortSignal
): Promise<AuditLogEntry[]> {
  const sp = new URLSearchParams();
  if (params?.limit !== undefined) sp.set("limit", String(params.limit));
  if (params?.offset !== undefined) sp.set("offset", String(params.offset));
  if (params?.event_type?.trim()) sp.set("event_type", params.event_type.trim());
  if (params?.outcome?.trim()) sp.set("outcome", params.outcome.trim());
  if (params?.search?.trim()) sp.set("search", params.search.trim());
  const query = sp.toString();
  return request<AuditLogEntry[]>(
    `/api/v1/manager/audit-logs${query ? `?${query}` : ""}`,
    { signal }
  );
}

export function getManagerSecurityOverview(
  signal?: AbortSignal
): Promise<SecurityOverview> {
  return request<SecurityOverview>("/api/v1/manager/security/overview", { signal }).then(
    (res) => ({
      ...res,
      active_managers_count: parseStrictNumber(res.active_managers_count),
      active_kitchen_staff_count: parseStrictNumber(res.active_kitchen_staff_count),
      staff_session_timeout_minutes: parseStrictNumber(res.staff_session_timeout_minutes),
      max_failed_logins_before_lockout: parseStrictNumber(res.max_failed_logins_before_lockout),
      rate_limit_lockout_seconds: parseStrictNumber(res.rate_limit_lockout_seconds),
    })
  );
}
