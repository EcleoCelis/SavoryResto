"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "../../lib/api/auth";
import { ArrowLeftIcon, CheckIcon } from "../../components/ui/Icons";
import styles from "./forgot-password.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const validate = (): boolean => {
    setEmailError("");
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError("Please enter your email address.");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError("");

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await requestPasswordReset({ email: email.trim().toLowerCase() });
      setIsSubmitted(true);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while processing your request. Please try again.";
      setServerError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setIsSubmitted(false);
    setEmail("");
    setEmailError("");
    setServerError("");
  };

  return (
    <main id="main-content" className={styles.page}>
      <div className={styles.backgroundDecoration} aria-hidden="true">
        <span className={styles.decorationCircleOne} />
        <span className={styles.decorationCircleTwo} />
      </div>

      <div className={styles.container}>
        <div className={styles.brand}>
          <Link href="/" className={styles.brandLink} aria-label="SavoryBites home">
            <span className={styles.brandMark} aria-hidden="true">
              S
            </span>
            <span className={styles.brandText}>
              <span className={styles.brandName}>SavoryBites</span>
              <span className={styles.brandTagline}>
                Freshly made. Simply delicious.
              </span>
            </span>
          </Link>
        </div>

        <section className={styles.card} aria-labelledby="recovery-title">
          {!isSubmitted ? (
            <>
              <div className={styles.cardHeader}>
                <p className={styles.eyebrow}>Account Recovery</p>
                <h1 id="recovery-title" className={styles.title}>
                  Forgot your password?
                </h1>
                <p className={styles.description}>
                  Enter the email address registered with your SavoryBites account
                  and we will send you a link to reset your password.
                </p>
              </div>

              {serverError && (
                <div className={styles.alertError} role="alert">
                  <span>{serverError}</span>
                </div>
              )}

              <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <div className={styles.field}>
                  <label htmlFor="recovery-email" className={styles.label}>
                    Email Address
                  </label>
                  <input
                    id="recovery-email"
                    type="email"
                    autoComplete="email"
                    placeholder="e.g. maria@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError("");
                    }}
                    className={`${styles.input} ${emailError ? styles.inputError : ""}`}
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? "email-error" : undefined}
                    disabled={isSubmitting}
                  />
                  {emailError && (
                    <p id="email-error" className={styles.errorMessage} role="alert">
                      {emailError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <span className={styles.spinner} aria-hidden="true" />
                      <span>Sending instructions...</span>
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </button>
              </form>

              <div className={styles.cardFooter}>
                <Link href="/login" className={styles.footerLink} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <ArrowLeftIcon size={14} /> Back to Sign In
                </Link>
              </div>
            </>
          ) : (
            <div className={styles.alertSuccess} role="status" aria-live="polite">
              <div className={styles.successIcon} aria-hidden="true">
                <CheckIcon size={24} />
              </div>
              <h1 id="recovery-title" className={styles.successTitle}>
                Check your email
              </h1>
              <p className={styles.successText}>
                We&apos;ve received your request. If an account exists for that email
                address, you&apos;ll receive instructions to reset your password shortly.
              </p>

              <div className={styles.noteBox}>
                <strong>Security Notice:</strong> The password reset link will expire
                in 30 minutes. If you do not see the email, please check your spam or
                junk folder.
              </div>

              <Link href="/login" className={styles.submitButton}>
                Return to Sign In
              </Link>

              <button
                type="button"
                onClick={handleReset}
                className={styles.secondaryButton}
              >
                Try a different email address
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
