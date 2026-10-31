import Link from "next/link";
import { Footer } from "../components/layout/Footer";
import { Header } from "../components/layout/Header";
import styles from "./informational.module.css";

export default function NotFound() {
  return (
    <div className={styles.page}>
      <Header />

      <main id="main-content" className={styles.mainContent}>
        <section className={styles.hero} aria-labelledby="not-found-title">
          <div className={styles.heroContent}>
            <p className={styles.kicker}>404 — Not Found</p>
            <h1 id="not-found-title" className={styles.title}>
              Page Not Found
            </h1>
            <p className={styles.subtitle}>
              We couldn&apos;t locate the page you were looking for. It may have been
              moved, updated, or is no longer available.
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
                padding: "48px 32px",
              }}
            >
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: "#fdf3d8",
                  color: "#c49a4a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "28px",
                  margin: "0 auto 20px",
                }}
                aria-hidden="true"
              >
                🍽️
              </div>

              <h2
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: "24px",
                  color: "var(--green)",
                  margin: "0 0 12px",
                }}
              >
                Let&apos;s get you back on track
              </h2>

              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "15px",
                  lineHeight: "1.6",
                  margin: "0 0 28px",
                }}
              >
                Check the URL address or choose one of the destinations below to continue
                exploring our fresh menu and dining experience.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                <Link href="/" className={styles.primaryButton}>
                  Return to Homepage
                </Link>
                <Link href="/menu" className={styles.outlineButton}>
                  Browse Menu
                </Link>
                <Link href="/contact" className={styles.outlineButton}>
                  Contact Support
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
