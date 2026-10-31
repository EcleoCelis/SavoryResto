"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Footer } from "../components/layout/Footer";
import { Header } from "../components/layout/Header";
import styles from "./informational.module.css";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log unexpected client-side rendering error safely
    console.error("SavoryBites route rendering error:", error);
  }, [error]);

  return (
    <div className={styles.page}>
      <Header />

      <main id="main-content" className={styles.mainContent}>
        <section className={styles.hero} aria-labelledby="error-title">
          <div className={styles.heroContent}>
            <p className={styles.kicker}>Unexpected Error</p>
            <h1 id="error-title" className={styles.title}>
              Something Went Wrong
            </h1>
            <p className={styles.subtitle}>
              We encountered an unexpected issue while loading this page. Our team
              has been notified.
            </p>
          </div>
        </section>

        <div className={styles.container}>
          <div className={styles.contentWrap}>
            <div
              className={styles.card}
              style={{
                maxWidth: "600px",
                margin: "0 auto",
                textAlign: "center",
                padding: "44px 32px",
              }}
              role="alert"
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "#fff5f5",
                  border: "1px solid #fed7d7",
                  color: "#e53e3e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "24px",
                  margin: "0 auto 18px",
                }}
                aria-hidden="true"
              >
                !
              </div>

              <h2
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: "22px",
                  color: "var(--green)",
                  margin: "0 0 10px",
                }}
              >
                Temporary Disruption
              </h2>

              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "14px",
                  lineHeight: "1.6",
                  margin: "0 0 24px",
                }}
              >
                You can try reloading this section, or navigate back to the main
                menu to continue ordering.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => reset()}
                  className={styles.primaryButton}
                >
                  Try Again
                </button>
                <Link href="/" className={styles.outlineButton}>
                  Return Home
                </Link>
                <Link href="/menu" className={styles.outlineButton}>
                  View Menu
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
