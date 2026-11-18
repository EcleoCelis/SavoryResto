"use client";

import Link from "next/link";
import { useRestaurantSettings } from "../settings/RestaurantSettingsProvider";
import { ArrowRightIcon } from "../ui/Icons";
import styles from "../../app/home.module.css";

export function Footer() {
  const { settings } = useRestaurantSettings();
  const info = settings.restaurant;

  return (
    <footer className={styles.footer}>
      <div>
        <b>{info.name}</b>
        <p>Fresh food, made with care and delivered with warmth.</p>
        <p style={{ marginTop: "12px", fontSize: "11px", color: "var(--gold)" }}>
          {info.tagline}
        </p>
      </div>

      <div>
        <h2>Explore</h2>
        <Link href="/menu">Menu</Link>
        <Link href="/#offers">Offers</Link>
        <Link href="/about">About Us</Link>
        <Link href="/faq">Frequently Asked Questions</Link>
      </div>

      <div>
        <h2>Information</h2>
        <Link href="/hours">Hours & Schedule</Link>
        <Link href="/location">Location & Directions</Link>
        <Link href="/customer">Customer Account</Link>
        <Link href="/orders">Order Tracking</Link>
      </div>

      <div>
        <h2>Contact</h2>
        <p>{info.locality}</p>
        <p>
          <a
            href={`tel:${info.phone.replace(/[\s-]/g, "")}`}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            {info.phone}
          </a>
        </p>
        <p>
          <a
            href={`mailto:${info.email}`}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            {info.email}
          </a>
        </p>
        <Link
          href="/contact"
          style={{
            color: "var(--gold)",
            fontWeight: "700",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            marginTop: "6px",
          }}
        >
          Send a message <ArrowRightIcon size={12} />
        </Link>
      </div>

      <small>
        Copyright {new Date().getFullYear()} {info.name}. All rights
        reserved. {info.full_address}.
      </small>
    </footer>
  );
}
