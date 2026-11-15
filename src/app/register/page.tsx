"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/auth/AuthProvider";
import { CheckIcon, EyeIcon, EyeOffIcon } from "../../components/ui/Icons";
import { getApiBaseUrl } from "../../lib/api/base-url";
import styles from "./register.module.css";

type RegistrationErrors = {
  fullName?: string;
  email?: string;
  mobile?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
  registration?: string;
};

type PasswordRequirement = {
  label: string;
  met: boolean;
};

type PasswordStrength = {
  label: "Weak" | "Fair" | "Good" | "Strong" | "";
  score: number;
};

const getPasswordStrength = (password: string): PasswordStrength => {
  if (!password) {
    return {
      label: "",
      score: 0,
    };
  }

  let score = 0;

  if (password.length >= 8) score++;
  if (/[a-zA-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) {
    return {
      label: "Weak",
      score,
    };
  }

  if (score === 2) {
    return {
      label: "Fair",
      score,
    };
  }

  if (score === 3) {
    return {
      label: "Good",
      score,
    };
  }

  return {
    label: "Strong",
    score,
  };
};

const isValidPhilippineMobile = (mobile: string): boolean => {
  const normalized = mobile.replace(/[\s-]/g, "");

  return /^(09\d{9}|\+639\d{9})$/.test(normalized);
};

export default function RegisterPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/customer");
    }
  }, [authLoading, isAuthenticated, router]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [acceptTerms, setAcceptTerms] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);

  const [errors, setErrors] = useState<RegistrationErrors>({});

  const passwordStrength = useMemo(
    () => getPasswordStrength(password),
    [password]
  );

  const passwordRequirements: PasswordRequirement[] = [
    {
      label: "At least 8 characters",
      met: password.length >= 8,
    },
    {
      label: "Contains a letter",
      met: /[a-zA-Z]/.test(password),
    },
    {
      label: "Contains a number",
      met: /\d/.test(password),
    },
  ];

  const passwordsMatch =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  const validateForm = (): RegistrationErrors => {
    const newErrors: RegistrationErrors = {};

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const normalizedMobile = mobile.replace(/[\s-]/g, "");

    if (!trimmedName) {
      newErrors.fullName = "Please enter your full name.";
    } else if (trimmedName.length < 2) {
      newErrors.fullName = "Please enter your full name.";
    }

    if (!trimmedEmail) {
      newErrors.email = "Please enter your email address.";
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    ) {
      newErrors.email = "Please enter a valid email address.";
    }

    if (!normalizedMobile) {
      newErrors.mobile = "Please enter your mobile number.";
    } else if (!isValidPhilippineMobile(normalizedMobile)) {
      newErrors.mobile =
        "Please enter a valid Philippine mobile number.";
    }

    if (!password) {
      newErrors.password = "Please create a password.";
    } else if (password.length < 8) {
      newErrors.password =
        "Password must contain at least 8 characters.";
    } else if (!/[a-zA-Z]/.test(password)) {
      newErrors.password =
        "Password must contain at least one letter.";
    } else if (!/\d/.test(password)) {
      newErrors.password =
        "Password must contain at least one number.";
    }

    if (!confirmPassword) {
      newErrors.confirmPassword =
        "Please confirm your password.";
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }

    if (!acceptTerms) {
      newErrors.terms =
        "Please accept the Terms & Conditions to continue.";
    }

    return newErrors;
  };

 const handleSubmit = async (
  event: FormEvent<HTMLFormElement>
) => {
  event.preventDefault();

  setErrors({});
  setRegistrationComplete(false);

  const validationErrors = validateForm();

  if (Object.keys(validationErrors).length > 0) {
    setErrors(validationErrors);
    return;
  }

 setIsLoading(true);

  try {
    const apiUrl = getApiBaseUrl();

    const response = await fetch(
      `${apiUrl}/api/v1/auth/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: mobile.replace(/[\s-]/g, ""),
          password: password,
        }),
      }
    );

    const contentType =
      response.headers.get("content-type") || "";

    const data = contentType.includes(
      "application/json"
    )
      ? await response.json()
      : null;

    if (!response.ok) {
      let message =
        "Please review your information and try again.";

      if (data?.detail) {
        if (typeof data.detail === "string") {
          message = data.detail;
        } else if (Array.isArray(data.detail)) {
          message = data.detail
            .map((error: { msg?: string }) => error.msg)
            .filter(Boolean)
            .join(" ");
        }
      }

      setErrors({
        registration: message,
      });

      return;
    }

    console.log("Registration successful:", data);

    setRegistrationComplete(true);
  } catch (error) {
    console.error(
      "Registration request failed:",
      error
    );

    setErrors({
      registration:
        "We could not connect to the registration service. Please try again.",
    });
  } finally {
    setIsLoading(false);
  }
};

  const clearFieldError = (field: keyof RegistrationErrors) => {
    if (errors[field]) {
      setErrors((current) => ({
        ...current,
        [field]: undefined,
      }));
    }
  };

  const handleMobileChange = (
    value: string
  ) => {
    /*
     * Allow digits, spaces, + and hyphens.
     * This keeps the field friendly while validation
     * handles the actual format.
     */
    const sanitized = value.replace(/[^\d+\s-]/g, "");

    setMobile(sanitized);
    clearFieldError("mobile");
  };

  if (registrationComplete) {
    return (
      <main id="main-content" className={styles.page}>
        <div
          className={styles.backgroundDecoration}
          aria-hidden="true"
        >
          <span className={styles.decorationCircleOne} />
          <span className={styles.decorationCircleTwo} />
        </div>

        <section
          className={styles.successContainer}
          aria-labelledby="success-title"
         >
          <div className={styles.brand}>
            <Link
              href="/"
              className={styles.brandLink}
              aria-label="SavoryBites home"
            >
              <span
                className={styles.brandMark}
                aria-hidden="true"
              >
                S
              </span>

              { <span className={styles.brandText}>
                <span className={styles.brandName}>
                  SavoryBites
                </span>

                <span className={styles.brandTagline}>
                  Freshly made. Simply delicious.
                </span>
              </span> }
            </Link>
          </div>

          { <section className={styles.successCard}>
            <div className={styles.successIcon} aria-hidden="true">
              <CheckIcon size={24} />
            </div>

            <p className={styles.successEyebrow}>
              Registration Complete
            </p>

            <h1
              id="success-title"
              className={styles.successTitle}
            >
              Welcome to SavoryBites
            </h1>

            <p className={styles.successDescription}>
              Your customer account has been created
              successfully. You can now sign in and
              continue your dining experience with us.
            </p>

            <button
              type="button"
              className={styles.submitButton}
              onClick={() => router.push("/login")}
            >
              Continue to Sign In
            </button>
          </section> }

          <footer className={styles.footer}>
            <p>
              © {new Date().getFullYear()} SavoryBites. All
              rights reserved.
            </p>

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

  return (
    <main id="main-content" className={styles.page}>
      <div
        className={styles.backgroundDecoration}
        aria-hidden="true"
      >
        <span className={styles.decorationCircleOne} />
        <span className={styles.decorationCircleTwo} />
      </div>

      <section
        className={styles.registerContainer}
        aria-labelledby="register-title"
      >
        <div className={styles.brand}>
          <Link
            href="/"
            className={styles.brandLink}
            aria-label="SavoryBites home"
          >
            <span
              className={styles.brandMark}
              aria-hidden="true"
            >
              S
            </span>

            <span className={styles.brandText}>
              <span className={styles.brandName}>
                SavoryBites
              </span>

              <span className={styles.brandTagline}>
                Freshly made. Simply delicious.
              </span>
            </span>
          </Link>
        </div>

        <div className={styles.card}>
          <header className={styles.cardHeader}>
            <p className={styles.eyebrow}>
              Customer Account
            </p>

            <h1
              id="register-title"
              className={styles.title}
            >
              Create your account
            </h1>

            <p className={styles.description}>
              Join us for a simpler, more convenient
              ordering experience.
            </p>
          </header>

          {errors.registration && (
            <div
              className={styles.alertError}
              role="alert"
              aria-live="polite"
            >
              <span
                className={styles.alertIcon}
                aria-hidden="true"
              >
                !
              </span>

              <div>
                <strong>
                  Unable to create your account
                </strong>

                <p>{errors.registration}</p>
              </div>
            </div>
          )}

          <form
            className={styles.form}
            onSubmit={handleSubmit}
            noValidate
          >
            {/* FULL NAME */}
            <div className={styles.field}>
              <label
                htmlFor="fullName"
                className={styles.label}
              >
                Full Name
              </label>

              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                placeholder="Juan Dela Cruz"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value);
                  clearFieldError("fullName");
                }}
                className={`${styles.input} ${
                  errors.fullName
                    ? styles.inputError
                    : ""
                }`}
                aria-invalid={Boolean(errors.fullName)}
                aria-describedby={
                  errors.fullName
                    ? "fullName-error"
                    : undefined
                }
                disabled={isLoading}
              />

              {errors.fullName && (
                <p
                  id="fullName-error"
                  className={styles.errorMessage}
                >
                  {errors.fullName}
                </p>
              )}
            </div>

            {/* EMAIL */}
            <div className={styles.field}>
              <label
                htmlFor="email"
                className={styles.label}
              >
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
                  clearFieldError("email");
                }}
                className={`${styles.input} ${
                  errors.email
                    ? styles.inputError
                    : ""
                }`}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={
                  errors.email
                    ? "email-error"
                    : undefined
                }
                disabled={isLoading}
              />

              {errors.email && (
                <p
                  id="email-error"
                  className={styles.errorMessage}
                >
                  {errors.email}
                </p>
              )}
            </div>

            {/* MOBILE */}
            <div className={styles.field}>
              <label
                htmlFor="mobile"
                className={styles.label}
              >
                Mobile Number
              </label>

              <input
                id="mobile"
                name="mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="09XX XXX XXXX"
                value={mobile}
                onChange={(event) =>
                  handleMobileChange(event.target.value)
                }
                className={`${styles.input} ${
                  errors.mobile
                    ? styles.inputError
                    : ""
                }`}
                aria-invalid={Boolean(errors.mobile)}
                aria-describedby={
                  errors.mobile
                    ? "mobile-error"
                    : "mobile-help"
                }
                disabled={isLoading}
              />

              <p
                id="mobile-help"
                className={styles.fieldHint}
              >
                Use a Philippine mobile number, such as
                09XX XXX XXXX.
              </p>

              {errors.mobile && (
                <p
                  id="mobile-error"
                  className={styles.errorMessage}
                >
                  {errors.mobile}
                </p>
              )}
            </div>

            {/* PASSWORD */}
            <div className={styles.field}>
              <label
                htmlFor="password"
                className={styles.label}
              >
                Password
              </label>

              <div className={styles.passwordWrapper}>
                <input
                  id="password"
                  name="password"
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  autoComplete="new-password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearFieldError("password");
                  }}
                  className={`${styles.input} ${
                    styles.passwordInput
                  } ${
                    errors.password
                      ? styles.inputError
                      : ""
                  }`}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby="password-requirements"
                  disabled={isLoading}
                />

                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() =>
                    setShowPassword(
                      (current) => !current
                    )
                  }
                  aria-label={
                    showPassword
                      ? "Hide password"
                      : "Show password"
                  }
                  aria-pressed={showPassword}
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </div>

              {password && (
                <div
                  className={styles.passwordStrength}
                  aria-live="polite"
                >
                  <div
                    className={styles.strengthHeader}
                  >
                    <span>
                      Password strength
                    </span>

                    <strong
                      className={
                        passwordStrength.score === 1
                          ? styles.strengthWeak
                          : passwordStrength.score === 2
                          ? styles.strengthFair
                          : passwordStrength.score === 3
                          ? styles.strengthGood
                          : passwordStrength.score === 4
                          ? styles.strengthStrong
                          : ""
                      }
                    >
                      {passwordStrength.label}
                    </strong>
                  </div>

                  <div
                    className={styles.strengthBars}
                    aria-hidden="true"
                  >
                    {[1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className={
                          bar <=
                          passwordStrength.score
                            ? `${styles.strengthBar} ${styles.strengthBarActive}`
                            : styles.strengthBar
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              <div
                id="password-requirements"
                className={styles.requirements}
              >
                <p className={styles.requirementsTitle}>
                  Password requirements
                </p>

                <ul>
                  {passwordRequirements.map(
                    (requirement) => (
                      <li
                        key={requirement.label}
                        className={
                          requirement.met
                            ? styles.requirementMet
                            : ""
                        }
                      >
                        <span
                          className={
                            styles.requirementIcon
                          }
                          aria-hidden="true"
                        >
                          {requirement.met
                            ? (<CheckIcon size={12} style={{ display: "inline-block" }} />)
                            : "○"}
                        </span>

                        <span>
                          {requirement.label}
                        </span>
                      </li>
                    )
                  )}
                </ul>
              </div>

              {errors.password && (
                <p
                  className={styles.errorMessage}
                  role="alert"
                >
                  {errors.password}
                </p>
              )}
            </div>

            {/* CONFIRM PASSWORD */}
            <div className={styles.field}>
              <label
                htmlFor="confirmPassword"
                className={styles.label}
              >
                Confirm Password
              </label>

              <div className={styles.passwordWrapper}>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={
                    showConfirmPassword
                      ? "text"
                      : "password"
                  }
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(
                      event.target.value
                    );
                    clearFieldError(
                      "confirmPassword"
                    );
                  }}
                  className={`${styles.input} ${
                    styles.passwordInput
                  } ${
                    errors.confirmPassword
                      ? styles.inputError
                      : passwordsMatch
                      ? styles.inputValid
                      : ""
                  }`}
                  aria-invalid={Boolean(
                    errors.confirmPassword
                  )}
                  aria-describedby={
                    errors.confirmPassword
                      ? "confirm-password-error"
                      : passwordsMatch
                      ? "password-match-success"
                      : undefined
                  }
                  disabled={isLoading}
                />

                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() =>
                    setShowConfirmPassword(
                      (current) => !current
                    )
                  }
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirmed password"
                      : "Show confirmed password"
                  }
                  aria-pressed={
                    showConfirmPassword
                  }
                  disabled={isLoading}
                >
                  {showConfirmPassword
                    ? "Hide"
                    : "Show"}
                </button>
              </div>

              {passwordsMatch && (
                <p
                  id="password-match-success"
                  className={styles.successMessage}
                  role="status"
                >
                  <CheckIcon size={14} style={{ display: "inline-block", verticalAlign: "-2px", marginRight: "4px" }} />
                  Passwords match.
                </p>
              )}

              {errors.confirmPassword && (
                <p
                  id="confirm-password-error"
                  className={styles.errorMessage}
                  role="alert"
                >
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            {/* TERMS */}
            <div className={styles.termsSection}>
              <label
                className={`${styles.termsLabel} ${
                  errors.terms
                    ? styles.termsError
                    : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(event) => {
                    setAcceptTerms(
                      event.target.checked
                    );
                    clearFieldError("terms");
                  }}
                  className={styles.checkbox}
                  disabled={isLoading}
                  aria-invalid={Boolean(errors.terms)}
                  aria-describedby={
                    errors.terms
                      ? "terms-error"
                      : undefined
                  }
                />

                <span>
                  I agree to the{" "}
                  <Link
                    href="/terms"
                    className={styles.inlineLink}
                    target="_blank"
                  >
                    Terms & Conditions
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    className={styles.inlineLink}
                    target="_blank"
                  >
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>

              {errors.terms && (
                <p
                  id="terms-error"
                  className={styles.errorMessage}
                  role="alert"
                >
                  {errors.terms}
                </p>
              )}
            </div>

            {/* SUBMIT */}
            <button
              type="submit"
              className={styles.submitButton}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span
                    className={styles.spinner}
                    aria-hidden="true"
                 
                  />

                  <span>
                    Creating account...
                  </span>
                
                 



                </>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {/* LOGIN LINK */}
          <div className={styles.loginPrompt}>
            <span>
              Already have an account?
            </span>

            <Link
              href="/login"
              className={styles.loginLink}
            >
              Sign In
            </Link>
          </div>
        </div>

        <footer className={styles.footer}>
          <p>
            © {new Date().getFullYear()} Savory. All
            rights reserved.
          </p>

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
