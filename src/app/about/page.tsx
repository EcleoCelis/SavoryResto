import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { RESTAURANT_INFO } from "../../config/restaurant";
import styles from "../informational.module.css";

export const metadata: Metadata = {
  title: `About Us — Our Story & Food Philosophy | ${RESTAURANT_INFO.name}`,
  description:
    "Learn about SavoryBites, our kitchen philosophy, and our dedication to fresh ingredients, honest cooking, and welcoming dining in Buenavista, Bohol.",
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <Header />

      <main id="main-content" className={styles.mainContent}>
        {/* Hero Section */}
        <section className={styles.hero} aria-labelledby="about-hero-title">
          <div className={styles.heroContent}>
            <p className={styles.kicker}>Our Story & Kitchen</p>
            <h1 id="about-hero-title" className={styles.title}>
              Good Food Made for Everyday Moments
            </h1>
            <p className={styles.subtitle}>
              At {RESTAURANT_INFO.name}, we believe honest cooking begins with fresh
              ingredients, prepared with care and served in a warm, welcoming
              atmosphere.
            </p>
          </div>
        </section>

        {/* Content Container */}
        <div className={styles.container}>
          <div className={styles.contentWrap}>
            {/* Our Story Card */}
            <article className={styles.card} aria-labelledby="story-title">
              <header className={styles.cardHeader}>
                <p className={styles.kicker}>Our Journey</p>
                <h2 id="story-title" className={styles.cardTitle}>
                  A place where good food meets good days
                </h2>
              </header>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", color: "#374151", fontSize: "15px", lineHeight: "1.75" }}>
                <p>
                  {RESTAURANT_INFO.name} was created around a simple, enduring idea:
                  dining out should feel comforting, flavorful, and effortless.
                  Whether you are dropping in for a quick lunch, gathering with family
                  for an evening meal, or picking up a warm order to share at home, our
                  kitchen strives to make every visit memorable.
                </p>
                <p>
                  Located in the heart of {RESTAURANT_INFO.locality}, we welcome neighbors
                  and visitors alike with dishes crafted to highlight familiar flavors,
                  hearty portions, and dependable quality.
                </p>
              </div>
            </article>

            {/* Our Values Block */}
            <section aria-labelledby="values-title" style={{ marginBottom: "40px" }}>
              <div style={{ textAlign: "center", marginBottom: "28px" }}>
                <p className={styles.kicker}>What Guides Us</p>
                <h2 id="values-title" style={{ fontFamily: "Georgia, serif", fontSize: "28px", color: "var(--green)", margin: 0 }}>
                  Our Core Commitments
                </h2>
              </div>

              <div className={styles.gridThreeCol}>
                <div className={styles.valueCard}>
                  <div className={styles.valueIcon} aria-hidden="true">
                    🥬
                  </div>
                  <h3 className={styles.valueTitle}>Fresh Ingredients</h3>
                  <p className={styles.valueDescription}>
                    Every recipe begins with quality ingredients selected to deliver
                    vibrant flavor and wholesome goodness in every bite.
                  </p>
                </div>

                <div className={styles.valueCard}>
                  <div className={styles.valueIcon} aria-hidden="true">
                    👨‍🍳
                  </div>
                  <h3 className={styles.valueTitle}>Made by Real Cooks</h3>
                  <p className={styles.valueDescription}>
                    Our kitchen crew cooks each plate to order, balancing traditional
                    techniques with consistent precision and pride.
                  </p>
                </div>

                <div className={styles.valueCard}>
                  <div className={styles.valueIcon} aria-hidden="true">
                    🍽️
                  </div>
                  <h3 className={styles.valueTitle}>Ready for Your Table</h3>
                  <p className={styles.valueDescription}>
                    Whether seated in our dining room or packing a takeout meal, we
                    ensure your food arrives hot, fresh, and promptly prepared.
                  </p>
                </div>
              </div>
            </section>

            {/* Food Philosophy & Experience */}
            <div className={styles.gridTwoCol}>
              <article className={styles.card} aria-labelledby="philosophy-title" style={{ marginBottom: 0 }}>
                <header className={styles.cardHeader}>
                  <p className={styles.kicker}>Kitchen Standards</p>
                  <h2 id="philosophy-title" className={styles.cardTitle}>
                    Our Food Philosophy
                  </h2>
                </header>
                <p className={styles.cardText} style={{ marginBottom: "16px" }}>
                  We believe in uncomplicated cooking that lets ingredients shine. We
                  avoid unnecessary fillers, prepare seasonings in-house, and uphold
                  rigorous food safety standards from prep table to plate.
                </p>
                <p className={styles.cardText}>
                  Our menu is thoughtfully balanced to offer beloved comfort staples,
                  satisfying entrees, and refreshing sides designed for everyday
                  enjoyment.
                </p>
              </article>

              <article className={styles.card} aria-labelledby="experience-title" style={{ marginBottom: 0 }}>
                <header className={styles.cardHeader}>
                  <p className={styles.kicker}>Dining Options</p>
                  <h2 id="experience-title" className={styles.cardTitle}>
                    The SavoryBites Experience
                  </h2>
                </header>
                <p className={styles.cardText} style={{ marginBottom: "16px" }}>
                  <strong>Dine-In Table Service:</strong> Browse our digital menu,
                  take a seat at any numbered table, and place your order directly. Our
                  team brings freshly cooked meals straight to your table.
                </p>
                <p className={styles.cardText}>
                  <strong>Takeout Counter Pickup:</strong> Short on time? Order online
                  ahead of your arrival, and your order will be packaged fresh and
                  ready at our pickup counter when you step in.
                </p>
              </article>
            </div>

            {/* Call to Action Banner */}
            <section className={styles.ctaBanner} aria-label="Explore menu call to action">
              <h2>Taste the Difference Today</h2>
              <p>
                Explore our full selection of freshly prepared entrees, signature
                dishes, and refreshing beverages.
              </p>
              <div className={styles.ctaActions}>
                <Link href="/menu" className={styles.primaryButton}>
                  Browse Full Menu
                </Link>
                <Link href="/hours" className={styles.outlineButton} style={{ borderColor: "#c49a4a", color: "#f4be37" }}>
                  View Operating Hours
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
