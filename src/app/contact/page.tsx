"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { RESTAURANT_INFO } from "../../config/restaurant";
import { submitContactInquiry } from "../../lib/api/contact";
import { ArrowRightIcon, CheckIcon } from "../../components/ui/Icons";
import styles from "../informational.module.css";

interface ContactFormErrors {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
}

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("General Inquiry");
  const [message, setMessage] = useState("");

  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const validate = (): boolean => {
    const newErrors: ContactFormErrors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName || trimmedName.length < 2) {
      newErrors.name = "Please enter your name (at least 2 characters).";
    }

    if (!trimmedEmail) {
      newErrors.email = "Please enter your email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      newErrors.email = "Please enter a valid email address.";
    }

    if (!trimmedSubject || trimmedSubject.length < 3) {
      newErrors.subject = "Please enter a subject for your inquiry.";
    }

    if (!trimmedMessage || trimmedMessage.length < 10) {
      newErrors.message = "Please enter a detailed message (at least 10 characters).";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError("");

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await submitContactInquiry({
        name,
        email,
        subject,
        message,
      });

      setSuccessMessage(response.message);
      setIsSubmitted(true);
      setName("");
      setEmail("");
      setSubject("General Inquiry");
      setMessage("");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while sending your message. Please try again.";
      setServerError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setIsSubmitted(false);
    setSuccessMessage("");
    setServerError("");
    setErrors({});
  };

  return (
    <div className={styles.page}>
      <Header />

      <main id="main-content" className={styles.mainContent}>
        {/* Hero Section */}
        <section className={styles.hero} aria-labelledby="contact-hero-title">
          <div className={styles.heroContent}>
            <p className={styles.kicker}>Get in Touch</p>
            <h1 id="contact-hero-title" className={styles.title}>
              Contact SavoryBites
            </h1>
            <p className={styles.subtitle}>
              Have a question about our menu, special dietary requests, or your
              dining experience? We are here to help.
            </p>
          </div>
        </section>

        {/* Content Container */}
        <div className={styles.container}>
          <div className={styles.contentWrap}>
            <div className={styles.gridTwoCol}>
              {/* Left Column: Direct Contact Details */}
              <div>
                <section className={styles.card} aria-labelledby="direct-contact-title">
                  <header className={styles.cardHeader}>
                    <p className={styles.kicker}>Restaurant Details</p>
                    <h2 id="direct-contact-title" className={styles.cardTitle}>
                      Reach Us Directly
                    </h2>
                    <p className={styles.cardText}>
                      We welcome your inquiries, feedback, and questions. Reach out
                      through any of the channels below or visit us in person.
                    </p>
                  </header>

                  <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "24px" }}>
                    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "22px", lineHeight: "1" }} aria-hidden="true">
                        📍
                      </span>
                      <div>
                        <strong style={{ display: "block", color: "var(--green)", fontSize: "15px" }}>
                          Our Location
                        </strong>
                        <span style={{ color: "#4a5568", fontSize: "14px", lineHeight: "1.5" }}>
                          {RESTAURANT_INFO.fullAddress}
                        </span>
                        <div style={{ marginTop: "4px" }}>
                          <Link href="/location" style={{ color: "#c49a4a", fontSize: "12px", fontWeight: "700", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            View map & directions <ArrowRightIcon size={12} />
                          </Link>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "22px", lineHeight: "1" }} aria-hidden="true">
                        📞
                      </span>
                      <div>
                        <strong style={{ display: "block", color: "var(--green)", fontSize: "15px" }}>
                          Phone Support
                        </strong>
                        <a
                          href={`tel:${RESTAURANT_INFO.phone.replace(/[\s-]/g, "")}`}
                          style={{ color: "#4a5568", fontSize: "14px", textDecoration: "none" }}
                        >
                          {RESTAURANT_INFO.phone}
                        </a>
                        <small style={{ display: "block", color: "#8a948e", fontSize: "11px", marginTop: "2px" }}>
                          Available during standard operating hours
                        </small>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "22px", lineHeight: "1" }} aria-hidden="true">
                        ✉️
                      </span>
                      <div>
                        <strong style={{ display: "block", color: "var(--green)", fontSize: "15px" }}>
                          Email Inquiries
                        </strong>
                        <a
                          href={`mailto:${RESTAURANT_INFO.email}`}
                          style={{ color: "#4a5568", fontSize: "14px", textDecoration: "none" }}
                        >
                          {RESTAURANT_INFO.email}
                        </a>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "22px", lineHeight: "1" }} aria-hidden="true">
                        ⏰
                      </span>
                      <div>
                        <strong style={{ display: "block", color: "var(--green)", fontSize: "15px" }}>
                          Hours of Operation
                        </strong>
                        <span style={{ color: "#4a5568", fontSize: "14px", lineHeight: "1.5" }}>
                          Sun–Thu: 10:00 AM – 9:00 PM<br />
                          Fri–Sat: 10:00 AM – 10:00 PM
                        </span>
                        <div style={{ marginTop: "4px" }}>
                          <Link href="/hours" style={{ color: "#c49a4a", fontSize: "12px", fontWeight: "700", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            See full schedule & holiday hours <ArrowRightIcon size={12} />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <div style={{ background: "#edf3ee", border: "1px solid #d5e2d8", borderRadius: "12px", padding: "20px", marginTop: "20px" }}>
                  <strong style={{ color: "var(--green)", display: "block", marginBottom: "6px", fontSize: "14px" }}>
                    Looking for quick answers?
                  </strong>
                  <p style={{ color: "#4a5b51", fontSize: "13px", lineHeight: "1.5", margin: "0 0 10px" }}>
                    Find answers regarding ordering, table service, payments, and
                    account management in our FAQ.
                  </p>
                  <Link href="/faq" style={{ color: "var(--green)", fontWeight: "700", fontSize: "13px", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    Visit the FAQ page <ArrowRightIcon size={12} />
                  </Link>
                </div>
              </div>

              {/* Right Column: Contact Inquiry Form */}
              <section className={styles.card} aria-labelledby="form-title">
                {!isSubmitted ? (
                  <>
                    <header className={styles.cardHeader}>
                      <p className={styles.kicker}>Online Message</p>
                      <h2 id="form-title" className={styles.cardTitle}>
                        Send Us a Message
                      </h2>
                      <p className={styles.cardText}>
                        Fill out the form below and our staff will respond to your
                        email as soon as possible.
                      </p>
                    </header>

                    {serverError && (
                      <div
                        role="alert"
                        style={{
                          background: "#fff5f5",
                          border: "1px solid #fed7d7",
                          borderRadius: "8px",
                          padding: "12px 16px",
                          color: "#c53030",
                          fontSize: "13px",
                          marginBottom: "20px",
                        }}
                      >
                        {serverError}
                      </div>
                    )}

                    <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                      <div>
                        <label htmlFor="contact-name" style={{ display: "block", fontSize: "13px", fontWeight: "650", color: "var(--ink)", marginBottom: "6px" }}>
                          Full Name *
                        </label>
                        <input
                          id="contact-name"
                          type="text"
                          required
                          value={name}
                          onChange={(e) => {
                            setName(e.target.value);
                            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                          }}
                          placeholder="e.g. Maria Santos"
                          aria-invalid={Boolean(errors.name)}
                          aria-describedby={errors.name ? "name-error" : undefined}
                          disabled={isSubmitting}
                          style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: "8px",
                            border: `1px solid ${errors.name ? "#e53e3e" : "var(--border)"}`,
                            background: "#ffffff",
                            fontSize: "14px",
                            outline: "none",
                          }}
                        />
                        {errors.name && (
                          <p id="name-error" role="alert" style={{ color: "#e53e3e", fontSize: "12px", margin: "4px 0 0" }}>
                            {errors.name}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="contact-email" style={{ display: "block", fontSize: "13px", fontWeight: "650", color: "var(--ink)", marginBottom: "6px" }}>
                          Email Address *
                        </label>
                        <input
                          id="contact-email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                          }}
                          placeholder="e.g. maria@example.com"
                          aria-invalid={Boolean(errors.email)}
                          aria-describedby={errors.email ? "email-error" : undefined}
                          disabled={isSubmitting}
                          style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: "8px",
                            border: `1px solid ${errors.email ? "#e53e3e" : "var(--border)"}`,
                            background: "#ffffff",
                            fontSize: "14px",
                            outline: "none",
                          }}
                        />
                        {errors.email && (
                          <p id="email-error" role="alert" style={{ color: "#e53e3e", fontSize: "12px", margin: "4px 0 0" }}>
                            {errors.email}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="contact-subject" style={{ display: "block", fontSize: "13px", fontWeight: "650", color: "var(--ink)", marginBottom: "6px" }}>
                          Subject / Inquiry Type *
                        </label>
                        <select
                          id="contact-subject"
                          value={subject}
                          onChange={(e) => {
                            setSubject(e.target.value);
                            if (errors.subject) setErrors((prev) => ({ ...prev, subject: undefined }));
                          }}
                          disabled={isSubmitting}
                          style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: "8px",
                            border: `1px solid ${errors.subject ? "#e53e3e" : "var(--border)"}`,
                            background: "#ffffff",
                            fontSize: "14px",
                            outline: "none",
                          }}
                        >
                          <option value="General Inquiry">General Inquiry</option>
                          <option value="Menu & Dietary Questions">Menu & Dietary Questions</option>
                          <option value="Table Dining & Seating">Table Dining & Seating</option>
                          <option value="Order Feedback">Order Feedback</option>
                          <option value="Other">Other Question</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="contact-message" style={{ display: "block", fontSize: "13px", fontWeight: "650", color: "var(--ink)", marginBottom: "6px" }}>
                          Your Message *
                        </label>
                        <textarea
                          id="contact-message"
                          required
                          rows={5}
                          value={message}
                          onChange={(e) => {
                            setMessage(e.target.value);
                            if (errors.message) setErrors((prev) => ({ ...prev, message: undefined }));
                          }}
                          placeholder="How can we assist you today? Please provide as much detail as possible..."
                          aria-invalid={Boolean(errors.message)}
                          aria-describedby={errors.message ? "message-error" : undefined}
                          disabled={isSubmitting}
                          style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: "8px",
                            border: `1px solid ${errors.message ? "#e53e3e" : "var(--border)"}`,
                            background: "#ffffff",
                            fontSize: "14px",
                            fontFamily: "inherit",
                            lineHeight: "1.5",
                            outline: "none",
                            resize: "vertical",
                          }}
                        />
                        {errors.message && (
                          <p id="message-error" role="alert" style={{ color: "#e53e3e", fontSize: "12px", margin: "4px 0 0" }}>
                            {errors.message}
                          </p>
                        )}
                      </div>

                      <button
                        type="submit"
                        className={styles.primaryButton}
                        disabled={isSubmitting}
                        style={{ marginTop: "6px", width: "100%" }}
                      >
                        {isSubmitting ? "Sending message..." : "Send Message"}
                      </button>
                    </form>
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "20px 10px" }} role="status" aria-live="polite">
                    <div
                      style={{
                        width: "54px",
                        height: "54px",
                        borderRadius: "50%",
                        background: "#e8f3ec",
                        border: "1px solid #b7dcbe",
                        color: "var(--success)",
                        fontSize: "26px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 16px",
                      }}
                      aria-hidden="true"
                    >
                      <CheckIcon size={24} />
                    </div>
                    <h2 style={{ fontFamily: "Georgia, serif", fontSize: "24px", color: "var(--green)", margin: "0 0 10px" }}>
                      Message Received!
                    </h2>
                    <p style={{ color: "#4a5568", fontSize: "14px", lineHeight: "1.6", margin: "0 0 24px" }}>
                      {successMessage || "Thank you for reaching out. We have received your message and will respond to your inquiry soon."}
                    </p>
                    <button
                      type="button"
                      onClick={handleResetForm}
                      className={styles.outlineButton}
                    >
                      Send another message
                    </button>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
