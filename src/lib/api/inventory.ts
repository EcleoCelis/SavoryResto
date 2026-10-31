import type {
  InventoryItem,
  InventoryTransaction,
  InventoryTransactionCreateInput,
} from "../../types/inventory";
import { getStaffApiUrl, getStaffToken, StaffApiError } from "./staff";

type InventoryItemApiResponse = Omit<InventoryItem, "current_stock" | "reorder_level" | "unit_cost"> & {
  current_stock: number | string;
  reorder_level: number | string;
  unit_cost: number | string;
};

type InventoryTransactionApiResponse = Omit<
  InventoryTransaction,
  "quantity_change" | "stock_before" | "stock_after" | "unit_cost"
> & {
  quantity_change: number | string;
  stock_before: number | string;
  stock_after: number | string;
  unit_cost: number | string | null;
};

async function managerRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
    const detail = typeof data === "object" && data !== null && "detail" in data ? (data as { detail: unknown }).detail : null;
    throw new StaffApiError(response.status, typeof detail === "string" ? detail : "Inventory request failed.");
  }
  return data as T;
}

function normalizeInventoryItem(item: InventoryItemApiResponse): InventoryItem {
  return {
    ...item,
    current_stock: Number(item.current_stock),
    reorder_level: Number(item.reorder_level),
    unit_cost: Number(item.unit_cost),
  };
}

function normalizeTransaction(tx: InventoryTransactionApiResponse): InventoryTransaction {
  return {
    ...tx,
    quantity_change: Number(tx.quantity_change),
    stock_before: Number(tx.stock_before),
    stock_after: Number(tx.stock_after),
    unit_cost: tx.unit_cost !== null ? Number(tx.unit_cost) : null,
  };
}

export function getInventory(lowStockOnly = false): Promise<InventoryItem[]> {
  const query = lowStockOnly ? "?low_stock_only=true" : "";
  return managerRequest<InventoryItemApiResponse[]>(`/api/v1/inventory${query}`).then((items) =>
    items.map(normalizeInventoryItem),
  );
}

export function getLowStockInventory(): Promise<InventoryItem[]> {
  return managerRequest<InventoryItemApiResponse[]>("/api/v1/inventory/low-stock").then((items) =>
    items.map(normalizeInventoryItem),
  );
}

export function getInventoryTransactions(itemId?: number): Promise<InventoryTransaction[]> {
  const query = itemId ? `?item_id=${encodeURIComponent(itemId)}` : "";
  return managerRequest<InventoryTransactionApiResponse[]>(`/api/v1/inventory/transactions${query}`).then((txs) =>
    txs.map(normalizeTransaction),
  );
}

export function recordInventoryTransaction(
  itemId: number,
  input: InventoryTransactionCreateInput,
): Promise<InventoryTransaction> {
  return managerRequest<InventoryTransactionApiResponse>(`/api/v1/inventory/${itemId}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then(normalizeTransaction);
}
