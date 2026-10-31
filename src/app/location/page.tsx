import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { RESTAURANT_INFO } from "../../config/restaurant";
import { ArrowRightIcon } from "../../components/ui/Icons";
import styles from "../informational.module.css";

export const metadata: Metadata = {
  title: `Restaurant Location & Directions | ${RESTAURANT_INFO.name}`,
  description: `Visit ${RESTAURANT_INFO.name} in ${RESTAURANT_INFO.fullAddress}. View driving directions, public transit tips, parking, and restaurant contact information.`,
};

export default function LocationPage() {
  const encodedAddress = encodeURIComponent(
    `${RESTAURANT_INFO.name}, ${RESTAURANT_INFO.fullAddress}`
  );
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  const openStreetMapUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent("Buenavista, Bohol, Philippines")}`;

  return (
    <div className={styles.page}>
      <Header />

      <main id="main-content" className={styles.mainContent}>
        {/* Hero Section */}
        <section className={styles.hero} aria-labelledby="location-hero-title">
          <div className={styles.heroContent}>
            <p className={styles.kicker}>Visit Us</p>
            <h1 id="location-hero-title" className={styles.title}>
              Location & Directions
            </h1>
            <p className={styles.subtitle}>
              Conveniently situated in {RESTAURANT_INFO.locality}, welcoming you for
              comfortable dining table service and quick takeout counter pickup.
            </p>
          </div>
        </section>

        {/* Content Container */}
        <div className={styles.container}>
          <div className={styles.contentWrap}>
            <div className={styles.gridTwoCol}>
              {/* Left Column: Address, Contact & Directions */}
              <div>
                <section className={styles.card} aria-labelledby="address-card-title">
                  <header className={styles.cardHeader}>
                    <p className={styles.kicker}>Restaurant Address</p>
                    <h2 id="address-card-title" className={styles.cardTitle}>
                      {RESTAURANT_INFO.name} Dining Room
                    </h2>
                    <p className={styles.cardText}>
                      We are located in the central town district of Buenavista,
                      accessible from main town thoroughfares.
                    </p>
                  </header>

                  <div
                    style={{
                      background: "#fdfbf7",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      padding: "20px",
                      marginTop: "18px",
                    }}
                  >
                    <strong
                      style={{
                        display: "block",
                        fontSize: "16px",
                        color: "var(--green)",
                        marginBottom: "6px",
                        fontFamily: "Georgia, serif",
                      }}
                    >
                      Physical Address
                    </strong>
                    <p
                      style={{
                        margin: 0,
                        color: "#2d3748",
                        fontSize: "15px",
                        lineHeight: "1.6",
                      }}
                    >
                      {RESTAURANT_INFO.fullAddress}
                    </p>

                    <div style={{ marginTop: "14px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.primaryButton}
                        style={{ padding: "9px 18px", fontSize: "12px" }}
                      >
                        Open in Google Maps ↗
                      </a>
                      <a
                        href={openStreetMapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.outlineButton}
                        style={{ padding: "8px 16px", fontSize: "12px" }}
                      >
                        OpenStreetMap ↗
                      </a>
                    </div>
                  </div>

                  {/* Contact Summary */}
                  <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div>
                      <strong style={{ color: "var(--green)", fontSize: "13px", display: "block" }}>
                        Telephone Inquiries:
                      </strong>
                      <a
                        href={`tel:${RESTAURANT_INFO.phone.replace(/[\s-]/g, "")}`}
                        style={{ color: "#4a5568", fontSize: "14px", textDecoration: "none" }}
                      >
                        {RESTAURANT_INFO.phone}
                      </a>
                    </div>

                    <div>
                      <strong style={{ color: "var(--green)", fontSize: "13px", display: "block" }}>
                        Email Contact:
                      </strong>
                      <a
                        href={`mailto:${RESTAURANT_INFO.email}`}
                        style={{ color: "#4a5568", fontSize: "14px", textDecoration: "none" }}
                      >
                        {RESTAURANT_INFO.email}
                      </a>
                    </div>
                  </div>
                </section>

                {/* Operating Schedule Link Card */}
                <div
                  style={{
                    background: "#edf4ef",
                    border: "1px solid #c9dec0",
                    borderRadius: "12px",
                    padding: "20px",
                  }}
                >
                  <strong
                    style={{
                      display: "block",
                      color: "var(--green)",
                      fontSize: "15px",
                      marginBottom: "6px",
                    }}
                  >
                    Standard Operating Hours
                  </strong>
                  <p style={{ color: "#374151", fontSize: "13px", lineHeight: "1.5", margin: "0 0 10px" }}>
                    Sunday – Thursday: 10:00 AM – 9:00 PM<br />
                    Friday – Saturday: 10:00 AM – 10:00 PM
                  </p>
                  <Link
                    href="/hours"
                    style={{
                      color: "var(--green)",
                      fontWeight: "700",
                      fontSize: "13px",
                      textDecoration: "underline",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    View holiday notices & live status <ArrowRightIcon size={12} />
                  </Link>
                </div>
              </div>

              {/* Right Column: Arrival Guidelines & Map Card */}
              <div>
                <section className={styles.card} aria-labelledby="arrival-tips-title">
                  <header className={styles.cardHeader}>
                    <p className={styles.kicker}>Travel & Parking</p>
                    <h2 id="arrival-tips-title" className={styles.cardTitle}>
                      Getting Here
                    </h2>
                  </header>

                  <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                    <div>
                      <h3 style={{ fontSize: "16px", color: "var(--green)", margin: "0 0 6px" }}>
                        🚗 By Private Vehicle & Motorcycle
                      </h3>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px", lineHeight: "1.6" }}>
                        Street and storefront parking are available along the town
                        proper. Designated motorcycle parking slots are situated
                        immediately adjacent to our front entrance.
                      </p>
                    </div>

                    <div>
                      <h3 style={{ fontSize: "16px", color: "var(--green)", margin: "0 0 6px" }}>
                        🛵 Public Tricycle & Transit
                      </h3>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px", lineHeight: "1.6" }}>
                        Ask any local tricycle or habal-habal driver to take you to
                        SavoryBites in Poblacion, Buenavista. We are situated within
                        easy walking distance from the municipal hall and town plaza.
                      </p>
                    </div>

                    <div>
                      <h3 style={{ fontSize: "16px", color: "var(--green)", margin: "0 0 6px" }}>
                        ♿ Dining Room Accessibility
                      </h3>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px", lineHeight: "1.6" }}>
                        Our dining entrance features ground-level, step-free access
                        to accommodate guests with strollers or mobility devices.
                      </p>
                    </div>
                  </div>

                  {/* Visual Map Fallback Card */}
                  <div
                    style={{
                      marginTop: "24px",
                      background: "#f4f1e8",
                      border: "1px dashed #d5cebf",
                      borderRadius: "12px",
                      padding: "24px 20px",
                      textAlign: "center",
                    }}
                  >
                    <span style={{ fontSize: "32px", display: "block", marginBottom: "8px" }} aria-hidden="true">
                      🗺️
                    </span>
                    <strong style={{ display: "block", color: "var(--green)", fontSize: "15px", marginBottom: "6px" }}>
                      Buenavista, Bohol Branch
                    </strong>
                    <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 16px", lineHeight: "1.5" }}>
                      Tap below for real-time turn-by-turn navigation on your mobile
                      device or desktop browser.
                    </p>
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.outlineButton}
                      style={{ fontSize: "12px", padding: "10px 20px" }}
                    >
                      Get Directions on Google Maps ↗
                    </a>
                  </div>
                </section>
              </div>
            </div>

            {/* Bottom Call to Action */}
            <section className={styles.ctaBanner} aria-label="Visit call to action">
              <h2>Join Us for Your Next Meal</h2>
              <p>
                Browse our menu ahead of time and order for dine-in table service or
                quick counter pickup.
              </p>
              <div className={styles.ctaActions}>
                <Link href="/menu" className={styles.primaryButton}>
                  Explore Menu
                </Link>
                <Link href="/contact" className={styles.outlineButton} style={{ borderColor: "#c49a4a", color: "#f4be37" }}>
                  Contact Us
                </Link>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
