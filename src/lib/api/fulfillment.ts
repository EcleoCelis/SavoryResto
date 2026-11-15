import type { RestaurantTable } from "../../types/fulfillment";
import { getApiBaseUrl } from "./base-url";

export async function getRestaurantTables(): Promise<RestaurantTable[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/restaurant-tables`);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Unable to load restaurant tables.");
  return data as RestaurantTable[];
}
