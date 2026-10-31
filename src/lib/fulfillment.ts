import type { FulfillmentSelection } from "../types/fulfillment";

export const FULFILLMENT_STORAGE_KEY = "savorybites-fulfillment";
export const FULFILLMENT_UPDATED_EVENT = "savorybites-fulfillment-updated";

export function loadFulfillment(): FulfillmentSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FULFILLMENT_STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const selection = value as Partial<FulfillmentSelection>;
    if (selection.orderType === "takeout" && selection.fulfillmentType === "counter_pickup" && selection.restaurantTableId === null) {
      return { orderType: "takeout", fulfillmentType: "counter_pickup", restaurantTableId: null, tableNumber: null };
    }
    if (selection.orderType === "dine_in" && selection.fulfillmentType === "table_service" && typeof selection.restaurantTableId === "number" && typeof selection.tableNumber === "string") {
      return { orderType: "dine_in", fulfillmentType: "table_service", restaurantTableId: selection.restaurantTableId, tableNumber: selection.tableNumber };
    }
  } catch {
    // Invalid browser storage is treated as no fulfillment selection.
  }
  return null;
}

export function saveFulfillment(selection: FulfillmentSelection) {
  window.localStorage.setItem(FULFILLMENT_STORAGE_KEY, JSON.stringify(selection));
  window.dispatchEvent(new Event(FULFILLMENT_UPDATED_EVENT));
}

export function clearFulfillment() {
  window.localStorage.removeItem(FULFILLMENT_STORAGE_KEY);
  window.dispatchEvent(new Event(FULFILLMENT_UPDATED_EVENT));
}
