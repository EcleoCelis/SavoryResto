"use client";

import Image from "next/image";
import Link from "next/link";

import { useCart } from "../../components/cart/CartProvider";
import { useFulfillment } from "../../components/fulfillment/FulfillmentProvider";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
  UtensilsIcon,
} from "../../components/ui/Icons";
import { MAX_CART_QUANTITY } from "../../lib/cart";
import styles from "./cart.module.css";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function formatOptions(size: string, addons: string[]) {
  return [size, ...addons].filter(Boolean).join(" · ");
}

export default function CartPage() {
  const { items, itemCount, subtotal, removeItem, updateQuantity } = useCart();
  const { selection } = useFulfillment();

  const checkoutHref =
    selection === null ? "/start-order?next=%2Fcheckout" : "/checkout";
  const checkoutLabel =
    selection === null ? "Choose service to continue" : "Proceed to checkout";
  const serviceLabel =
    selection?.fulfillmentType === "table_service"
      ? `Table Service (${selection.tableNumber})`
      : selection === null
      ? "Not selected yet"
      : "Counter Pickup";

  return (
    <div className={styles.page}>
      <Header />
      <main id="main-content" className={styles.content} aria-labelledby="cart-title">
        <header className={styles.intro}>
          <p>Your Order Review</p>
          <h1 id="cart-title">Your Order Cart</h1>
          <span>
            {itemCount > 0
              ? `${itemCount} dish${itemCount === 1 ? "" : "es"} in your order.`
              : "Review the dishes you would like to order."}
          </span>
        </header>

        {items.length === 0 ? (
          <section className={styles.empty} aria-label="Empty cart notice">
            <div className={styles.emptyMark} aria-hidden="true">
              <UtensilsIcon size={32} />
            </div>
            <h2>Your cart is currently empty</h2>
            <p>
              Discover delicious appetizers, freshly cooked entrees, and comforting favorites on our menu.
            </p>
            <Link href="/menu">Browse the menu</Link>
          </section>
        ) : (
          <>
            {/* Fulfillment Service Indicator */}
            <div className={styles.serviceBanner}>
              <div className={styles.serviceInfo}>
                <span className={styles.serviceBadge}>Fulfillment</span>
                <span className={styles.serviceText}>
                  Dining Mode: <strong>{serviceLabel}</strong>
                </span>
              </div>
              <Link href="/start-order?next=%2Fcart" className={styles.changeServiceLink}>
                Change service options
              </Link>
            </div>

            <div className={styles.cartLayout}>
              <section className={styles.items} aria-label="Dishes in your order">
                {items.map((item) => {
                  const itemSubtotal = item.unitPrice * item.quantity;
                  return (
                    <article className={styles.item} key={item.lineId}>
                      <div className={styles.image}>
                        {item.imageUrl ? (
                          <Image
                            src={item.imageUrl}
                            alt={item.name}
                            fill
                            sizes="(max-width: 680px) 84px, 108px"
                          />
                        ) : (
                          <span aria-label={`${item.name} image unavailable`}>
                            {item.name.slice(0, 1)}
                          </span>
                        )}
                      </div>

                      <div className={styles.itemDetails}>
                        <div className={styles.itemTopline}>
                          <div>
                            <h2>{item.name}</h2>
                            <p>{formatOptions(item.size, item.addons)}</p>
                          </div>
                          <button
                            type="button"
                            className={styles.remove}
                            onClick={() => removeItem(item.lineId)}
                            aria-label={`Remove ${item.name} from cart`}
                            title={`Remove ${item.name}`}
                          >
                            <TrashIcon size={19} />
                          </button>
                        </div>

                        <div className={styles.itemBottom}>
                          <div
                            className={styles.quantity}
                            aria-label={`Quantity for ${item.name}`}
                          >
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.lineId, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              aria-label={`Decrease quantity of ${item.name}`}
                            >
                              <MinusIcon size={14} />
                            </button>
                            <b aria-live="polite">{item.quantity}</b>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.lineId, item.quantity + 1)}
                              disabled={item.quantity >= MAX_CART_QUANTITY}
                              aria-label={`Increase quantity of ${item.name}`}
                            >
                              <PlusIcon size={14} />
                            </button>
                          </div>

                          <div className={styles.priceGroup}>
                            <small className={styles.unitPrice}>
                              {currencyFormatter.format(item.unitPrice)} each
                            </small>
                            <strong className={styles.itemSubtotal}>
                              {currencyFormatter.format(itemSubtotal)}
                            </strong>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>

              <aside className={styles.summary} aria-label="Order summary">
                <h2>Order summary</h2>
                <div className={styles.summaryRow}>
                  <span>Subtotal</span>
                  <strong>{currencyFormatter.format(subtotal)}</strong>
                </div>
                <div className={styles.summaryRow}>
                  <span>Service Type</span>
                  <strong>{serviceLabel}</strong>
                </div>
                <div className={styles.summaryRow}>
                  <span>Taxes & Fees</span>
                  <strong>Included</strong>
                </div>

                <div className={styles.totalRow}>
                  <span>Total Amount</span>
                  <strong>{currencyFormatter.format(subtotal)}</strong>
                </div>

                <Link href={checkoutHref} className={styles.checkoutButton}>
                  <span>{checkoutLabel}</span>
                  <ArrowRightIcon size={16} style={{ display: "inline", marginLeft: "6px" }} />
                </Link>
                <Link href="/menu" className={styles.continue}>
                  <ArrowLeftIcon size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
                  <span>Continue browsing menu</span>
                </Link>
              </aside>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
