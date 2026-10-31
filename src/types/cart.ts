export const CART_STORAGE_KEY = "savorybites-cart";

export type CartAddon = string;
export type CartSize = string;

export type CartItem = {
  lineId: string;
  productId: number;
  name: string;
  imageUrl: string | null;
  size: CartSize;
  addons: CartAddon[];
  quantity: number;
  unitPrice: number;
};

export type CartItemDraft = Omit<CartItem, "lineId">;
