"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../components/auth/AuthProvider";
import { AuthApiError } from "../../lib/api/auth";
import { isSafeCustomerNextPath } from "../../lib/rbac";
import { CheckIcon, EyeIcon, EyeOffIcon } from "../../components/ui/Icons";
import styles from "./login.module.css";

type LoginErrors = {
  email?: string;
  password?: string;
  authentication?: string;
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [errors, setErrors] = useState<LoginErrors>({});
  const [successMessage, setSuccessMessage] = useState("");

  const nextPath = isSafeCustomerNextPath(searchParams.get("next"));

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace(nextPath);
    }
  }, [authLoading, isAuthenticated, nextPath, router]);

  const validateForm = (): LoginErrors => {
    const newErrors: LoginErrors = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      newErrors.email = "Please enter your email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      newErrors.email = "Please enter a valid email address.";
    }

    if (!password) {
      newErrors.password = "Please enter your password.";
    } else if (password.length < 8) {
      newErrors.password = "Your password must be at least 8 characters.";
    }

    return newErrors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setErrors({});
    setSuccessMessage("");

    const validationErrors = validateForm();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      await login({
        email: email.trim().toLowerCase(),
        password,
        remember_me: rememberMe,
      });

      setSuccessMessage("Successfully signed in. Redirecting...");

      setTimeout(() => {
        router.replace(nextPath);
      }, 500);
    } catch (error) {
      console.error("Login request failed:", error);
      setErrors({
        authentication:
          error instanceof AuthApiError
            ? error.message
            : "Unable to sign in. Please check your email and password and try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main id="main-content" className={styles.page}>
      <section
        className={styles.loginContainer}
        aria-labelledby="login-title"
      >
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

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <p className={styles.eyebrow}>Customer Account</p>

            <h1 id="login-title" className={styles.title}>
              Welcome back
            </h1>

            <p className={styles.description}>
              Sign in to continue your dining experience with us.
            </p>
          </div>

          {errors.authentication && (
            <div
              className={styles.alertError}
              role="alert"
              aria-live="polite"
            >
              <span className={styles.alertIcon} aria-hidden="true">
                !
              </span>

              <div>
                <strong>Sign in unsuccessful</strong>
                <p>{errors.authentication}</p>
              </div>
            </div>
          )}

          {successMessage && (
            <div
              className={styles.alertSuccess}
              role="status"
              aria-live="polite"
            >
              <span className={styles.alertIcon} aria-hidden="true">
                <CheckIcon size={16} />
              </span>

              <p>{successMessage}</p>
            </div>
          )}

          <form
            className={styles.form}
            onSubmit={handleSubmit}
            noValidate
          >
            <div className={styles.field}>
              <label htmlFor="email" className={styles.label}>
                Email Address
              </label>

              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);

                  if (errors.email) {
                    setErrors((current) => ({
                      ...current,
                      email: undefined,
                    }));
                  }
                }}
                className={`${styles.input} ${
                  errors.email ? styles.inputError : ""
                }`}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "email-error" : undefined}
                disabled={isSubmitting}
              />

              {errors.email && (
                <p id="email-error" className={styles.errorMessage}>
                  {errors.email}
                </p>
              )}
            </div>

            <div className={styles.field}>
              <div className={styles.passwordLabelRow}>
                <label htmlFor="password" className={styles.label}>
                  Password
                </label>

                <Link
                  href="/forgot-password"
                  className={styles.forgotLink}
                >
                  Forgot password?
                </Link>
              </div>

              <div className={styles.passwordWrapper}>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);

                    if (errors.password) {
                      setErrors((current) => ({
                        ...current,
                        password: undefined,
                      }));
                    }
                  }}
                  className={`${styles.input} ${styles.passwordInput} ${
                    errors.password ? styles.inputError : ""
                  }`}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "password-error" : undefined
                  }
                  disabled={isSubmitting}
                />

                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={
                    showPassword
                      ? "Hide password"
                      : "Show password"
                  }
                  aria-pressed={showPassword}
                  disabled={isSubmitting}
                >
                  {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </div>

              {errors.password && (
                <p id="password-error" className={styles.errorMessage}>
                  {errors.password}
                </p>
              )}
            </div>

            <div className={styles.optionsRow}>
              <label className={styles.rememberLabel}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) =>
                    setRememberMe(event.target.checked)
                  }
                  className={styles.checkbox}
                  disabled={isSubmitting}
                />

                <span>Remember me</span>
              </label>
            </div>

            <button
              type="submit"
              className={styles.submitButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span
                    className={styles.spinner}
                    aria-hidden="true"
                  />
                  <span>Signing in...</span>
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className={styles.registration}>
            <span>Don&apos;t have an account?</span>

            <Link href="/register" className={styles.registerLink}>
              Create an account
            </Link>
          </div>
        </div>

        <footer className={styles.footer}>
          <p>© {new Date().getFullYear()} SavoryBites. All rights reserved.</p>

          <div className={styles.footerLinks}>
            <Link href="/privacy">Privacy</Link>
            <span aria-hidden="true">•</span>
            <Link href="/terms">Terms</Link>
          </div>
        </footer>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <LoginContent />
    </Suspense>
  );
}
