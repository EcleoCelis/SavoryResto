export type InventoryStatus = "normal" | "low_stock" | "out_of_stock";

export type ManualTransactionType = "purchase" | "waste" | "adjustment" | "return";

export type TransactionType = ManualTransactionType | "sale";

export type InventoryItem = {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  current_stock: number;
  reorder_level: number;
  unit_cost: number;
  is_active: boolean;
  stock_status: InventoryStatus;
  updated_at: string;
};

export type InventoryTransaction = {
  id: number;
  inventory_item_id: number;
  inventory_item_name: string;
  transaction_type: TransactionType;
  quantity_change: number;
  stock_before: number;
  stock_after: number;
  unit_cost: number | null;
  reference_type: string | null;
  reference_id: number | null;
  notes: string | null;
  performed_by: number;
  created_at: string;
};

export type InventoryTransactionCreateInput = {
  transaction_type: ManualTransactionType;
  quantity_change: number;
  notes?: string | null;
};
