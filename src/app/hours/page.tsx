"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { useRestaurantSettings } from "../../components/settings/RestaurantSettingsProvider";
import { RESTAURANT_INFO } from "../../config/restaurant";
import { ArrowRightIcon } from "../../components/ui/Icons";
import styles from "../informational.module.css";

function formatHhmmTo12h(hhmm: string): string {
  const [hhRaw, mmRaw] = hhmm.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return hhmm;
  const suffix = hh >= 12 ? "PM" : "AM";
  const hr12 = hh % 12 || 12;
  return `${hr12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

function getManilaWeekday(tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "Asia/Manila",
    weekday: "long",
  }).format(new Date());
}

function getManilaTimeString(tz: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
  return `${formatted} PHT`;
}

export default function HoursPage() {
  const { settings } = useRestaurantSettings();
  const [, setTick] = useState(0);
  const currentTimeString = getManilaTimeString(settings.restaurant.timezone);
  const todayName = getManilaWeekday(settings.restaurant.timezone);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const isOpen = settings.is_currently_open;

  return (
    <div className={styles.page}>
      <Header />

      <main id="main-content" className={styles.mainContent}>
        {/* Hero Section */}
        <section className={styles.hero} aria-labelledby="hours-hero-title">
          <div className={styles.heroContent}>
            <p className={styles.kicker}>Schedule & Availability</p>
            <h1 id="hours-hero-title" className={styles.title}>
              Restaurant Operating Hours
            </h1>
            <p className={styles.subtitle}>
              We welcome you for freshly prepared dine-in table
              service and quick counter pickup in {settings.restaurant.locality}.
            </p>
          </div>
        </section>

        {/* Content Container */}
        <div className={styles.container}>
          <div className={styles.contentWrap}>
            {/* Live Status Indicator Card */}
            <div
              style={{
                maxWidth: "760px",
                margin: "0 auto 32px",
                background: isOpen ? "#edf7f0" : "#fef6f6",
                border: `1px solid ${isOpen ? "#bfe3cb" : "#fcd4d4"}`,
                borderRadius: "14px",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "14px",
              }}
              role="status"
              aria-live="polite"
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    background: isOpen ? "#2e6b5b" : "#c53030",
                    display: "inline-block",
                  }}
                  aria-hidden="true"
                />
                <div>
                  <strong
                    style={{
                      display: "block",
                      fontSize: "16px",
                      color: isOpen ? "#1b4d3e" : "#9b2c2c",
                    }}
                  >
                    {settings.operating_status_text}
                  </strong>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    Current time: {currentTimeString}
                  </span>
                </div>
              </div>

              <div>
                <Link
                  href="/menu"
                  className={styles.primaryButton}
                  style={{ padding: "10px 20px", fontSize: "12px" }}
                >
                  Order Online Now
                </Link>
              </div>
            </div>

            {/* Weekly Schedule Table Card */}
            <div className={styles.card} style={{ maxWidth: "760px", margin: "0 auto 32px" }}>
              <header className={styles.cardHeader} style={{ textAlign: "center" }}>
                <p className={styles.kicker}>Weekly Schedule</p>
                <h2 className={styles.cardTitle}>Standard Service Hours</h2>
                <p className={styles.cardText}>
                  All times shown in {RESTAURANT_INFO.timeZoneLabel}.
                </p>
              </header>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    textAlign: "left",
                    fontSize: "15px",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--border)", color: "var(--green)" }}>
                      <th style={{ padding: "14px 12px", fontWeight: "700" }}>Day</th>
                      <th style={{ padding: "14px 12px", fontWeight: "700" }}>Opening Time</th>
                      <th style={{ padding: "14px 12px", fontWeight: "700" }}>Closing Time</th>
                      <th style={{ padding: "14px 12px", fontWeight: "700", textAlign: "right" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.hours.map((item) => {
                      const isToday = item.day_name === todayName;
                      return (
                        <tr
                          key={item.day_of_week}
                          style={{
                            borderBottom: "1px solid #f0ecdf",
                            background: isToday ? "rgba(244, 190, 55, 0.08)" : "transparent",
                            fontWeight: isToday ? "700" : "normal",
                          }}
                        >
                          <td style={{ padding: "14px 12px", color: isToday ? "var(--green)" : "#2d3748" }}>
                            {item.day_name}
                            {isToday && (
                              <span
                                style={{
                                  marginLeft: "8px",
                                  fontSize: "11px",
                                  background: "#f4be37",
                                  color: "#1f2b1e",
                                  padding: "2px 7px",
                                  borderRadius: "999px",
                                  fontWeight: "800",
                                  textTransform: "uppercase",
                                }}
                              >
                                Today
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "14px 12px", color: "#4a5568" }}>
                            {item.is_open ? formatHhmmTo12h(item.open_time) : "—"}
                          </td>
                          <td style={{ padding: "14px 12px", color: "#4a5568" }}>
                            {item.is_open ? formatHhmmTo12h(item.close_time) : "—"}
                          </td>
                          <td style={{ padding: "14px 12px", textAlign: "right" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 10px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                background: item.is_open ? "#def7ec" : "#fde8e8",
                                color: item.is_open ? "#03543f" : "#9b1c1c",
                              }}
                            >
                              {item.is_open ? "Open" : "Closed"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Service & Holiday Notices */}
              <div
                style={{
                  marginTop: "24px",
                  padding: "16px 20px",
                  background: "#fdfbf7",
                  border: "1px solid var(--border-light)",
                  borderRadius: "10px",
                  fontSize: "13px",
                  lineHeight: "1.6",
                  color: "#64748b",
                }}
              >
                <p style={{ margin: "0 0 8px" }}>
                  <strong>🍽️ Kitchen Cut-off:</strong> {settings.restaurant.kitchen_notice}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>📅 Holiday Schedules:</strong> {settings.restaurant.holiday_notice}
                </p>
              </div>
            </div>

            {/* Quick Navigation Cards */}
            <div className={styles.gridTwoCol} style={{ maxWidth: "760px", margin: "0 auto" }}>
              <div className={styles.card} style={{ marginBottom: 0 }}>
                <header className={styles.cardHeader}>
                  <p className={styles.kicker}>Location Details</p>
                  <h3 className={styles.cardTitle} style={{ fontSize: "20px" }}>
                    How to Find Us
                  </h3>
                </header>
                <p className={styles.cardText} style={{ marginBottom: "16px" }}>
                  Located conveniently in {settings.restaurant.locality}. View parking tips,
                  landmarks, and an interactive directions map.
                </p>
                <Link
                  href="/location"
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
                  View Location & Directions <ArrowRightIcon size={12} />
                </Link>
              </div>

              <div className={styles.card} style={{ marginBottom: 0 }}>
                <header className={styles.cardHeader}>
                  <p className={styles.kicker}>Order Ahead</p>
                  <h3 className={styles.cardTitle} style={{ fontSize: "20px" }}>
                    Counter Pickup
                  </h3>
                </header>
                <p className={styles.cardText} style={{ marginBottom: "16px" }}>
                  Save waiting time by submitting your order online. We prepare your
                  dishes fresh right as you arrive.
                </p>
                <Link
                  href="/start-order"
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
                  Start Your Order <ArrowRightIcon size={12} />
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
