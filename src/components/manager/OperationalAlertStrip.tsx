"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getManagerOperationalAlerts } from "../../lib/api/staff";
import type { OperationalAlertsResponse } from "../../types/staff";
import styles from "./operational-alert-strip.module.css";

function isValidAlerts(res: OperationalAlertsResponse | null): res is OperationalAlertsResponse {
  if (!res) return false;
  return (
    Number.isFinite(res.ready_orders_count) &&
    res.ready_orders_count >= 0 &&
    Number.isFinite(res.pending_orders_count) &&
    res.pending_orders_count >= 0 &&
    Number.isFinite(res.low_stock_count) &&
    res.low_stock_count >= 0 &&
    Number.isFinite(res.out_of_stock_count) &&
    res.out_of_stock_count >= 0 &&
    Array.isArray(res.low_stock_names)
  );
}

type FetchState = {
  settled: boolean;
  data: OperationalAlertsResponse | null;
  error: string | null;
};

type OperationalAlertStripProps = {
  refreshNonce?: number;
};

export default function OperationalAlertStrip({
  refreshNonce = 0,
}: OperationalAlertStripProps) {
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [fetchState, setFetchState] = useState<FetchState>({
    settled: false,
    data: null,
    error: null,
  });

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;

    getManagerOperationalAlerts(controller.signal)
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setFetchState({ settled: true, data: res, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (seq !== requestSeqRef.current) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Unable to load operational alerts.";
        setFetchState({ settled: true, data: null, error: message });
      });

    return () => controller.abort();
  }, [retryNonce, refreshNonce]);

  const loading = !fetchState.settled;
  const error = fetchState.error;
  const validAlerts = useMemo(
    () => (isValidAlerts(fetchState.data) ? fetchState.data : null),
    [fetchState.data]
  );

  const totalInventoryAlerts = validAlerts
    ? validAlerts.out_of_stock_count + validAlerts.low_stock_count
    : 0;
  const hasActionableAlerts = Boolean(
    validAlerts &&
      (validAlerts.ready_orders_count > 0 ||
        validAlerts.pending_orders_count > 0 ||
        totalInventoryAlerts > 0)
  );

  const handleRetry = () => {
    setFetchState({ settled: false, data: null, error: null });
    setRetryNonce((n) => n + 1);
  };

  if (loading) {
    return (
      <div className={styles.strip} role="status" aria-label="Checking operational alerts">
        <span className={styles.skeletonBar} />
      </div>
    );
  }

  if (error || !validAlerts) {
    return (
      <div className={`${styles.strip} ${styles.stripError}`} role="alert">
        <p className={styles.errorText}>
          {error ? `Operational alerts unavailable: ${error}` : "Operational alert data unavailable."}
        </p>
        <button type="button" className={styles.retryBtn} onClick={handleRetry}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <section
      className={`${styles.strip} ${hasActionableAlerts ? styles.stripAlertActive : ""}`}
      aria-label="Operational alerts"
    >
      <div className={styles.items}>
        {!hasActionableAlerts ? (
          <span className={styles.clearStatus}>
            <span className={styles.clearDot} aria-hidden="true" />
            Operations clear — no pending handoffs or low-stock ingredients
          </span>
        ) : (
          <>
            {validAlerts.ready_orders_count > 0 && (
              <Link href="/manager/orders?status=ready" className={`${styles.alertLink} ${styles.alertReady}`}>
                <span className={styles.dot} aria-hidden="true" />
                <span>
                  {validAlerts.ready_orders_count}{" "}
                  {validAlerts.ready_orders_count === 1
                    ? "order ready for handoff"
                    : "orders ready for handoff"}
                </span>
              </Link>
            )}

            {validAlerts.pending_orders_count > 0 && (
              <Link href="/manager/orders?status=pending" className={`${styles.alertLink} ${styles.alertPending}`}>
                <span className={styles.dot} aria-hidden="true" />
                <span>
                  {validAlerts.pending_orders_count}{" "}
                  {validAlerts.pending_orders_count === 1
                    ? "pending order awaiting confirmation"
                    : "pending orders awaiting confirmation"}
                </span>
              </Link>
            )}

            {totalInventoryAlerts > 0 && (
              <Link href="/manager/menu" className={`${styles.alertLink} ${styles.alertInventory}`}>
                <span className={styles.dot} aria-hidden="true" />
                <span>
                  {totalInventoryAlerts}{" "}
                  {totalInventoryAlerts === 1 ? "ingredient needs restock" : "ingredients need restock"}
                  {validAlerts.low_stock_names.length > 0 && (
                    <span className={styles.stockNames}>
                      {" "}
                      ({validAlerts.low_stock_names.join(", ")})
                    </span>
                  )}
                </span>
              </Link>
            )}
          </>
        )}
      </div>

      <div className={styles.quickLinks}>
        <Link href="/manager/orders" className={styles.quickLink}>
          Orders →
        </Link>
        <Link href="/manager/menu" className={styles.quickLink}>
          Menu &amp; Stock →
        </Link>
      </div>
    </section>
  );
}
