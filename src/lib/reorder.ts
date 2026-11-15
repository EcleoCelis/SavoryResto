import { addCartItem, loadCart, saveCart } from "./cart";
import { getReorderPreview } from "./api/orders";
import type { ReorderPreview } from "../types/order";

export const REORDER_NOTICE_STORAGE_KEY = "savorybites_reorder_notice";

export interface ReorderResult {
  preview: ReorderPreview;
  addedCount: number;
  summaryMessage: string;
}

export async function reorderToCart(orderId: number): Promise<ReorderResult> {
  const preview = await getReorderPreview(orderId);

  let nextCart = loadCart();
  let addedCount = 0;

  for (const item of preview.available_items) {
    nextCart = addCartItem(nextCart, {
      productId: item.product_id,
      name: item.name,
      imageUrl: item.image_url,
      size: item.size,
      addons: item.addons,
      quantity: item.quantity,
      unitPrice: item.current_unit_price,
    });
    addedCount += item.quantity;
  }

  if (addedCount > 0) {
    saveCart(nextCart);
  }

  const noticeParts: string[] = [];
  if (addedCount > 0) {
    noticeParts.push(`Added ${addedCount} item${addedCount === 1 ? "" : "s"} from order #${preview.order_number} to your cart at live menu prices.`);
  } else {
    noticeParts.push(`No items from order #${preview.order_number} could be added to your cart.`);
  }
  if (preview.has_price_changes) {
    noticeParts.push("Some item prices have been updated to current menu pricing.");
  }
  if (preview.unavailable_items.length > 0) {
    const skippedNames = preview.unavailable_items.map((u) => `${u.name} (${u.reason})`).join("; ");
    noticeParts.push(`Skipped unavailable items: ${skippedNames}.`);
  }

  const summaryMessage = noticeParts.join(" ");
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(REORDER_NOTICE_STORAGE_KEY, summaryMessage);
    } catch {
      // Ignore sessionStorage errors.
    }
  }

  return { preview, addedCount, summaryMessage };
}
