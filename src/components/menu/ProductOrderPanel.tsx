"use client";

import Link from "next/link";
import { useState } from "react";

import styles from "../../app/menu/menu.module.css";
import { MAX_CART_QUANTITY } from "../../lib/cart";
import { ArrowRightIcon, CheckIcon, MinusIcon, PlusIcon } from "../ui/Icons";
import { useCart } from "../cart/CartProvider";
import type { Product } from "../../types/product";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

type OrderableProduct = Pick<
  Product,
  "id" | "name" | "price" | "image_url" | "is_available" | "sizes" | "addons"
> & {
  imageUrl?: string | null;
};

export function ProductOrderPanel({ item }: { item: OrderableProduct }) {
  const { addItem, itemCount } = useCart();
  const [size, setSize] = useState(() => item.sizes[0]?.code ?? "");
  const [addons, setAddons] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const selectedSize = item.sizes.find((option) => option.code === size);
  const unitPrice =
    item.price +
    (selectedSize?.price_adjustment ?? 0) +
    addons.reduce((total, addon) => {
      const match = item.addons.find((option) => option.code === addon);
      return total + (match?.price_adjustment ?? 0);
    }, 0);

  function toggleAddon(addon: string) {
    setAddons((selected) =>
      selected.includes(addon)
        ? selected.filter((value) => value !== addon)
        : [...selected, addon]
    );
    setAdded(false);
  }

  function handleAddToCart() {
    if (!item.is_available || !selectedSize) return;
    addItem({
      productId: item.id,
      name: item.name,
      imageUrl: item.image_url ?? item.imageUrl ?? null,
      size,
      addons,
      quantity,
      unitPrice,
    });
    setAdded(true);
  }

  if (!item.is_available) {
    return (
      <section className={styles.orderPanel} aria-label="Product availability">
        <p className={styles.unavailable}>This item is currently unavailable or sold out.</p>
        <button className={styles.addToCart} type="button" disabled>
          Unavailable to order
        </button>
      </section>
    );
  }

  return (
    <section className={styles.orderPanel} aria-label="Customize your order">
      {item.sizes.length > 0 && (
        <fieldset>
          <legend>Choose Size</legend>
          <div className={styles.optionsGrid} role="radiogroup">
            {item.sizes.map((option) => {
              const isSelected = size === option.code;
              return (
                <label
                  key={option.code}
                  className={`${styles.optionCard} ${isSelected ? styles.optionCardSelected : ""}`}
                >
                  <input
                    type="radio"
                    name="size"
                    value={option.code}
                    checked={isSelected}
                    onChange={() => {
                      setSize(option.code);
                      setAdded(false);
                    }}
                  />
                  <span>{option.label}</span>
                  {option.price_adjustment > 0 ? (
                    <span className={styles.optionPriceAdj}>
                      +{currencyFormatter.format(option.price_adjustment)}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {item.addons.length > 0 && (
        <fieldset>
          <legend>Add-ons & Extras</legend>
          <div className={styles.optionsGrid}>
            {item.addons.map((option) => {
              const isSelected = addons.includes(option.code);
              return (
                <label
                  key={option.code}
                  className={`${styles.optionCard} ${isSelected ? styles.optionCardSelected : ""}`}
                >
                  <input
                    type="checkbox"
                    value={option.code}
                    checked={isSelected}
                    onChange={() => toggleAddon(option.code)}
                  />
                  <span>{option.label}</span>
                  {option.price_adjustment > 0 ? (
                    <span className={styles.optionPriceAdj}>
                      +{currencyFormatter.format(option.price_adjustment)}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className={styles.quantity}>
        <span>Quantity</span>
        <div className={styles.quantityControl} aria-label="Adjust order quantity">
          <button
            type="button"
            onClick={() => {
              setQuantity((current) => Math.max(1, current - 1));
              setAdded(false);
            }}
            aria-label="Decrease quantity"
            disabled={quantity <= 1}
          >
            <MinusIcon size={14} />
          </button>
          <b aria-live="polite">{quantity}</b>
          <button
            type="button"
            onClick={() => {
              setQuantity((current) => Math.min(MAX_CART_QUANTITY, current + 1));
              setAdded(false);
            }}
            aria-label="Increase quantity"
            disabled={quantity === MAX_CART_QUANTITY}
          >
            <PlusIcon size={14} />
          </button>
        </div>
      </div>

      <button
        className={styles.addToCart}
        type="button"
        onClick={handleAddToCart}
        disabled={!selectedSize}
      >
        {added
          ? `Added to Cart · ${currencyFormatter.format(unitPrice * quantity)}`
          : `Add to cart · ${currencyFormatter.format(unitPrice * quantity)}`}
      </button>

      <p className={styles.addedStatus} role="status">
        {selectedSize ? (
          added ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", justifyContent: "center" }}>
              <CheckIcon size={16} />
              <span>Dish successfully added to your cart!</span>
            </span>
          ) : (
            ""
          )
        ) : (
          "Please select an available size."
        )}
      </p>

      {added && (
        <div className={styles.postAddActions}>
          <Link href="/cart" className={styles.viewCartButton}>
            <span>View Cart ({itemCount}) & Checkout</span>
            <ArrowRightIcon size={14} style={{ display: "inline", marginLeft: "6px" }} />
          </Link>
          <Link href="/menu" className={styles.continueShoppingLink}>
            Order more dishes
          </Link>
        </div>
      )}
    </section>
  );
}
