"use client";

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";

import {
  addCartItem,
  CART_UPDATED_EVENT,
  loadCart,
  removeCartItem,
  saveCart,
  updateCartItemQuantity,
} from "../../lib/cart";
import { CART_STORAGE_KEY, type CartItem, type CartItemDraft } from "../../types/cart";

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  addItem: (item: CartItemDraft) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  removeItem: (lineId: string) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const emptyCart: CartItem[] = [];
let cachedCart: CartItem[] | null = null;

function getCartSnapshot() {
  if (cachedCart === null) cachedCart = loadCart();
  return cachedCart;
}

function getServerSnapshot() {
  return emptyCart;
}

function subscribeToCart(onStoreChange: () => void) {
  const syncCart = () => {
    cachedCart = loadCart();
    onStoreChange();
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CART_STORAGE_KEY) syncCart();
  };

  window.addEventListener(CART_UPDATED_EVENT, syncCart);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CART_UPDATED_EVENT, syncCart);
    window.removeEventListener("storage", handleStorage);
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribeToCart, getCartSnapshot, getServerSnapshot);
  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  const subtotal = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);

  function commit(nextItems: CartItem[]) {
    cachedCart = nextItems;
    saveCart(nextItems);
  }

  function addItem(item: CartItemDraft) {
    commit(addCartItem(items, item));
  }

  function updateQuantity(lineId: string, quantity: number) {
    commit(updateCartItemQuantity(items, lineId, quantity));
  }

  function removeItem(lineId: string) {
    commit(removeCartItem(items, lineId));
  }

  function clearCart() {
    commit([]);
  }

  return <CartContext value={{ items, itemCount, subtotal, addItem, updateQuantity, removeItem, clearCart }}>{children}</CartContext>;
}

export function useCart() {
  const cart = useContext(CartContext);
  if (cart === null) throw new Error("useCart must be used within CartProvider.");
  return cart;
}
