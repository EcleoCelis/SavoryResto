"use client";

import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import styles from "../../app/menu/menu.module.css";
import { useAuth } from "../auth/AuthProvider";
import {
  addCustomerFavorite,
  getCustomerFavorites,
  getCustomerProfile,
  removeCustomerFavorite,
} from "../../lib/api/customer";
import { getCategories, getProducts } from "../../lib/api/products";
import { detectDishConflicts } from "../../lib/personalization";
import { HeartIcon, PlusIcon, SearchIcon } from "../ui/Icons";
import { AllergyConflictNotice } from "./AllergyConflictNotice";
import type { CustomerProfile } from "../../types/customer";
import type { Category, Product } from "../../types/product";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

type AvailabilityFilter = "available" | "unavailable" | "all";

function parseCategoryId(value: string | null) {
  const categoryId = Number(value);
  return Number.isSafeInteger(categoryId) && categoryId > 0 ? categoryId : null;
}

function parseAvailability(value: string | null): AvailabilityFilter {
  return value === "available" || value === "unavailable" ? value : "all";
}

export function MenuCatalog() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const categoryId = parseCategoryId(searchParams.get("category"));
  const search = searchParams.get("search")?.trim() ?? "";
  const availability = parseAvailability(searchParams.get("availability"));
  const { isAuthenticated } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [failedImageIds, setFailedImageIds] = useState<Set<number>>(new Set());
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const categoryNavRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function updateQuery(updates: {
    category?: number | null;
    search?: string;
    availability?: AvailabilityFilter;
  }) {
    const params = new URLSearchParams(queryString);
    if ("category" in updates) {
      if (updates.category === null) params.delete("category");
      else if (updates.category !== undefined) params.set("category", String(updates.category));
    }
    if ("search" in updates) {
      const nextSearch = updates.search?.trim() ?? "";
      if (nextSearch) params.set("search", nextSearch);
      else params.delete("search");
    }
    if ("availability" in updates) {
      const nextAvailability = updates.availability ?? "all";
      if (nextAvailability === "all") params.delete("availability");
      else params.set("availability", nextAvailability);
    }
    router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    updateQuery({ search: String(formData.get("search") ?? "") });
  }

  function resetAllFilters() {
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    router.replace(pathname, { scroll: false });
  }

  // Keep the selected tab visible in the horizontal category strip (mobile/tablet).
  // Scrolls only the strip itself — never the page — and only when the tab is off-screen.
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let active = true;
    void Promise.all([getCustomerFavorites(), getCustomerProfile()])
      .then(([favorites, profile]) => {
        if (!active) return;
        setFavoriteIds(new Set(favorites.map((fav) => fav.product_id)));
        setCustomerProfile(profile);
      })
      .catch(() => {
        // Ignore silent personalization load failures on public catalog.
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  const activeFavoriteIds = isAuthenticated ? favoriteIds : new Set<number>();
  const activeProfile = isAuthenticated ? customerProfile : null;

  async function handleToggleFavorite(productId: number) {
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent("/menu")}`);
      return;
    }
    const wasFav = favoriteIds.has(productId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasFav) next.delete(productId);
      else next.add(productId);
      return next;
    });
    try {
      if (wasFav) {
        await removeCustomerFavorite(productId);
      } else {
        await addCustomerFavorite(productId);
      }
    } catch {
      setFavoriteIds((prev) => {
        const reverted = new Set(prev);
        if (wasFav) reverted.add(productId);
        else reverted.delete(productId);
        return reverted;
      });
    }
  }

  useEffect(() => {
    const nav = categoryNavRef.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return; // desktop rail / no overflow
    const activeTab = nav.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (!activeTab) return;

    const navRect = nav.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    const edgeAllowance = 24; // width of the right-edge fade
    const isFullyVisible = tabRect.left >= navRect.left && tabRect.right <= navRect.right - edgeAllowance;
    if (isFullyVisible) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollBy({
      left: tabRect.left + tabRect.width / 2 - (navRect.left + navRect.width / 2),
      behavior: prefersReducedMotion ? "instant" : "smooth",
    });
  }, [categoryId, categories]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getCategories(),
      getProducts({ categoryId, search, availability }),
    ])
      .then(([loadedCategories, loadedProducts]) => {
        if (!active) return;
        setError("");
        setCategories(loadedCategories);
        setProducts(loadedProducts);
      })
      .catch(() => {
        if (active) setError("The menu is temporarily unavailable. Please try again shortly.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [availability, categoryId, search]);

  if (error) {
    return (
      <div className={styles.catalogMessage} role="alert">
        <p>{error}</p>
        <button type="button" className={styles.clearFiltersButton} onClick={() => router.refresh()}>
          Retry loading
        </button>
      </div>
    );
  }

  if (loading && categories.length === 0) {
    return <p className={styles.catalogMessage} aria-live="polite">Loading the menu dishes...</p>;
  }

  const isFiltered = categoryId !== null || search !== "" || availability !== "all";
  const activeCategory = categories.find((c) => c.id === categoryId);
  const activeCategoryName = activeCategory ? activeCategory.name : "All Categories";

  return (
    <div className={styles.catalogLayout}>
      {/* Category Navigation (Desktop Sidebar & Mobile Hybrid Bar) */}
      <aside className={styles.categorySidebar} aria-label="Menu categories">
        {/* Desktop Sidebar Header */}
        <div className={styles.categorySidebarHeader}>
          <h3>Categories</h3>
          <span className={styles.categoryBadge}>{categories.length}</span>
        </div>

        {/* Single row of horizontally scrollable category tabs (mobile/tablet); vertical rail on desktop */}
        <div className={styles.mobileCategoryBar}>
          <nav ref={categoryNavRef} className={styles.categoryNav} aria-label="Filter by category">
            <button
              type="button"
              className={`${styles.categoryItem} ${categoryId === null ? styles.categoryItemActive : ""}`}
              onClick={() => updateQuery({ category: null })}
              aria-pressed={categoryId === null}
            >
              <span className={styles.categoryLabel}>All</span>
            </button>
            {categories.map((category) => {
              const isActive = categoryId === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`${styles.categoryItem} ${isActive ? styles.categoryItemActive : ""}`}
                  onClick={() => updateQuery({ category: category.id })}
                  aria-pressed={isActive}
                >
                  <span className={styles.categoryLabel}>{category.name}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={styles.catalogMain}>
        {/* Compact Search & Availability Toolbar */}
        <div className={styles.toolbarRow}>
          <form className={styles.search} onSubmit={submitSearch} role="search">
            <label htmlFor="menu-search">Search the menu</label>
            <div className={styles.searchInputWrapper}>
              <SearchIcon size={14} className={styles.searchIconInline} />
              <input
                ref={searchInputRef}
                key={search}
                id="menu-search"
                name="search"
                type="search"
                defaultValue={search}
                placeholder="Search dishes..."
                maxLength={100}
              />
              {search && (
                <button
                  type="button"
                  className={styles.searchClearBtn}
                  onClick={() => updateQuery({ search: "" })}
                  aria-label="Clear search input"
                >
                  ✕
                </button>
              )}
            </div>
            <button type="submit" className={styles.searchSubmitBtn} aria-label="Search dishes">
              <span>Search</span>
            </button>
          </form>

          {/* Compact Segmented Availability Filter */}
          <nav className={styles.availabilityFilters} aria-label="Product availability">
            <button
              className={`${styles.availabilityBtn} ${availability === "all" ? styles.activeAvailability : ""}`}
              type="button"
              onClick={() => updateQuery({ availability: "all" })}
              aria-pressed={availability === "all"}
            >
              All dishes
            </button>
            <button
              className={`${styles.availabilityBtn} ${availability === "available" ? styles.activeAvailability : ""}`}
              type="button"
              onClick={() => updateQuery({ availability: "available" })}
              aria-pressed={availability === "available"}
            >
              Available now
            </button>
            <button
              className={`${styles.availabilityBtn} ${availability === "unavailable" ? styles.activeAvailability : ""}`}
              type="button"
              onClick={() => updateQuery({ availability: "unavailable" })}
              aria-pressed={availability === "unavailable"}
            >
              Sold out
            </button>
          </nav>
        </div>

        {/* Section Heading with Dynamic Results Count */}
        <div className={styles.sectionHeadingRow}>
          <div className={styles.headingGroup}>
            <h2>{activeCategoryName}</h2>
            <span className={styles.resultCount} aria-live="polite" aria-atomic="true">
              {products.length} {products.length === 1 ? "dish" : "dishes"} available
            </span>
          </div>
          {isFiltered && (
            <button
              type="button"
              className={styles.resetFiltersBtn}
              onClick={resetAllFilters}
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Product Grid */}
        <div className={styles.grid}>
          {products.map((product) => {
            const isFavorite = activeFavoriteIds.has(product.id);
            const conflicts = detectDishConflicts(product, activeProfile);
            return (
              <article
                key={product.id}
                className={`${styles.card} ${!product.is_available ? styles.unavailableCard : ""}`}
              >
                <Link
                  href={`/menu/${product.id}`}
                  className={styles.itemImage}
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  {product.image_url && !failedImageIds.has(product.id) ? (
                    <Image
                      src={product.image_url}
                      alt={product.name}
                      sizes="(max-width: 680px) 84px, 104px"
                      fill
                      onError={() => {
                        setFailedImageIds((prev) => new Set(prev).add(product.id));
                      }}
                    />
                  ) : (
                    <span className={styles.imageFallback} aria-label={`${product.name} image pending`}>
                      {product.name.slice(0, 1)}
                    </span>
                  )}
                </Link>

                <div className={styles.cardBody}>
                  <div className={styles.cardTopRow}>
                    <Link href={`/menu/${product.id}`} className={styles.itemDetails}>
                      <h2>{product.name}</h2>
                      <p>{product.description || "Freshly prepared and ready to enjoy."}</p>
                    </Link>
                    <button
                      type="button"
                      className={`${styles.favoriteBtn} ${isFavorite ? styles.favoriteBtnActive : ""}`}
                      onClick={() => void handleToggleFavorite(product.id)}
                      aria-label={isFavorite ? `Remove ${product.name} from favorites` : `Save ${product.name} to favorites`}
                      aria-pressed={isFavorite}
                      title={isAuthenticated ? (isFavorite ? "Remove from favorites" : "Save to favorites") : "Sign in to save favorites"}
                    >
                      <HeartIcon size={16} filled={isFavorite} />
                    </button>
                  </div>
                  <AllergyConflictNotice conflicts={conflicts} compact />
                  <div className={styles.priceRow}>
                    <b>{currencyFormatter.format(product.price)}</b>
                    {product.is_available ? (
                      <Link
                        href={`/menu/${product.id}`}
                        className={styles.addLink}
                        aria-label={`Select options and add ${product.name} to cart`}
                      >
                        <PlusIcon size={12} style={{ display: "inline", marginRight: "3px", verticalAlign: "-1px" }} />
                        <span>Add</span>
                      </Link>
                    ) : (
                      <span className={styles.unavailableLabel}>Unavailable</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {!loading && products.length === 0 ? (
          <div className={styles.catalogMessage} role="status">
            <p>
              {search
                ? `No dishes found matching "${search}".`
                : "No dishes match your selected filter criteria."}
            </p>
            {isFiltered && (
              <button
                type="button"
                className={styles.clearFiltersButton}
                onClick={resetAllFilters}
              >
                View all dishes
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
