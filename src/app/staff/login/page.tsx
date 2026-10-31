"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { staffLogin, StaffApiError } from "../../../lib/api/staff";
import { staffHomeForRole } from "../../../lib/staff-routing";
import {
  EyeIcon,
  EyeOffIcon,
} from "../../../components/ui/Icons";
import type { StaffRole } from "../../../types/staff";
import styles from "./staff-login.module.css";

type LoginMode = "manager" | "kds";

export default function StaffLoginPage() {
  const router = useRouter();
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Active view state: "manager" is default initial experience
  const [mode, setMode] = useState<LoginMode>("manager");

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ariaAnnouncement, setAriaAnnouncement] = useState("");

  const isManager = mode === "manager";

  // Coordinated panel switch handler
  function handleSwitchMode(targetMode: LoginMode) {
    if (loading || targetMode === mode) return;

    setError("");
    setPassword("");
    setMode(targetMode);

    const announcement =
      targetMode === "kds"
        ? "Switched to Kitchen Display System login experience."
        : "Switched to Manager Login experience.";
    setAriaAnnouncement(announcement);

    // Focus the email input on the newly active form panel
    setTimeout(() => {
      emailInputRef.current?.focus();
    }, 150);
  }

  // Accessible notice for staff password reset policy (staff accounts require administrative rotation)
  function handleForgotPasswordNotice() {
    setError("Staff password resets cannot be performed online. Please contact your restaurant system administrator or operations manager.");
    setAriaAnnouncement("Staff password resets cannot be performed online. Please contact your restaurant system administrator or operations manager.");
  }

  // Handle staff credential submission with explicit requested_role enforcement
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const requestedRole: StaffRole = isManager ? "manager" : "kitchen_staff";

    try {
      const staffResponse = await staffLogin(
        email.trim().toLowerCase(),
        password,
        rememberMe,
        requestedRole,
      );

      // Route to authoritative target destination returned by the server
      const destination = staffResponse.target_url || staffHomeForRole(staffResponse.role);
      router.replace(destination);
    } catch (requestError) {
      if (requestError instanceof StaffApiError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : "Unable to sign in.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      id="main-content"
      className={`${styles.page} ${isManager ? styles.pageManager : styles.pageKds}`}
    >
      {/* Screen reader polite live announcements */}
      <div className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {ariaAnnouncement}
      </div>
      {/* ====================================================================
          Panel A: Authentication Form Panel (Strict 40% Width on Desktop)
          Reference Alignment: Strict Left-Aligned Components
         ==================================================================== */}
      <section className={styles.formPanel} aria-labelledby="auth-form-title">
        {/* Tier 1: Top Navigation & Brand Header */}
        <header className={styles.topSection}>
          <Link href="/" className={styles.brandLogoGroup} aria-label="SavoryBites Home">
           <span>←</span>
            <b className={styles.brandEmblemLetter}>S</b>
            <span className={styles.brandLogoText}>SavoryBites</span>
          </Link>
        </header>

        {/* Tier 2: Center Main Content (Headings, Inputs, CTA, Secondary Links) */}
        <div className={styles.centerSection}>
          {/* Reference Heading: Bold Grotesk Sans + Italic Accent */}
          <h1 id="auth-form-title" className={styles.formMainHeading}>
            {isManager ? (
              <>
                Manage your<br />
                Restaurant, <em className={styles.accentWord}>Smarter</em>
              </>
            ) : (
              <>
                Kitchen Queue,<br />
                Fulfillment, <em className={styles.accentWord}>Faster</em>
              </>
            )}
          </h1>

          {/* Reference Subtitle */}
          <p className={styles.formSubheading}>
            {isManager
              ? "A simple and powerful tool designed to help restaurants run smoother, faster, and smarter, all in one place."
              : "A simple and powerful tool designed to track active tickets, expedite orders, and synchronize line stations in real-time."}
          </p>

          {/* Error Feedback Display */}
          {error ? (
            <div className={styles.alertError} role="alert" aria-live="assertive">
              <span className={styles.alertIcon} aria-hidden="true">
                !
              </span>
              <div>
                <strong>Authentication Error</strong>
                <p style={{ margin: "2px 0 0" }}>{error}</p>
              </div>
            </div>
          ) : null}

          {/* Reference-Styled Clean Minimal Form */}
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.fieldGroup}>
              <label className={styles.srOnly} htmlFor="staff-email">
                {isManager ? "Manager Email Address" : "Kitchen Staff Email Address"}
              </label>
              <div className={styles.inputWrapper}>
                <input
                  ref={emailInputRef}
                  className={styles.inputField}
                  id="staff-email"
                  type="email"
                  autoComplete="username email"
                  placeholder={isManager ? "jane@gmail.com" : "kitchen@savorybites.com"}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.srOnly} htmlFor="staff-password">
                Password
              </label>
              <div className={styles.inputWrapper}>
                <input
                  className={`${styles.inputField} ${styles.inputFieldWithToggle}`}
                  id="staff-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  required
                  minLength={8}
                  disabled={loading}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={loading}
                >
                  {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </div>
            </div>

            {/* Reference Inline Options Row: Remember Me & Forgot Password */}
            <div className={styles.optionsRow}>
              <label className={styles.rememberLabel}>
                <input
                  className={styles.checkbox}
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                />
                <span>Remember me</span>
              </label>

              <button
                type="button"
                className={styles.forgotPasswordLink}
                onClick={handleForgotPasswordNotice}
                disabled={loading}
              >
                Forgot Password ?
              </button>
            </div>

            {/* Reference Compact Left-Aligned Submit Button */}
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {/* Reference Sub-CTA Link: "Don't have an account ? Sign Up" style */}
          <div className={styles.switchPrompt}>
            {isManager ? (
              <span>
                Kitchen staff ?
                <button
                  type="button"
                  className={styles.switchLink}
                  onClick={() => handleSwitchMode("kds")}
                  disabled={loading}
                >
                  Sign In to KDS
                </button>
              </span>
            ) : (
              <span>
                Manager or Admin ?
                <button
                  type="button"
                  className={styles.switchLink}
                  onClick={() => handleSwitchMode("manager")}
                  disabled={loading}
                >
                  Sign In to Manager
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Tier 3: Reference Left-Aligned Footer Notice */}
        <footer className={styles.bottomSection}>
          <p className={styles.copyrightText}>
            Copyright © 2026 SavoryBites Hospitality Inc.<br />
            All rights reserved.
          </p>
        </footer>
      </section>

      {/* ====================================================================
          Panel B: Photographic Visual Panel (Strict 60% Width on Desktop)
          Manager: restaurant-interior.jpg
          KDS: life-style.jpg
          Mobile: Hidden (Only the form panel is visible on mobile)
         ==================================================================== */}
      <section
        className={styles.infoPanel}
        aria-label="SavoryBites Restaurant Operations Preview"
      >
        {/* Layer 1: Manager Restaurant Interior Background */}
        <div
          className={`${styles.photoLayer} ${isManager ? styles.layerActive : styles.layerInactive}`}
          aria-hidden={!isManager}
        >
          <Image
            src="/images/restaurant-interior.jpg"
            alt="SavoryBites restaurant dining room and interior"
            fill
            priority
            quality={85}
            sizes="60vw"
            className={styles.photoImage}
          />
        </div>

        {/* Layer 2: KDS Kitchen Life-Style Background */}
        <div
          className={`${styles.photoLayer} ${!isManager ? styles.layerActive : styles.layerInactive}`}
          aria-hidden={isManager}
        >
          <Image
            src="/images/life-style.jpg"
            alt="SavoryBites chefs cooking with high heat and pan flame"
            fill
            quality={85}
            sizes="60vw"
            className={styles.photoImage}
          />
        </div>

        {/* Dark ambient vignette overlay evoking the warm dark reference styling */}
        <div className={styles.photoBackdropOverlay} aria-hidden="true" />

        {/* Docked Operational Content */}
        <div className={styles.infoContentContainer}>
          <span className={styles.glassBadge}>
            {isManager ? "Executive Operations" : "Kitchen Production"}
          </span>

          <h2 className={styles.glassHeading}>
            {isManager
              ? "Operational excellence starts here."
              : "Every order, moving forward."}
          </h2>

          <p className={styles.glassDescription}>
            {isManager
              ? "Real-time dining room synchronization, live menu catalog management, dynamic price controls, and automated inventory reconciliation."
              : "Live station priority tracking, order preparation timers, instant dish customization details, and seamless ticket fulfillment."}
          </p>

          <ul className={styles.glassFeaturesList}>
            {isManager ? (
              <>
                <li className={styles.glassFeatureItem}>
                  <span className={styles.glassFeatureCheck}>✓</span>
                  <span>Dynamic menu pricing & catalog availability toggles</span>
                </li>
                <li className={styles.glassFeatureItem}>
                  <span className={styles.glassFeatureCheck}>✓</span>
                  <span>Automated recipe inventory deductions & stock alerts</span>
                </li>
                <li className={styles.glassFeatureItem}>
                  <span className={styles.glassFeatureCheck}>✓</span>
                  <span>Real-time table service & counter pickup oversight</span>
                </li>
              </>
            ) : (
              <>
                <li className={styles.glassFeatureItem}>
                  <span className={styles.glassFeatureCheck}>✓</span>
                  <span>Real-time priority ticket queue with prep timers</span>
                </li>
                <li className={styles.glassFeatureItem}>
                  <span className={styles.glassFeatureCheck}>✓</span>
                  <span>One-touch status progression: Confirmed → Preparing → Ready</span>
                </li>
                <li className={styles.glassFeatureItem}>
                  <span className={styles.glassFeatureCheck}>✓</span>
                  <span>Clear itemized recipe sizes, add-ons, and table tags</span>
                </li>
              </>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}
