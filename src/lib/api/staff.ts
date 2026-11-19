import type {
  AuditLogEntry,
  BusinessHourEntry,
  KdsOrder,
  KpiSummaryResponse,
  ManagerCustomerDetail,
  ManagerCustomerListResponse,
  ManagerFulfillmentFilter,
  ManagerInventoryReportResponse,
  ManagerMenuReportResponse,
  ManagerOrderDetail,
  ManagerOrderListResponse,
  ManagerOrderStatusFilter,
  ManagerOrdersReportResponse,
  ManagerPaymentMethodSummary,
  ManagerPaymentsLedgerResponse,
  ManagerPaymentsReportResponse,
  ManagerReportOverviewResponse,
  ManagerSalesReportResponse,
  ManagerSettingsResponse,
  ManagerTablesOverview,
  ManagerTableSummary,
  MenuReportSortBy,
  OperationalAlertsResponse,
  OrderDistributionResponse,
  OrderVolumeResponse,
  PaymentSettlementState,
  PublicRestaurantSettingsResponse,
  ReportDatePreset,
  ReportExportType,
  ReportGranularity,
  RevenuePeriod,
  RevenueTrendResponse,
  SecurityOverview,
  SortDirection,
  StaffAccountDetail,
  StaffAccountStatus,
  StaffCreatePayload,
  StaffLoginResponse,
  StaffRole,
  StaffUser,
  TopSellingDishesResponse,
} from "../../types/staff";
import { notifyAuthStateChanged } from "../rbac";
import {
  fetchWithSwrCache,
  getSwrSnapshot,
  invalidateSwrPrefix,
} from "../swrCache";
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
  cancellationReason?: string,
  expectedUpdatedAt?: string | null
): Promise<KdsOrder> {
  return request<KdsOrder>(`/api/v1/manager/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      cancellation_reason: cancellationReason?.trim() || undefined,
      expected_updated_at: expectedUpdatedAt || undefined,
    }),
  });
}

export function getManagerCustomers(
  params?: {
    search?: string;
    status?: "all" | "active" | "deactivated";
    page?: number;
  },
  signal?: AbortSignal
): Promise<ManagerCustomerListResponse> {
  const sp = new URLSearchParams();
  if (params?.search?.trim()) sp.set("search", params.search.trim());
  if (params?.status) sp.set("status", params.status);
  if (params?.page) sp.set("page", String(params.page));
  const query = sp.toString();
  return request<ManagerCustomerListResponse>(
    `/api/v1/manager/customers${query ? `?${query}` : ""}`,
    { signal }
  ).then((res) => ({
    ...res,
    items: (res.items || []).map((c) => ({
      ...c,
      total_spent: Number(c.total_spent),
    })),
  }));
}

export function getManagerCustomerDetail(
  customerId: number,
  signal?: AbortSignal
): Promise<ManagerCustomerDetail> {
  return request<ManagerCustomerDetail>(`/api/v1/manager/customers/${customerId}`, {
    signal,
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
  status: StaffAccountStatus,
  expectedUpdatedAt?: string
): Promise<StaffAccountDetail> {
  return request<StaffAccountDetail>(`/api/v1/manager/staff/${staffId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      expected_updated_at: expectedUpdatedAt || undefined,
    }),
  });
}

export function updateManagerStaffRole(
  staffId: number,
  role: StaffRole,
  expectedUpdatedAt?: string
): Promise<StaffAccountDetail> {
  return request<StaffAccountDetail>(`/api/v1/manager/staff/${staffId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role,
      expected_updated_at: expectedUpdatedAt || undefined,
    }),
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

export function getManagerTablesOverview(
  signal?: AbortSignal
): Promise<ManagerTablesOverview> {
  return request<ManagerTablesOverview>("/api/v1/manager/tables", { signal }).then((res) => ({
    ...res,
    items: (res.items || []).map((tbl) => ({
      ...tbl,
      active_order: tbl.active_order
        ? {
            ...tbl.active_order,
            total_amount: parseStrictNumber(tbl.active_order.total_amount),
          }
        : null,
    })),
  }));
}

export function createManagerTable(payload: {
  table_number: string;
  seats: number;
  is_active: boolean;
}): Promise<ManagerTableSummary> {
  return request<ManagerTableSummary>("/api/v1/manager/tables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateManagerTable(
  tableId: number,
  payload: {
    table_number?: string;
    seats?: number;
    is_active?: boolean;
    expected_updated_at?: string;
  }
): Promise<ManagerTableSummary> {
  return request<ManagerTableSummary>(`/api/v1/manager/tables/${tableId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((tbl) => ({
    ...tbl,
    active_order: tbl.active_order
      ? {
          ...tbl.active_order,
          total_amount: parseStrictNumber(tbl.active_order.total_amount),
        }
      : null,
  }));
}

export function getManagerPaymentsLedger(
  params?: {
    search?: string;
    settlement?: "all" | PaymentSettlementState;
    method_code?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
  },
  signal?: AbortSignal
): Promise<ManagerPaymentsLedgerResponse> {
  const sp = new URLSearchParams();
  if (params?.search?.trim()) sp.set("search", params.search.trim());
  if (params?.settlement) sp.set("settlement", params.settlement);
  if (params?.method_code) sp.set("method_code", params.method_code);
  if (params?.date_from) sp.set("date_from", params.date_from);
  if (params?.date_to) sp.set("date_to", params.date_to);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.page_size) sp.set("page_size", String(params.page_size));
  const query = sp.toString();
  return request<ManagerPaymentsLedgerResponse>(
    `/api/v1/manager/payments/ledger${query ? `?${query}` : ""}`,
    { signal }
  ).then((res) => ({
    ...res,
    collected_revenue: parseStrictNumber(res.collected_revenue),
    pending_revenue: parseStrictNumber(res.pending_revenue),
    voided_revenue: parseStrictNumber(res.voided_revenue),
    method_breakdown: (res.method_breakdown || []).map((item) => ({
      ...item,
      collected_revenue: parseStrictNumber(item.collected_revenue),
      pending_revenue: parseStrictNumber(item.pending_revenue),
    })),
    items: (res.items || []).map((tx) => ({
      ...tx,
      subtotal: parseStrictNumber(tx.subtotal),
      discount_amount: parseStrictNumber(tx.discount_amount),
      tax_amount: parseStrictNumber(tx.tax_amount),
      total_amount: parseStrictNumber(tx.total_amount),
    })),
  }));
}

export function getManagerPaymentMethods(
  signal?: AbortSignal
): Promise<ManagerPaymentMethodSummary[]> {
  return request<ManagerPaymentMethodSummary[]>("/api/v1/manager/payments/methods", {
    signal,
  }).then((list) =>
    (list || []).map((method) => ({
      ...method,
      collected_revenue: parseStrictNumber(method.collected_revenue),
    }))
  );
}

export function createManagerPaymentMethod(payload: {
  code: string;
  label: string;
  description?: string | null;
  is_active: boolean;
  display_order: number;
}): Promise<ManagerPaymentMethodSummary> {
  return request<ManagerPaymentMethodSummary>("/api/v1/manager/payments/methods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((method) => ({
    ...method,
    collected_revenue: parseStrictNumber(method.collected_revenue),
  }));
}

export function updateManagerPaymentMethod(
  methodId: number,
  payload: {
    label?: string;
    description?: string | null;
    is_active?: boolean;
    display_order?: number;
    expected_updated_at?: string;
  }
): Promise<ManagerPaymentMethodSummary> {
  return request<ManagerPaymentMethodSummary>(`/api/v1/manager/payments/methods/${methodId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((method) => ({
    ...method,
    collected_revenue: parseStrictNumber(method.collected_revenue),
  }));
}

type ReportBaseQuery = {
  preset?: ReportDatePreset;
  date_from?: string;
  date_to?: string;
};

function buildReportSearchParams(
  base: ReportBaseQuery & Record<string, string | number | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(base)) {
    if (val !== undefined && String(val).trim().length > 0) {
      sp.set(key, String(val));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = parseStrictNumber(value);
  return Number.isNaN(num) ? null : num;
}

export function getManagerReportOverview(
  params?: ReportBaseQuery,
  signal?: AbortSignal
): Promise<ManagerReportOverviewResponse> {
  const qs = buildReportSearchParams({ ...params });
  return request<ManagerReportOverviewResponse>(`/api/v1/manager/reports/overview${qs}`, {
    signal,
  }).then((res) => ({
    ...res,
    recognized_revenue: {
      current: parseStrictNumber(res.recognized_revenue.current),
      previous: parseStrictNumber(res.recognized_revenue.previous),
      delta: parseStrictNumber(res.recognized_revenue.delta),
      change_pct: parseOptionalNumber(res.recognized_revenue.change_pct),
    },
    total_placed_orders: {
      ...res.total_placed_orders,
      change_pct: parseOptionalNumber(res.total_placed_orders.change_pct),
    },
    completed_orders: {
      ...res.completed_orders,
      change_pct: parseOptionalNumber(res.completed_orders.change_pct),
    },
    average_order_value: {
      current: parseStrictNumber(res.average_order_value.current),
      previous: parseStrictNumber(res.average_order_value.previous),
      delta: parseStrictNumber(res.average_order_value.delta),
      change_pct: parseOptionalNumber(res.average_order_value.change_pct),
    },
    completion_rate: parseStrictNumber(res.completion_rate),
    trend: (res.trend || []).map((p) => ({
      ...p,
      recognized_revenue: parseStrictNumber(p.recognized_revenue),
    })),
    top_dishes: (res.top_dishes || []).map((d) => ({
      ...d,
      sales_value: parseStrictNumber(d.sales_value),
    })),
    payment_mix: (res.payment_mix || []).map((m) => ({
      ...m,
      settled_revenue: parseStrictNumber(m.settled_revenue),
    })),
  }));
}

export function getManagerSalesReport(
  params?: ReportBaseQuery & {
    granularity?: ReportGranularity;
    page?: number;
    page_size?: number;
  },
  signal?: AbortSignal
): Promise<ManagerSalesReportResponse> {
  const qs = buildReportSearchParams({ ...params });
  return request<ManagerSalesReportResponse>(`/api/v1/manager/reports/sales${qs}`, {
    signal,
  }).then((res) => ({
    ...res,
    gross_sales: parseStrictNumber(res.gross_sales),
    discount_total: parseStrictNumber(res.discount_total),
    tax_total: parseStrictNumber(res.tax_total),
    recognized_revenue: parseStrictNumber(res.recognized_revenue),
    voided_amount: parseStrictNumber(res.voided_amount),
    average_order_value: parseStrictNumber(res.average_order_value),
    series: (res.series || []).map((row) => ({
      ...row,
      gross_sales: parseStrictNumber(row.gross_sales),
      discount_total: parseStrictNumber(row.discount_total),
      tax_total: parseStrictNumber(row.tax_total),
      recognized_revenue: parseStrictNumber(row.recognized_revenue),
      average_order_value: parseStrictNumber(row.average_order_value),
    })),
    category_breakdown: (res.category_breakdown || []).map((cat) => ({
      ...cat,
      sales_value: parseStrictNumber(cat.sales_value),
      share_pct: parseStrictNumber(cat.share_pct),
    })),
    ledger_items: (res.ledger_items || []).map((row) => ({
      ...row,
      gross_sales: parseStrictNumber(row.gross_sales),
      discount_total: parseStrictNumber(row.discount_total),
      tax_total: parseStrictNumber(row.tax_total),
      recognized_revenue: parseStrictNumber(row.recognized_revenue),
      average_order_value: parseStrictNumber(row.average_order_value),
    })),
  }));
}

export function getManagerOrdersReport(
  params?: ReportBaseQuery & {
    status?: string;
    order_type?: string;
    page?: number;
    page_size?: number;
  },
  signal?: AbortSignal
): Promise<ManagerOrdersReportResponse> {
  const qs = buildReportSearchParams({ ...params });
  return request<ManagerOrdersReportResponse>(`/api/v1/manager/reports/orders${qs}`, {
    signal,
  }).then((res) => ({
    ...res,
    completion_rate: parseStrictNumber(res.completion_rate),
    cancellation_rate: parseStrictNumber(res.cancellation_rate),
    status_breakdown: (res.status_breakdown || []).map((s) => ({
      ...s,
      share_pct: parseStrictNumber(s.share_pct),
    })),
    type_breakdown: (res.type_breakdown || []).map((t) => ({
      ...t,
      share_pct: parseStrictNumber(t.share_pct),
    })),
    items: (res.items || []).map((o) => ({
      ...o,
      total_amount: parseStrictNumber(o.total_amount),
    })),
  }));
}

export function getManagerMenuReport(
  params?: ReportBaseQuery & {
    category_id?: number;
    search?: string;
    sort_by?: MenuReportSortBy;
    sort_dir?: SortDirection;
    page?: number;
    page_size?: number;
  },
  signal?: AbortSignal
): Promise<ManagerMenuReportResponse> {
  const qs = buildReportSearchParams({ ...params });
  return request<ManagerMenuReportResponse>(`/api/v1/manager/reports/menu${qs}`, {
    signal,
  }).then((res) => ({
    ...res,
    total_item_sales_value: parseStrictNumber(res.total_item_sales_value),
    category_summary: (res.category_summary || []).map((c) => ({
      ...c,
      sales_value: parseStrictNumber(c.sales_value),
      share_pct: parseStrictNumber(c.share_pct),
    })),
    top_selling_dishes: (res.top_selling_dishes || []).map((d) => ({
      ...d,
      sales_value: parseStrictNumber(d.sales_value),
      share_pct: parseStrictNumber(d.share_pct),
    })),
    lowest_selling_active_dishes: (res.lowest_selling_active_dishes || []).map((d) => ({
      ...d,
      sales_value: parseStrictNumber(d.sales_value),
      share_pct: parseStrictNumber(d.share_pct),
    })),
    items: (res.items || []).map((d) => ({
      ...d,
      sales_value: parseStrictNumber(d.sales_value),
      share_pct: parseStrictNumber(d.share_pct),
    })),
  }));
}

export function getManagerPaymentsReport(
  params?: ReportBaseQuery & {
    settlement?: "all" | PaymentSettlementState;
    method_code?: string;
    page?: number;
    page_size?: number;
  },
  signal?: AbortSignal
): Promise<ManagerPaymentsReportResponse> {
  const qs = buildReportSearchParams({ ...params });
  return request<ManagerPaymentsReportResponse>(`/api/v1/manager/reports/payments${qs}`, {
    signal,
  }).then((res) => ({
    ...res,
    settled_revenue: parseStrictNumber(res.settled_revenue),
    pending_revenue: parseStrictNumber(res.pending_revenue),
    voided_revenue: parseStrictNumber(res.voided_revenue),
    collection_rate_pct: parseStrictNumber(res.collection_rate_pct),
    method_breakdown: (res.method_breakdown || []).map((m) => ({
      ...m,
      settled_revenue: parseStrictNumber(m.settled_revenue),
      pending_revenue: parseStrictNumber(m.pending_revenue),
      voided_revenue: parseStrictNumber(m.voided_revenue),
      share_pct: parseStrictNumber(m.share_pct),
    })),
    items: (res.items || []).map((row) => ({
      ...row,
      subtotal: parseStrictNumber(row.subtotal),
      discount_amount: parseStrictNumber(row.discount_amount),
      tax_amount: parseStrictNumber(row.tax_amount),
      total_amount: parseStrictNumber(row.total_amount),
    })),
  }));
}

export function getManagerInventoryReport(
  params?: ReportBaseQuery & {
    transaction_type?: string;
    search?: string;
    page?: number;
    page_size?: number;
  },
  signal?: AbortSignal
): Promise<ManagerInventoryReportResponse> {
  const qs = buildReportSearchParams({ ...params });
  return request<ManagerInventoryReportResponse>(`/api/v1/manager/reports/inventory${qs}`, {
    signal,
  }).then((res) => ({
    ...res,
    top_consumed_items: (res.top_consumed_items || []).map((item) => ({
      ...item,
      consumed_qty: parseStrictNumber(item.consumed_qty),
      current_stock: parseStrictNumber(item.current_stock),
    })),
    item_summaries: (res.item_summaries || []).map((row) => ({
      ...row,
      current_stock: parseStrictNumber(row.current_stock),
      reorder_level: parseStrictNumber(row.reorder_level),
      consumed_qty: parseStrictNumber(row.consumed_qty),
      restocked_qty: parseStrictNumber(row.restocked_qty),
      waste_qty: parseStrictNumber(row.waste_qty),
      returned_qty: parseStrictNumber(row.returned_qty),
      adjusted_qty: parseStrictNumber(row.adjusted_qty),
    })),
    ledger_items: (res.ledger_items || []).map((tx) => ({
      ...tx,
      quantity_change: parseStrictNumber(tx.quantity_change),
    })),
  }));
}

export async function downloadManagerReportCsv(
  params: ReportBaseQuery & {
    report: ReportExportType;
    granularity?: ReportGranularity;
    status?: string;
    order_type?: string;
    category_id?: number;
    search?: string;
    sort_by?: MenuReportSortBy;
    sort_dir?: SortDirection;
    settlement?: "all" | PaymentSettlementState;
    method_code?: string;
    transaction_type?: string;
  }
): Promise<string> {
  const baseUrl = getStaffApiUrl();
  const token = getStaffToken();
  const qs = buildReportSearchParams(params);

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl}/api/v1/manager/reports/export${qs}`, {
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : "Report export failed.";
    throw new StaffApiError(response.status, detail);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || `savorybites-${params.report}-report.csv`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

function normalizeManagerSettings(res: ManagerSettingsResponse): ManagerSettingsResponse {
  return {
    ...res,
    ordering: {
      ...res.ordering,
      minimum_order_amount: parseStrictNumber(res.ordering.minimum_order_amount),
    },
    payment_methods: (res.payment_methods || []).map((pm) => ({
      ...pm,
      collected_revenue: parseStrictNumber(pm.collected_revenue),
    })),
  };
}

export const PUBLIC_SETTINGS_CACHE_KEY = "settings:public";

export function getCachedPublicRestaurantSettings(): PublicRestaurantSettingsResponse | null {
  return getSwrSnapshot<PublicRestaurantSettingsResponse>(PUBLIC_SETTINGS_CACHE_KEY);
}

export function getPublicRestaurantSettings(
  signal?: AbortSignal,
  options: { force?: boolean } = {}
): Promise<PublicRestaurantSettingsResponse> {
  return fetchWithSwrCache(
    PUBLIC_SETTINGS_CACHE_KEY,
    () =>
      request<PublicRestaurantSettingsResponse>("/api/v1/restaurant/settings", {
        signal,
      }).then((res) => ({
        ...res,
        ordering: {
          ...res.ordering,
          minimum_order_amount: parseStrictNumber(res.ordering.minimum_order_amount),
        },
      })),
    { freshMs: 20_000, force: options.force }
  );
}

export function getManagerSettings(signal?: AbortSignal): Promise<ManagerSettingsResponse> {
  return request<ManagerSettingsResponse>("/api/v1/manager/settings", { signal }).then(
    normalizeManagerSettings
  );
}

export function updateManagerRestaurantInfo(payload: {
  name: string;
  tagline: string;
  locality: string;
  full_address: string;
  phone: string;
  email: string;
  kitchen_notice: string;
  holiday_notice: string;
  expected_version?: number;
}): Promise<ManagerSettingsResponse> {
  return request<ManagerSettingsResponse>("/api/v1/manager/settings/restaurant", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(normalizeManagerSettings)
    .then((res) => {
      invalidateSwrPrefix("settings:");
      return res;
    });
}

export function updateManagerBusinessHours(payload: {
  hours: Array<Pick<BusinessHourEntry, "day_of_week" | "is_open" | "open_time" | "close_time">>;
  expected_version?: number;
}): Promise<ManagerSettingsResponse> {
  return request<ManagerSettingsResponse>("/api/v1/manager/settings/hours", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(normalizeManagerSettings)
    .then((res) => {
      invalidateSwrPrefix("settings:");
      return res;
    });
}

export function updateManagerOrderingSettings(payload: {
  online_ordering_enabled: boolean;
  online_ordering_pause_reason: string | null;
  dine_in_enabled: boolean;
  takeout_enabled: boolean;
  enforce_operating_hours: boolean;
  kitchen_cutoff_minutes: number;
  minimum_order_amount: number;
  expected_version?: number;
}): Promise<ManagerSettingsResponse> {
  return request<ManagerSettingsResponse>("/api/v1/manager/settings/ordering", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(normalizeManagerSettings)
    .then((res) => {
      invalidateSwrPrefix("settings:");
      return res;
    });
}

export function updateManagerNotificationSettings(payload: {
  send_order_confirmation_emails: boolean;
  send_contact_inquiry_emails: boolean;
  expected_version?: number;
}): Promise<ManagerSettingsResponse> {
  return request<ManagerSettingsResponse>("/api/v1/manager/settings/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(normalizeManagerSettings)
    .then((res) => {
      invalidateSwrPrefix("settings:");
      return res;
    });
}

export function changeStaffPassword(payload: {
  current_password: string;
  new_password: string;
}): Promise<{ message: string }> {
  return request<{ message: string }>("/api/v1/staff/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
