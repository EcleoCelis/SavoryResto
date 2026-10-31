"use client";

import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import styles from "../../app/menu/menu.module.css";
import { getCategories, getProducts } from "../../lib/api/products";
import { PlusIcon, SearchIcon } from "../ui/Icons";
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);
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

  // Close mobile category sheet on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCategorySheetOpen(false);
      }
    }
    if (isCategorySheetOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCategorySheetOpen]);

  // Smoothly center the active category pill into view on mobile horizontal rail
  useEffect(() => {
    if (!categoryNavRef.current) return;
    const activeBtn = categoryNavRef.current.querySelector<HTMLElement>(`.${styles.categoryItemActive}`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [categoryId]);

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

        {/* Mobile Category Trigger (Opens full discoverable category sheet) */}
        <div className={styles.mobileCategoryBar}>
          <button
            type="button"
            className={styles.mobileCategorySelectorBtn}
            onClick={() => setIsCategorySheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isCategorySheetOpen}
            aria-label="Browse all menu categories in full list"
          >
            <span className={styles.selectorIcon} aria-hidden="true">☰</span>
            <span className={styles.selectorLabel}>{activeCategoryName}</span>
            <span className={styles.selectorBadge}>{categories.length}</span>
            <span className={styles.selectorChevron} aria-hidden="true">▾</span>
          </button>

          {/* Mobile Quick Category Rail */}
          <nav ref={categoryNavRef} className={styles.categoryNav} aria-label="Filter by category">
            <button
              type="button"
              className={`${styles.categoryItem} ${categoryId === null ? styles.categoryItemActive : ""}`}
              onClick={() => updateQuery({ category: null })}
              aria-pressed={categoryId === null}
            >
              <span>All</span>
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
                  <span>{category.name}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Accessible Mobile Category Bottom Sheet Dialog */}
      {isCategorySheetOpen && (
        <div
          className={styles.sheetOverlay}
          onClick={() => setIsCategorySheetOpen(false)}
          aria-hidden="true"
        >
          <div
            className={styles.sheetDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetHeader}>
              <h3 id="category-sheet-title">Select Menu Category</h3>
              <button
                type="button"
                className={styles.sheetCloseBtn}
                onClick={() => setIsCategorySheetOpen(false)}
                aria-label="Close category list"
              >
                ✕
              </button>
            </div>
            <div className={styles.sheetCategoryList} role="listbox" aria-label="Menu categories">
              <button
                type="button"
                className={`${styles.sheetCategoryItem} ${categoryId === null ? styles.sheetCategoryItemActive : ""}`}
                onClick={() => {
                  updateQuery({ category: null });
                  setIsCategorySheetOpen(false);
                }}
                role="option"
                aria-selected={categoryId === null}
              >
                <span className={styles.sheetCategoryName}>All Categories</span>
                {categoryId === null && <span className={styles.activeCheckmark} aria-hidden="true">✓</span>}
              </button>
              {categories.map((cat) => {
                const isActive = categoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`${styles.sheetCategoryItem} ${isActive ? styles.sheetCategoryItemActive : ""}`}
                    onClick={() => {
                      updateQuery({ category: cat.id });
                      setIsCategorySheetOpen(false);
                    }}
                    role="option"
                    aria-selected={isActive}
                  >
                    <span className={styles.sheetCategoryName}>{cat.name}</span>
                    {isActive && <span className={styles.activeCheckmark} aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
          {products.map((product) => (
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
                {product.image_url ? (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    sizes="(max-width: 680px) 84px, 104px"
                    fill
                  />
                ) : (
                  <span className={styles.imageFallback} aria-label={`${product.name} image pending`}>
                    {product.name.slice(0, 1)}
                  </span>
                )}
              </Link>

              <div className={styles.cardBody}>
                <Link href={`/menu/${product.id}`} className={styles.itemDetails}>
                  <h2>{product.name}</h2>
                  <p>{product.description || "Freshly prepared and ready to enjoy."}</p>
                </Link>
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
          ))}
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
