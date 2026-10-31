export type OrderType = "dine_in" | "takeout";
export type FulfillmentType = "table_service" | "counter_pickup";

export type FulfillmentSelection = {
  orderType: OrderType;
  fulfillmentType: FulfillmentType;
  restaurantTableId: number | null;
  tableNumber: string | null;
};

export type RestaurantTable = {
  id: number;
  table_number: string;
  seats: number;
  is_available: boolean;
};
