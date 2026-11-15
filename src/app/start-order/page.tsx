"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "../../components/auth/AuthProvider";
import { useFulfillment } from "../../components/fulfillment/FulfillmentProvider";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import {
  ArrowRightIcon,
  CheckIcon,
  ShoppingBagIcon,
  UtensilsIcon,
} from "../../components/ui/Icons";
import { getRestaurantTables } from "../../lib/api/fulfillment";
import type { OrderType, RestaurantTable } from "../../types/fulfillment";
import styles from "./start-order.module.css";

function StartOrderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { selection, setSelection } = useFulfillment();
  const [manualOrderType, setOrderType] = useState<OrderType | null>(selection?.orderType ?? null);
  const orderType = manualOrderType ?? selection?.orderType ?? user?.default_order_type ?? null;
  const [tableId, setTableId] = useState<number | null>(selection?.restaurantTableId ?? null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getRestaurantTables()
      .then(setTables)
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : "Unable to load dining tables.")
      )
      .finally(() => setLoading(false));
  }, []);

  const selectedTable =
    tables.find((table) => table.id === tableId && table.is_available) ?? null;

  function continueToMenu() {
    if (orderType === null) {
      setError("Please select either Dine In or Take Out to continue.");
      return;
    }
    if (orderType === "dine_in" && selectedTable === null) {
      setError("Please select an available dining table for table service.");
      return;
    }
    setSelection(
      orderType === "dine_in"
        ? {
            orderType,
            fulfillmentType: "table_service",
            restaurantTableId: selectedTable!.id,
            tableNumber: selectedTable!.table_number,
          }
        : {
            orderType,
            fulfillmentType: "counter_pickup",
            restaurantTableId: null,
            tableNumber: null,
          }
    );
    const nextPath = searchParams.get("next");
    router.push(nextPath === "/checkout" || nextPath === "/payment" ? nextPath : "/menu");
  }

  const nextPath = searchParams.get("next");
  const continuesToCheckout = nextPath === "/checkout" || nextPath === "/payment";
  const continueLabel =
    nextPath === "/payment" ? "Continue to Payment" : "Continue to Checkout";

  return (
    <div className={styles.page}>
      <Header />
      <main id="main-content" className={styles.content} aria-labelledby="start-order-title">
        <header>
          <p>Dining Preference</p>
          <h1 id="start-order-title">How Will You Dine Today?</h1>
          <span>
            {continuesToCheckout
              ? "Choose your service details before completing checkout."
              : "Choose whether you are dining with us in our dining room or taking your order to go."}
          </span>
        </header>

        <section className={styles.card} aria-label="Dining service options">
          <fieldset>
            <legend>Select Dining Mode</legend>
            <label className={orderType === "takeout" ? styles.selected : undefined}>
              <input
                type="radio"
                name="dining-mode"
                checked={orderType === "takeout"}
                onChange={() => {
                  setOrderType("takeout");
                  setTableId(null);
                  setError("");
                }}
              />
              <b style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <ShoppingBagIcon size={18} />
                <span>Take Out · Counter Pickup</span>
              </b>
              <small>Your dishes will be carefully packed fresh and ready for pickup at our counter.</small>
            </label>

            <label className={orderType === "dine_in" ? styles.selected : undefined}>
              <input
                type="radio"
                name="dining-mode"
                checked={orderType === "dine_in"}
                onChange={() => {
                  setOrderType("dine_in");
                  setTableId(null);
                  setError("");
                }}
              />
              <b style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <UtensilsIcon size={18} />
                <span>Dine In · Table Service</span>
              </b>
              <small>Relax at your table. Our kitchen staff will bring your freshly cooked dishes to you.</small>
            </label>
          </fieldset>

          {orderType === "dine_in" ? (
            <fieldset>
              <legend>Choose Your Table</legend>
              {loading ? (
                <p>Checking table availability...</p>
              ) : (
                <div className={styles.tables} role="group" aria-label="Available restaurant tables">
                  {tables.map((table) => (
                    <button
                      type="button"
                      key={table.id}
                      disabled={!table.is_available}
                      className={tableId === table.id ? styles.tableSelected : undefined}
                      onClick={() => {
                        setTableId(table.id);
                        setError("");
                      }}
                      aria-pressed={tableId === table.id}
                    >
                      {table.table_number}
                      <small>{table.is_available ? `${table.seats} seats · Free` : "Occupied"}</small>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          ) : orderType === "takeout" ? (
            <p className={styles.pickup}>
              <CheckIcon size={16} style={{ display: "inline", marginRight: "6px", verticalAlign: "-2px" }} />
              <span>Your order will be assigned a pickup order reference and prepared for counter collection.</span>
            </p>
          ) : (
            <p className={styles.pickup}>
              Please select a dining mode above to view service options.
            </p>
          )}

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className={styles.continue}
            onClick={continueToMenu}
            disabled={orderType === null}
          >
            <span>{continuesToCheckout ? continueLabel : "Browse Menu Dishes"}</span>
            <ArrowRightIcon size={14} style={{ display: "inline", marginLeft: "6px" }} />
          </button>

          <Link href="/cart">Return to your cart</Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default function StartOrderPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <Header />
          <main id="main-content" className={styles.content}>
            <p>Loading service options...</p>
          </main>
          <Footer />
        </div>
      }
    >
      <StartOrderContent />
    </Suspense>
  );
}
