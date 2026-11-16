"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CustomerRouteGuard } from "../../components/auth/CustomerRouteGuard";
import { useCart } from "../../components/cart/CartProvider";
import { useFulfillment } from "../../components/fulfillment/FulfillmentProvider";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { ArrowLeftIcon, CheckIcon, ShieldCheckIcon } from "../../components/ui/Icons";
import { CheckoutApiError, quoteCheckout } from "../../lib/api/checkout";
import { getCustomerProfile } from "../../lib/api/customer";
import { createOrder, OrderApiError } from "../../lib/api/orders";
import { getPaymentMethods } from "../../lib/api/payment-methods";
import type { CheckoutQuote } from "../../types/checkout";
import type { PaymentMethod } from "../../types/payment-method";
import styles from "../checkout/checkout.module.css";

const CHECKOUT_EXTRAS_STORAGE_KEY = "savorybites_checkout_extras";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function PaymentContent() {
  const router = useRouter();
  const { items, clearCart } = useCart();
  const { selection, clearSelection } = useFulfillment();
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentMethodCode, setSelectedPaymentMethodCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (items.length === 0) return;
    if (selection === null) {
      router.replace("/start-order?next=%2Fpayment");
      return;
    }
    let active = true;
    async function loadPayment() {
      setIsLoading(true);
      setError("");
      try {
        const [loadedQuote, loadedPaymentMethods, loadedProfile] = await Promise.all([
          quoteCheckout({
            items: items.map((item) => ({
              cart_line_id: item.lineId,
              product_id: item.productId,
              quantity: item.quantity,
              size: item.size,
              addons: item.addons,
            })),
          }),
          getPaymentMethods(),
          getCustomerProfile().catch(() => null),
        ]);
        if (!active) return;
        if (loadedPaymentMethods.length === 0) {
          setError("No payment methods are currently available. Please try again later.");
          return;
        }
        setQuote(loadedQuote);
        setPaymentMethods(loadedPaymentMethods);
        const preferredCode = loadedProfile?.preferred_payment_code ?? "";
        const preferredIsValid = Boolean(
          preferredCode && loadedPaymentMethods.some((method) => method.code === preferredCode)
        );
        setSelectedPaymentMethodCode((currentCode) => {
          if (currentCode && loadedPaymentMethods.some((method) => method.code === currentCode)) {
            return currentCode;
          }
          if (preferredIsValid) {
            return preferredCode;
          }
          return loadedPaymentMethods[0]?.code ?? "";
        });
      } catch (requestError) {
        if (!active) return;
        if (requestError instanceof CheckoutApiError && requestError.status === 401) {
          router.replace("/login");
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load payment options. Please try again."
        );
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void loadPayment();
    return () => {
      active = false;
    };
  }, [items, router, selection]);

  async function handlePlaceOrder() {
    if (!quote || !selection || !selectedPaymentMethodCode || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      let checkoutExtras: {
        selectedAddressId?: number | null;
        includeAllergyAlert?: boolean;
        preparationNotes?: string | null;
      } = {};
      if (typeof window !== "undefined") {
        try {
          const raw = window.sessionStorage.getItem(CHECKOUT_EXTRAS_STORAGE_KEY);
          if (raw) {
            checkoutExtras = JSON.parse(raw) as typeof checkoutExtras;
          }
        } catch {
          checkoutExtras = {};
        }
      }

      const order = await createOrder(
        {
          items: items.map((item) => ({
            cart_line_id: item.lineId,
            product_id: item.productId,
            quantity: item.quantity,
            size: item.size,
            addons: item.addons,
          })),
          payment_method_code: selectedPaymentMethodCode,
          order_type: selection.orderType,
          fulfillment_type: selection.fulfillmentType,
          restaurant_table_id: selection.restaurantTableId,
          selected_address_id: checkoutExtras.selectedAddressId ?? null,
          include_allergy_alert: checkoutExtras.includeAllergyAlert ?? true,
          preparation_notes: checkoutExtras.preparationNotes ?? null,
        },
        idempotencyKey.current
      );
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem(CHECKOUT_EXTRAS_STORAGE_KEY);
        } catch {
          // Ignore storage cleanup failure.
        }
      }
      clearCart();
      clearSelection();
      router.push(`/order-confirmation/${order.id}`);
    } catch (requestError) {
      if (requestError instanceof OrderApiError && requestError.status === 401) {
        router.replace("/login");
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to place the order. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <Header />
      <main id="main-content" className={styles.content} aria-labelledby="payment-title">
        {/* Visual Stepper */}
        <ol className={styles.stepper} aria-label="Checkout Progress">
          <li className={`${styles.stepItem} ${styles.stepComplete}`}>
            <span className={styles.stepBubble} aria-hidden="true">
              <CheckIcon size={14} />
            </span>
            <span className={styles.stepLabel}>Service</span>
          </li>
          <li className={`${styles.stepItem} ${styles.stepComplete}`}>
            <span className={styles.stepBubble} aria-hidden="true">
              <CheckIcon size={14} />
            </span>
            <span className={styles.stepLabel}>Review Details</span>
          </li>
          <li className={`${styles.stepItem} ${styles.stepActive}`} aria-current="step">
            <span className={styles.stepBubble} aria-hidden="true">3</span>
            <span className={styles.stepLabel}>Payment</span>
          </li>
        </ol>

        <header className={styles.intro}>
          <p>Final Step</p>
          <h1 id="payment-title">Choose Payment Method</h1>
          <span>
            Select how you would like to settle your order. The kitchen begins preparation upon confirmation.
          </span>
        </header>

        {items.length === 0 ? (
          <section className={styles.empty}>
            <h2>Your cart is empty</h2>
            <p>Add an item from our menu before choosing a payment method.</p>
            <Link href="/menu">Browse the menu</Link>
          </section>
        ) : null}

        {items.length > 0 && selection === null ? (
          <section className={styles.message} aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <p>Directing you to dining service options...</p>
          </section>
        ) : null}

        {items.length > 0 && selection !== null && isLoading ? (
          <section className={styles.message} aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <p>Loading available payment options...</p>
          </section>
        ) : null}

        {items.length > 0 && selection !== null && !isLoading && error ? (
          <section className={styles.message} role="alert">
            <h2>Payment Needs Attention</h2>
            <p>{error}</p>
            <div>
              <Link href="/checkout">Return to checkout</Link>
              <Link href="/cart">Return to cart</Link>
            </div>
          </section>
        ) : null}

        {items.length > 0 && selection !== null && !isLoading && !error && quote ? (
          <div className={styles.layout}>
            <section className={styles.review}>
              <section className={styles.card} aria-labelledby="choose-payment-heading">
                <p className={styles.eyebrow}>
                  <ShieldCheckIcon size={12} style={{ display: "inline", marginRight: "4px", verticalAlign: "-1px" }} />
                  <span>Accepted Methods</span>
                </p>
                <h2 id="choose-payment-heading">Payment Preference</h2>
                <fieldset className={styles.paymentMethods}>
                  <legend>Select one payment option for your dining service</legend>
                  {paymentMethods.map((method) => (
                    <label
                      key={method.code}
                      className={
                        selectedPaymentMethodCode === method.code
                          ? styles.selectedPaymentMethod
                          : undefined
                      }
                    >
                      <input
                        type="radio"
                        name="payment-method"
                        value={method.code}
                        checked={selectedPaymentMethodCode === method.code}
                        onChange={(event) => setSelectedPaymentMethodCode(event.target.value)}
                      />
                      <span>
                        <b>{method.label}</b>
                        {method.description ? <small>{method.description}</small> : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </section>

              <section className={styles.card}>
                <p className={styles.eyebrow}>Fulfillment Destination</p>
                <h2>
                  {selection.fulfillmentType === "table_service"
                    ? `Dine In at Table ${selection.tableNumber}`
                    : "Counter Pickup at Restaurant"}
                </h2>
                <p className={styles.note}>
                  {selection.fulfillmentType === "table_service"
                    ? "Our staff will bring your freshly cooked dishes directly to your table when ready."
                    : "Your order will be packaged securely and ready at our pickup counter."}{" "}
                  <Link href="/start-order?next=%2Fpayment">Change service mode</Link>
                </p>
              </section>
            </section>

            <aside className={styles.summary} aria-label="Final order payment summary">
              <h2>Order summary</h2>
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
              <div className={styles.total}>
                <span>Total Amount</span>
                <strong>{currencyFormatter.format(quote.total)}</strong>
              </div>

              {error && <p className={styles.submissionError}>{error}</p>}

              <button
                type="button"
                className={styles.placeOrder}
                onClick={() => void handlePlaceOrder()}
                disabled={!selectedPaymentMethodCode || isSubmitting}
              >
                {isSubmitting
                  ? "Transmitting order to kitchen..."
                  : `Confirm & Place Order · ${currencyFormatter.format(quote.total)}`}
              </button>
              <Link href="/checkout" className={styles.back}>
                <ArrowLeftIcon size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
                <span>Back to Order Review</span>
              </Link>
            </aside>
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}

export default function PaymentPage() {
  return (
    <CustomerRouteGuard>
      <PaymentContent />
    </CustomerRouteGuard>
  );
}
