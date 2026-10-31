"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { RESTAURANT_INFO } from "../../config/restaurant";
import styles from "../informational.module.css";

interface FaqItem {
  id: string;
  category: "ordering" | "menu" | "payment" | "account" | "location";
  question: string;
  answer: string | React.ReactNode;
}

const FAQ_DATA: FaqItem[] = [
  // 1. Ordering & Fulfillment
  {
    id: "order-types",
    category: "ordering",
    question: "What order fulfillment options does SavoryBites offer?",
    answer: (
      <>
        We currently support two dining and fulfillment methods:
        <ul style={{ margin: "10px 0 0 20px", padding: 0 }}>
          <li>
            <strong>Dine-In Table Service:</strong> Choose your table number
            inside our dining room, place your order through our website, and
            our staff will deliver your freshly cooked meal directly to your
            table.
          </li>
          <li style={{ marginTop: "6px" }}>
            <strong>Takeout Counter Pickup:</strong> Order online in advance,
            and your food will be packed fresh and ready for pickup at our
            front counter when you arrive.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "delivery-availability",
    category: "ordering",
    question: "Do you offer door-to-door home delivery?",
    answer: (
      <>
        Currently, SavoryBites does <strong>not</strong> offer home delivery
        service. All orders must be fulfilled as either dine-in table service
        or counter pickup at our Buenavista, Bohol location. We have introduced
        saved delivery address management in customer accounts in preparation for
        future delivery services.
      </>
    ),
  },
  {
    id: "table-selection",
    category: "ordering",
    question: "How does table selection work when dining in?",
    answer: (
      <>
        When you arrive at SavoryBites, sit at any available dining table. You
        will find the table number clearly marked on the table card. During
        online checkout, select <em>Table Service</em> and input your table
        number. Our kitchen and service staff will route your order directly to
        you.
      </>
    ),
  },
  {
    id: "order-tracking",
    category: "ordering",
    question: "How can I track the status of my order?",
    answer: (
      <>
        After placing an order, you are automatically directed to your Order
        Confirmation and Live Tracking screen. You can also view all past and
        current orders by visiting the{" "}
        <Link href="/orders" style={{ color: "var(--green)", fontWeight: "700", textDecoration: "underline" }}>
          Orders
        </Link>{" "}
        page while signed in.
      </>
    ),
  },

  // 2. Menu & Customization
  {
    id: "menu-customization",
    category: "menu",
    question: "Can I customize dish sizes or add extras?",
    answer: (
      <>
        Yes! When selecting items from our Menu, you can choose from available
        serving sizes (e.g., Regular, Large) and optional add-ons or toppings
        before adding the item to your cart.
      </>
    ),
  },
  {
    id: "item-availability",
    category: "menu",
    question: "What happens if a menu item runs out of stock?",
    answer: (
      <>
        Our kitchen uses a real-time inventory management system. If an item or
        ingredient is temporarily depleted, the item is marked as unavailable on
        our menu immediately so you won&apos;t be charged for out-of-stock food.
      </>
    ),
  },
  {
    id: "dietary-allergens",
    category: "menu",
    question: "Do you accommodate dietary preferences or allergies?",
    answer: (
      <>
        We prepare our meals fresh. If you have specific allergen concerns or
        dietary restrictions, please message us through our{" "}
        <Link href="/contact" style={{ color: "var(--green)", fontWeight: "700", textDecoration: "underline" }}>
          Contact page
        </Link>{" "}
        prior to your visit, or speak directly with our floor staff when placing
        your order.
      </>
    ),
  },

  // 3. Payments
  {
    id: "payment-options",
    category: "payment",
    question: "What payment methods are accepted?",
    answer: (
      <>
        We accept multiple convenient payment methods including:
        <ul style={{ margin: "8px 0 0 20px", padding: 0 }}>
          <li>Cash at the counter / table upon service</li>
          <li>GCash and popular digital e-wallets</li>
          <li>Major debit and credit cards</li>
        </ul>
        Available payment methods are presented clearly during checkout.
      </>
    ),
  },
  {
    id: "payment-security",
    category: "payment",
    question: "Is online ordering and checkout secure?",
    answer: (
      <>
        Yes. All communication with our servers is encrypted over HTTPS. Customer
        session tokens and sensitive data are protected with modern, industry-standard
        cryptographic measures.
      </>
    ),
  },

  // 4. Customer Account & Security
  {
    id: "account-benefits",
    category: "account",
    question: "Do I need an account to browse the menu or order?",
    answer: (
      <>
        You can browse our entire menu freely without an account. However, creating
        a free customer account allows you to track orders in real time, view your
        complete order history, save delivery addresses, and enjoy faster checkout.
      </>
    ),
  },
  {
    id: "password-recovery",
    category: "account",
    question: "What should I do if I forget my account password?",
    answer: (
      <>
        Visit the{" "}
        <Link href="/forgot-password" style={{ color: "var(--green)", fontWeight: "700", textDecoration: "underline" }}>
          Forgot Password
        </Link>{" "}
        page, enter your registered email address, and we will send you a secure
        password reset link valid for 30 minutes. Once reset, your new password takes
        effect immediately and prior active sessions are securely revoked.
      </>
    ),
  },
  {
    id: "profile-editing",
    category: "account",
    question: "Can I update my contact number or saved addresses?",
    answer: (
      <>
        Yes! Once signed in, navigate to{" "}
        <Link href="/customer" style={{ color: "var(--green)", fontWeight: "700", textDecoration: "underline" }}>
          My Account
        </Link>{" "}
        to edit your full name and phone number, or manage your saved addresses with
        custom labels (Home, Work, Other) and default destination settings.
      </>
    ),
  },

  // 5. Hours & Location
  {
    id: "opening-hours",
    category: "location",
    question: "What are your restaurant opening hours?",
    answer: (
      <>
        We are open seven days a week:
        <br />
        <strong>Sunday – Thursday:</strong> 10:00 AM – 9:00 PM
        <br />
        <strong>Friday – Saturday:</strong> 10:00 AM – 10:00 PM
        <br />
        Please note that our kitchen takes final orders 30 minutes before closing.
        See our{" "}
        <Link href="/hours" style={{ color: "var(--green)", fontWeight: "700", textDecoration: "underline" }}>
          Hours page
        </Link>{" "}
        for holiday announcements.
      </>
    ),
  },
  {
    id: "physical-address",
    category: "location",
    question: "Where is SavoryBites located in Bohol?",
    answer: (
      <>
        SavoryBites is located at {RESTAURANT_INFO.fullAddress}. For driving
        directions, local landmark tips, and parking notes, visit our{" "}
        <Link href="/location" style={{ color: "var(--green)", fontWeight: "700", textDecoration: "underline" }}>
          Location page
        </Link>
        .
      </>
    ),
  },
];

type CategoryKey = "all" | "ordering" | "menu" | "payment" | "account" | "location";

export default function FaqPage() {
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({
    "order-types": true, // open first item by default
  });

  const searchInputId = useId();

  const toggleItem = (id: string) => {
    setOpenItems((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const filteredFaqs = FAQ_DATA.filter((item) => {
    const matchesCategory =
      selectedCategory === "all" || item.category === selectedCategory;
    const matchesSearch =
      searchQuery.trim() === "" ||
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (typeof item.answer === "string" &&
        item.answer.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesCategory && matchesSearch;
  });

  return (
    <div className={styles.page}>
      <Header />

      <main id="main-content" className={styles.mainContent}>
        {/* Hero Section */}
        <section className={styles.hero} aria-labelledby="faq-hero-title">
          <div className={styles.heroContent}>
            <p className={styles.kicker}>Got Questions?</p>
            <h1 id="faq-hero-title" className={styles.title}>
              Frequently Asked Questions
            </h1>
            <p className={styles.subtitle}>
              Find clear, helpful answers regarding our dining experience, order
              types, payment options, and account features.
            </p>
          </div>
        </section>

        {/* Content Container */}
        <div className={styles.container}>
          <div className={styles.contentWrap}>
            {/* Search and Category Filters */}
            <div style={{ marginBottom: "32px" }}>
              <div style={{ maxWidth: "480px", margin: "0 auto 24px" }}>
                <label
                  htmlFor={searchInputId}
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: "700",
                    color: "var(--green)",
                    marginBottom: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Search questions
                </label>
                <input
                  id={searchInputId}
                  type="search"
                  placeholder="e.g. table service, pickup, password, hours..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "13px 18px",
                    borderRadius: "999px",
                    border: "1px solid var(--border)",
                    background: "#ffffff",
                    fontSize: "14px",
                    outline: "none",
                    boxShadow: "0 4px 14px rgba(23,63,53,0.04)",
                  }}
                />
              </div>

              {/* Category Pills */}
              <div
                role="tablist"
                aria-label="Filter FAQ by topic"
                style={{
                  display: "flex",
                  gap: "8px",
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                {[
                  { key: "all", label: "All Topics" },
                  { key: "ordering", label: "Ordering & Pickup" },
                  { key: "menu", label: "Menu & Dietary" },
                  { key: "payment", label: "Payments" },
                  { key: "account", label: "Account & Recovery" },
                  { key: "location", label: "Hours & Location" },
                ].map((tab) => {
                  const isActive = selectedCategory === tab.key;
                  return (
                    <button
                      key={tab.key}
                      role="tab"
                      aria-selected={isActive}
                      type="button"
                      onClick={() => setSelectedCategory(tab.key as CategoryKey)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "999px",
                        fontSize: "13px",
                        fontWeight: "700",
                        cursor: "pointer",
                        border: isActive
                          ? "1px solid var(--green)"
                          : "1px solid var(--border)",
                        background: isActive ? "var(--green)" : "#ffffff",
                        color: isActive ? "#ffffff" : "var(--ink)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Accordion List */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                maxWidth: "800px",
                margin: "0 auto",
              }}
              role="region"
              aria-label="FAQ Accordion"
            >
              {filteredFaqs.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 20px",
                    background: "#ffffff",
                    borderRadius: "12px",
                    border: "1px dashed var(--border)",
                  }}
                >
                  <p style={{ color: "var(--muted)", margin: "0 0 12px", fontSize: "15px" }}>
                    No questions found matching &ldquo;{searchQuery}&rdquo;.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedCategory("all");
                    }}
                    className={styles.outlineButton}
                  >
                    Clear search filters
                  </button>
                </div>
              ) : (
                filteredFaqs.map((faq) => {
                  const isOpen = Boolean(openItems[faq.id]);
                  return (
                    <div
                      key={faq.id}
                      style={{
                        background: "#ffffff",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        overflow: "hidden",
                        transition: "box-shadow 0.15s ease, border-color 0.15s ease",
                        boxShadow: isOpen
                          ? "0 6px 18px rgba(23,63,53,0.05)"
                          : "none",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleItem(faq.id)}
                        aria-expanded={isOpen}
                        aria-controls={`faq-answer-${faq.id}`}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "18px 22px",
                          background: "transparent",
                          border: 0,
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "14px",
                          fontSize: "16px",
                          fontWeight: "700",
                          color: "var(--green)",
                          fontFamily: "Georgia, serif",
                        }}
                      >
                        <span>{faq.question}</span>
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: "18px",
                            transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                            transition: "transform 0.2s ease",
                            color: "#c49a4a",
                            fontWeight: "normal",
                          }}
                        >
                          +
                        </span>
                      </button>

                      {isOpen && (
                        <div
                          id={`faq-answer-${faq.id}`}
                          style={{
                            padding: "0 22px 20px",
                            color: "#4a5568",
                            fontSize: "14px",
                            lineHeight: "1.7",
                            borderTop: "1px solid #f2ede4",
                            paddingTop: "14px",
                          }}
                        >
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Support Callout */}
            <div
              style={{
                marginTop: "48px",
                textAlign: "center",
                background: "#f3ede2",
                border: "1px solid #e2d9cc",
                borderRadius: "14px",
                padding: "32px 24px",
                maxWidth: "800px",
                margin: "48px auto 0",
              }}
            >
              <h3
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: "20px",
                  color: "var(--green)",
                  margin: "0 0 8px",
                }}
              >
                Still have an unanswered question?
              </h3>
              <p
                style={{
                  color: "#5a665e",
                  fontSize: "14px",
                  margin: "0 auto 20px",
                  maxWidth: "500px",
                  lineHeight: "1.6",
                }}
              >
                Our team is always pleased to assist you. Drop us a note via our
                contact form or give our restaurant a call during opening hours.
              </p>
              <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/contact" className={styles.primaryButton}>
                  Contact Customer Support
                </Link>
                <Link href="/hours" className={styles.outlineButton}>
                  Check Hours
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
