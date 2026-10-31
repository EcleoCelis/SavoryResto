"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useCart } from "../../components/cart/CartProvider";
import { useFulfillment } from "../../components/fulfillment/FulfillmentProvider";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ShieldCheckIcon } from "../../components/ui/Icons";
import { CheckoutApiError, getCheckoutCustomer, quoteCheckout } from "../../lib/api/checkout";
import type { CheckoutCustomer, CheckoutQuote } from "../../types/checkout";
import styles from "./checkout.module.css";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export default function CheckoutPage() {
  const router = useRouter();
  const { items } = useCart();
  const { selection } = useFulfillment();
  const [customer, setCustomer] = useState<CheckoutCustomer | null>(null);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (items.length === 0) return;
    if (selection === null) {
      router.replace("/start-order?next=%2Fcheckout");
      return;
    }
    let active = true;

    async function loadCheckout() {
      setIsLoading(true);
      setError("");
      try {
        const [loadedCustomer, loadedQuote] = await Promise.all([
          getCheckoutCustomer(),
          quoteCheckout({
            items: items.map((item) => ({
              cart_line_id: item.lineId,
              product_id: item.productId,
              quantity: item.quantity,
              size: item.size,
              addons: item.addons,
            })),
          }),
        ]);
        if (!active) return;
        const cartByLineId = new Map(items.map((item) => [item.lineId, item]));
        const hasPriceMismatch = loadedQuote.items.some(
          (line) => cartByLineId.get(line.cart_line_id)?.unitPrice !== line.unit_price
        );
        if (hasPriceMismatch) {
          setCustomer(loadedCustomer);
          setQuote(null);
          setError("A menu price or selected option has changed. Please update your cart before checkout.");
          return;
        }
        setCustomer(loadedCustomer);
        setQuote(loadedQuote);
      } catch (requestError) {
        if (!active) return;
        if (requestError instanceof CheckoutApiError && requestError.status === 401) {
          router.replace("/login");
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to prepare checkout. Please try again."
        );
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadCheckout();
    return () => {
      active = false;
    };
  }, [items, retryCount, router, selection]);

  return (
    <div className={styles.page}>
      <Header />
      <main id="main-content" className={styles.content} aria-labelledby="checkout-title">
        {/* Visual Stepper */}
        <ol className={styles.stepper} aria-label="Checkout Progress">
          <li className={`${styles.stepItem} ${styles.stepComplete}`}>
            <span className={styles.stepBubble} aria-hidden="true">
              <CheckIcon size={14} />
            </span>
            <span className={styles.stepLabel}>Service</span>
          </li>
          <li className={`${styles.stepItem} ${styles.stepActive}`} aria-current="step">
            <span className={styles.stepBubble} aria-hidden="true">2</span>
            <span className={styles.stepLabel}>Review Details</span>
          </li>
          <li className={styles.stepItem}>
            <span className={styles.stepBubble} aria-hidden="true">3</span>
            <span className={styles.stepLabel}>Payment</span>
          </li>
        </ol>

        <header className={styles.intro}>
          <p>Order Verification</p>
          <h1 id="checkout-title">Review Your Order</h1>
          <span>
            Confirm your contact details, service mode, and dishes before proceeding to payment.
          </span>
        </header>

        {items.length === 0 ? (
          <section className={styles.empty} aria-label="Empty cart message">
            <h2>Your cart is empty</h2>
            <p>Please select delicious dishes from our menu before continuing to checkout.</p>
            <Link href="/menu">Browse our menu</Link>
          </section>
        ) : null}

        {items.length > 0 && selection === null ? (
          <section className={styles.message} aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <p>Directing you to service selection options...</p>
          </section>
        ) : null}

        {items.length > 0 && selection !== null && isLoading ? (
          <section className={styles.message} aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <p>Preparing your checkout verification...</p>
          </section>
        ) : null}

        {items.length > 0 && selection !== null && !isLoading && error ? (
          <section className={styles.message} role="alert">
            <h2>Checkout Needs Attention</h2>
            <p>{error}</p>
            <div>
              <button type="button" onClick={() => setRetryCount((count) => count + 1)}>
                Try again
              </button>
              <Link href="/cart">Return to cart</Link>
            </div>
          </section>
        ) : null}

        {items.length > 0 && selection !== null && !isLoading && !error && customer && quote ? (
          <div className={styles.layout}>
            <div className={styles.review}>
              {/* Customer Contact Information */}
              <section className={styles.card} aria-labelledby="contact-details-heading">
                <p className={styles.eyebrow}>Guest Details</p>
                <h2 id="contact-details-heading">Contact Information</h2>
                <dl>
                  <div>
                    <dt>Customer Name</dt>
                    <dd>{customer.full_name}</dd>
                  </div>
                  <div>
                    <dt>Contact Mobile</dt>
                    <dd>{customer.phone || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Email Address</dt>
                    <dd>{customer.email || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Saved Address</dt>
                    <dd>{customer.address || "Not provided (optional for dine-in & pickup)"}</dd>
                  </div>
                </dl>
                <p className={styles.note}>
                  <ShieldCheckIcon size={14} style={{ display: "inline", marginRight: "6px", verticalAlign: "-2px" }} />
                  <span>
                    {selection.fulfillmentType === "table_service"
                      ? `Dining mode: Dine-in Table Service to ${selection.tableNumber}.`
                      : "Dining mode: Your order will be prepared for Counter Pickup."}
                  </span>{" "}
                  <Link href="/start-order?next=%2Fcheckout">Change service type</Link>
                </p>
              </section>

              {/* Order Items Review */}
              <section className={styles.card} aria-labelledby="items-review-heading">
                <p className={styles.eyebrow}>Verified Dishes</p>
                <h2 id="items-review-heading">Kitchen Order Breakdown</h2>
                <div className={styles.items}>
                  {quote.items.map((line) => {
                    const cartItem = items.find((item) => item.lineId === line.cart_line_id);
                    return (
                      <article key={line.cart_line_id}>
                        <div className={styles.image}>
                          {cartItem?.imageUrl ? (
                            <Image src={cartItem.imageUrl} alt={line.name} fill sizes="58px" />
                          ) : (
                            <span aria-hidden="true">{line.name.slice(0, 1)}</span>
                          )}
                        </div>
                        <div>
                          <h3>{line.name}</h3>
                          <p>
                            {cartItem
                              ? [cartItem.size, ...cartItem.addons].filter(Boolean).join(" · ")
                              : "Standard"}
                          </p>
                          <small>
                            {line.quantity} × {currencyFormatter.format(line.unit_price)}
                          </small>
                        </div>
                        <strong>{currencyFormatter.format(line.subtotal)}</strong>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Sticky Summary */}
            <aside className={styles.summary} aria-label="Checkout price summary">
              <h2>Checkout summary</h2>
              <div>
                <span>Items Subtotal</span>
                <strong>{currencyFormatter.format(quote.subtotal)}</strong>
              </div>
              <div>
                <span>Dining Service</span>
                <strong>
                  {selection.fulfillmentType === "table_service"
                    ? selection.tableNumber
                    : "Counter Pickup"}
                </strong>
              </div>
              <div>
                <span>Local Taxes & Service</span>
                <strong>Included</strong>
              </div>
              <div className={styles.total}>
                <span>Total Due</span>
                <strong>{currencyFormatter.format(quote.total)}</strong>
              </div>

              <Link href="/payment" className={styles.placeOrder}>
                <span>Continue to Payment</span>
                <ArrowRightIcon size={14} style={{ display: "inline", marginLeft: "6px" }} />
              </Link>
              <Link href="/cart" className={styles.back}>
                <ArrowLeftIcon size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
                <span>Back to Cart</span>
              </Link>
            </aside>
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
