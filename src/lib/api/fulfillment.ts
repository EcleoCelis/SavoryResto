import type { RestaurantTable } from "../../types/fulfillment";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

export async function getRestaurantTables(): Promise<RestaurantTable[]> {
  const response = await fetch(`${apiUrl}/api/v1/restaurant-tables`);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Unable to load restaurant tables.");
  return data as RestaurantTable[];
}
