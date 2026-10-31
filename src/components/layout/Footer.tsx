import Link from "next/link";
import { RESTAURANT_INFO } from "../../config/restaurant";
import { ArrowRightIcon } from "../ui/Icons";
import styles from "../../app/home.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div>
        <b>{RESTAURANT_INFO.name}</b>
        <p>Fresh food, made with care and delivered with warmth.</p>
        <p style={{ marginTop: "12px", fontSize: "11px", color: "var(--gold)" }}>
          {RESTAURANT_INFO.tagline}
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
        <p>{RESTAURANT_INFO.locality}</p>
        <p>
          <a
            href={`tel:${RESTAURANT_INFO.phone.replace(/[\s-]/g, "")}`}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            {RESTAURANT_INFO.phone}
          </a>
        </p>
        <p>
          <a
            href={`mailto:${RESTAURANT_INFO.email}`}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            {RESTAURANT_INFO.email}
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
        Copyright {new Date().getFullYear()} {RESTAURANT_INFO.name}. All rights
        reserved. {RESTAURANT_INFO.fullAddress}.
      </small>
    </footer>
  );
}
