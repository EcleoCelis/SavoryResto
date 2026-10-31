"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resetPassword } from "../../lib/api/auth";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, EyeIcon, EyeOffIcon } from "../../components/ui/Icons";
import styles from "./reset-password.module.css";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // If no token is provided in the query string
  if (!token) {
    return (
      <section className={styles.card} aria-labelledby="reset-title">
        <div className={styles.cardHeader}>
          <p className={styles.eyebrow}>Account Recovery</p>
          <h1 id="reset-title" className={styles.title}>
            Invalid Reset Link
          </h1>
          <p className={styles.description}>
            This password reset link is invalid or incomplete. Please request a
            new password recovery link.
          </p>
        </div>

        <Link href="/forgot-password" className={styles.submitButton}>
          Request New Reset Link
        </Link>

        <div className={styles.cardFooter}>
          <Link href="/login" className={styles.footerLink} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <ArrowLeftIcon size={14} /> Back to Sign In
          </Link>
        </div>
      </section>
    );
  }

  const validate = (): boolean => {
    let valid = true;
    setPasswordError("");
    setConfirmError("");

    if (!newPassword) {
      setPasswordError("Please enter a new password.");
      valid = false;
    } else if (newPassword.length < 8) {
      setPasswordError("Your password must be at least 8 characters.");
      valid = false;
    }

    if (!confirmPassword) {
      setConfirmError("Please confirm your new password.");
      valid = false;
    } else if (newPassword !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      valid = false;
    }

    return valid;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError("");

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPassword({
        token,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setIsSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Unable to reset password. The link may have expired or already been used.";
      setServerError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <section className={styles.card} aria-labelledby="reset-success-title">
        <div className={styles.alertSuccess} role="status" aria-live="polite">
          <div className={styles.successIcon} aria-hidden="true">
            <CheckIcon size={24} />
          </div>
          <h1 id="reset-success-title" className={styles.successTitle}>
            Password Reset Complete
          </h1>
          <p className={styles.successText}>
            Your password has been successfully updated. You can now sign in with
            your new credentials.
          </p>
          <Link href="/login" className={styles.submitButton}>
            Sign In Now
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="reset-title">
      <div className={styles.cardHeader}>
        <p className={styles.eyebrow}>Account Recovery</p>
        <h1 id="reset-title" className={styles.title}>
          Set a new password
        </h1>
        <p className={styles.description}>
          Please enter your new password below. It must be at least 8 characters long.
        </p>
      </div>

      {serverError && (
        <div className={styles.alertError} role="alert">
          <strong>Unable to reset password</strong>
          <span>{serverError}</span>
          <Link href="/forgot-password" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            Request a new reset link <ArrowRightIcon size={12} />
          </Link>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="new-password" className={styles.label}>
            New Password
          </label>
          <div className={styles.passwordWrapper}>
            <input
              id="new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              className={`${styles.input} ${passwordError ? styles.inputError : ""}`}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "password-error" : undefined}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide new password" : "Show new password"}
              disabled={isSubmitting}
            >
              {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
          {passwordError && (
            <p id="password-error" className={styles.errorMessage} role="alert">
              {passwordError}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="confirm-password" className={styles.label}>
            Confirm New Password
          </label>
          <div className={styles.passwordWrapper}>
            <input
              id="confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (confirmError) setConfirmError("");
              }}
              className={`${styles.input} ${confirmError ? styles.inputError : ""}`}
              aria-invalid={Boolean(confirmError)}
              aria-describedby={confirmError ? "confirm-error" : undefined}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              aria-label={
                showConfirmPassword
                  ? "Hide confirm password"
                  : "Show confirm password"
              }
              disabled={isSubmitting}
            >
              {showConfirmPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
          {confirmError && (
            <p id="confirm-error" className={styles.errorMessage} role="alert">
              {confirmError}
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
              <span>Updating password...</span>
            </>
          ) : (
            "Reset Password"
          )}
        </button>
      </form>

      <div className={styles.cardFooter}>
        <Link href="/login" className={styles.footerLink} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <ArrowLeftIcon size={14} /> Back to Sign In
        </Link>
      </div>
    </section>
  );
}

export default function ResetPasswordPage() {
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

        <Suspense
          fallback={
            <div className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
              <span className={styles.spinner} style={{ borderColor: "#173f35", borderTopColor: "transparent", margin: "0 auto 16px" }} />
              <p style={{ color: "#6b6b63", fontSize: "14px", margin: 0 }}>
                Loading password recovery...
              </p>
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
