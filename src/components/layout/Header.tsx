"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useCart } from "../cart/CartProvider";
import { CartIcon, CloseIcon } from "../ui/Icons";
import { StaggeredMenuButton } from "./StaggeredMenuButton";
import styles from "../../app/home.module.css";

export function Header() {
  const pathname = usePathname();
  const { itemCount } = useCart();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [cartBump, setCartBump] = useState(false);
  const prevCountRef = useRef(itemCount);

  // Animate cart badge on item addition
  useEffect(() => {
    if (itemCount !== prevCountRef.current) {
      prevCountRef.current = itemCount;
      if (itemCount > 0) {
        const animTimer = setTimeout(() => setCartBump(true), 10);
        const resetTimer = setTimeout(() => setCartBump(false), 330);
        return () => {
          clearTimeout(animTimer);
          clearTimeout(resetTimer);
        };
      }
    }
  }, [itemCount]);

  // Close mobile menu on Escape key press
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    }

    if (isMobileMenuOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  // Handle sticky compact header on scroll
  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 20);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const closeMenu = () => setIsMobileMenuOpen(false);

  // Route active states
  const isHome = pathname === "/";
  const isMenu = pathname.startsWith("/menu");
  const isAbout = pathname === "/about";
  const isContact = pathname === "/contact";
  const isOrders = pathname.startsWith("/orders");
  const isCart = pathname.startsWith("/cart");
  const isCustomer = pathname.startsWith("/customer");
  const isLogin = pathname === "/login";
  const isRegister = pathname === "/register";

  return (
    <>
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      <header
        className={`${styles.header} ${isScrolled ? styles.headerScrolled : ""}`}
        role="banner"
      >
        <Link href="/" className={styles.brand} onClick={closeMenu} aria-label="SavoryBites Home">
          <b>S</b>
          <span>SavoryBites</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className={styles.desktopNav} aria-label="Main navigation">
          <Link
            href="/"
            className={isHome ? styles.activeNavLink : undefined}
            aria-current={isHome ? "page" : undefined}
          >
            Home
          </Link>
          <Link
            href="/menu"
            className={isMenu ? styles.activeNavLink : undefined}
            aria-current={isMenu ? "page" : undefined}
          >
            Menu
          </Link>
          <Link href="/#offers">Offers</Link>
          <Link
            href="/about"
            className={isAbout ? styles.activeNavLink : undefined}
            aria-current={isAbout ? "page" : undefined}
          >
            About
          </Link>
          <Link
            href="/contact"
            className={isContact ? styles.activeNavLink : undefined}
            aria-current={isContact ? "page" : undefined}
          >
            Contact
          </Link>
        </nav>

        {/* Desktop & Tablet Actions */}
        <div className={styles.actions}>
          <Link
            href="/cart"
            className={`${styles.cartLink} ${isCart ? styles.activeCartLink : ""}`}
            aria-label={`Shopping Cart, ${itemCount} items`}
          >
            <CartIcon className={styles.cartIcon} size={20} />
            <span>Cart</span>
            {itemCount > 0 ? (
              <span
                className={`${styles.cartBadge} ${cartBump ? styles.cartBadgeBump : ""}`}
                aria-label={`${itemCount} items in cart`}
              >
                {itemCount}
              </span>
            ) : null}
          </Link>

          <Link
            href="/orders"
            className={`${styles.ordersLink} ${isOrders ? styles.activeNavLink : ""}`}
            aria-current={isOrders ? "page" : undefined}
          >
            Orders
          </Link>

          {isLoading ? (
            <span className={styles.accountPlaceholder}>Account</span>
          ) : isAuthenticated && user ? (
            <Link
              href="/customer"
              className={`${styles.accountLink} ${isCustomer ? styles.activeNavLink : ""}`}
              title={`Signed in as ${user.full_name}`}
              aria-current={isCustomer ? "page" : undefined}
            >
              <span className={styles.userAvatar} aria-hidden="true">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt=""
                    width={24}
                    height={24}
                    unoptimized
                    className={styles.userAvatarImage}
                  />
                ) : (
                  user.full_name.charAt(0).toUpperCase()
                )}
              </span>
              <span>{user.full_name.split(" ")[0]}</span>
            </Link>
          ) : (
            <div className={styles.authLinks}>
              <Link
                href="/login"
                className={`${styles.signInLink} ${isLogin ? styles.activeNavLink : ""}`}
                aria-current={isLogin ? "page" : undefined}
              >
                Sign in
              </Link>
              <span className={styles.authDivider} aria-hidden="true">
                |
              </span>
              <Link
                href="/register"
                className={`${styles.signInLink} ${isRegister ? styles.activeNavLink : ""}`}
                aria-current={isRegister ? "page" : undefined}
              >
                Sign up
              </Link>
            </div>
          )}

          <Link href="/start-order" className={styles.order}>
            Order now
          </Link>

          {/* Mobile Menu Hamburger Toggle */}
          <StaggeredMenuButton
            className={styles.mobileToggle}
            isOpen={isMobileMenuOpen}
            onToggle={() => setIsMobileMenuOpen((open) => !open)}
            controlsId="mobile-navigation"
          />
        </div>
      </header>

      {/* Mobile Backdrop & Drawer */}
      {isMobileMenuOpen && (
        <div
          className={styles.mobileOverlay}
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}

      <aside
        id="mobile-navigation"
        className={`${styles.mobileDrawer} ${
          isMobileMenuOpen ? styles.mobileDrawerOpen : ""
        }`}
        aria-label="Mobile navigation menu"
        aria-hidden={!isMobileMenuOpen}
      >
        <div className={styles.mobileDrawerHeader}>
          <Link href="/" className={styles.brand} onClick={closeMenu}>
            <b>S</b>
            <span>SavoryBites</span>
          </Link>
          <button
            type="button"
            className={styles.closeDrawerButton}
            onClick={closeMenu}
            aria-label="Close menu"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <nav className={styles.mobileNavLinks} aria-label="Mobile navigation links">
          <Link
            href="/"
            onClick={closeMenu}
            className={isHome ? styles.mobileActiveLink : undefined}
          >
            Home
          </Link>
          <Link
            href="/menu"
            onClick={closeMenu}
            className={isMenu ? styles.mobileActiveLink : undefined}
          >
            Menu Catalog
          </Link>
          <Link href="/#offers" onClick={closeMenu}>
            Special Offers
          </Link>
          <Link
            href="/about"
            onClick={closeMenu}
            className={isAbout ? styles.mobileActiveLink : undefined}
          >
            About Us
          </Link>
          <Link
            href="/contact"
            onClick={closeMenu}
            className={isContact ? styles.mobileActiveLink : undefined}
          >
            Contact Us
          </Link>
          <Link href="/faq" onClick={closeMenu}>
            Frequently Asked Questions
          </Link>
          <Link href="/hours" onClick={closeMenu}>
            Operating Hours
          </Link>
          <Link href="/location" onClick={closeMenu}>
            Restaurant Location
          </Link>
          <Link
            href="/orders"
            onClick={closeMenu}
            className={isOrders ? styles.mobileActiveLink : undefined}
          >
            My orders
          </Link>
          <Link
            href="/cart"
            onClick={closeMenu}
            className={isCart ? styles.mobileActiveLink : undefined}
          >
            Cart {itemCount > 0 ? `(${itemCount} items)` : ""}
          </Link>
          {isLoading ? null : isAuthenticated && user ? (
            <Link
              href="/customer"
              onClick={closeMenu}
              className={isCustomer ? styles.mobileActiveLink : undefined}
            >
              My profile ({user.full_name.split(" ")[0]})
            </Link>
          ) : (
            <div className={styles.mobileAuthActions}>
              <Link
                href="/login"
                onClick={closeMenu}
                className={`${styles.mobileAuthBtn} ${styles.mobileSignInBtn} ${isLogin ? styles.mobileActiveLink : ""}`}
                aria-current={isLogin ? "page" : undefined}
              >
                Sign in
              </Link>
              <Link
                href="/register"
                onClick={closeMenu}
                className={`${styles.mobileAuthBtn} ${styles.mobileSignUpBtn} ${isRegister ? styles.mobileActiveLink : ""}`}
                aria-current={isRegister ? "page" : undefined}
              >
                Sign up
              </Link>
            </div>
          )}
        </nav>

        <div className={styles.mobileDrawerFooter}>
          <Link
            href="/start-order"
            className={styles.mobileOrderButton}
            onClick={closeMenu}
          >
            Start your order
          </Link>
        </div>
      </aside>
    </>
  );
}
