import {
  CART_STORAGE_KEY,
  type CartAddon,
  type CartItem,
  type CartItemDraft,
  type CartSize,
} from "../types/cart";

export const CART_UPDATED_EVENT = "savorybites-cart-updated";
export const MAX_CART_QUANTITY = 99;

function normalizeAddons(addons: CartAddon[]) {
  return [...addons].sort();
}

export function createCartLineId(productId: number, size: CartSize, addons: CartAddon[]) {
  return `${productId}:${size}:${normalizeAddons(addons).join("|")}`;
}

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;

  const item = value as Partial<CartItem>;
  return typeof item.productId === "number" && Number.isSafeInteger(item.productId) && item.productId > 0
    && typeof item.name === "string" && item.name.trim().length > 0
    && (typeof item.imageUrl === "string" || item.imageUrl === null)
    && typeof item.size === "string" && item.size.trim().length > 0 && item.size.length <= 50
    && Array.isArray(item.addons)
    && item.addons.every((addon) => typeof addon === "string" && addon.trim().length > 0 && addon.length <= 50)
    && new Set(item.addons).size === item.addons.length
    && typeof item.quantity === "number" && Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= MAX_CART_QUANTITY
    && typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice >= 0;
}

function normalizeCartItem(value: unknown): CartItem | null {
  if (typeof value !== "object" || value === null) return null;

  const storedItem = value as Partial<CartItem>;
  const unitPrice = typeof storedItem.unitPrice === "string"
    ? Number(storedItem.unitPrice)
    : storedItem.unitPrice;
  const item = { ...storedItem, unitPrice };
  if (!isCartItem(item)) return null;

  const addons = normalizeAddons(item.addons);
  return {
    ...item,
    addons,
    lineId: createCartLineId(item.productId, item.size, addons),
  };
}

export function loadCart(): CartItem[] {
  if (typeof window === "undefined") return [];

  try {
    const storedCart: unknown = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(storedCart)) return [];
    return storedCart.map(normalizeCartItem).filter((item): item is CartItem => item !== null);
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]) {
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
}

export function addCartItem(items: CartItem[], draft: CartItemDraft): CartItem[] {
  const quantity = Math.min(Math.max(1, Math.trunc(draft.quantity)), MAX_CART_QUANTITY);
  const addons = normalizeAddons(draft.addons);
  const lineId = createCartLineId(draft.productId, draft.size, addons);
  const nextItem: CartItem = { ...draft, addons, quantity, lineId };
  const matchingIndex = items.findIndex((item) => item.lineId === lineId);

  if (matchingIndex === -1) return [...items, nextItem];

  return items.map((item, index) => index === matchingIndex
    ? { ...item, quantity: Math.min(item.quantity + quantity, MAX_CART_QUANTITY) }
    : item);
}

export function updateCartItemQuantity(items: CartItem[], lineId: string, quantity: number): CartItem[] {
  if (!Number.isFinite(quantity)) return items;
  const normalizedQuantity = Math.min(Math.max(1, Math.trunc(quantity)), MAX_CART_QUANTITY);
  return items.map((item) => item.lineId === lineId ? { ...item, quantity: normalizedQuantity } : item);
}

export function removeCartItem(items: CartItem[], lineId: string) {
  return items.filter((item) => item.lineId !== lineId);
}
