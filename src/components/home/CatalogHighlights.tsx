"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "../../app/home.module.css";
import {
  CATEGORIES_CACHE_KEY,
  getCategories,
  getProducts,
  getProductsCacheKey,
} from "../../lib/api/products";
import { useSwrValue } from "../../lib/useSwrValue";
import { ArrowRightIcon } from "../ui/Icons";
import type { Category, Product } from "../../types/product";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const categoryImages: Record<string, string> = {
  Burgers: "/images/front-view-burgers-stand.jpg",
  Chicken: "/images/delicious-crispy-chicken-nuggets-with-garlic-dip-wooden-table.jpg",
  Pasta: "/images/appetizing-pasta-with-tomato-sauce-parmesan-plate-closeup.jpg",
  "Rice Meals": "/images/close-up-fresh-boiled-rice-basil-leaves-fried-chicken-bowl-with-wooden-spoon.jpg",
  Pizza: "/images/pizza.jpg",
  Salads: "/images/salad.jpg",
};

export function BestSellers() {
  const cachedProducts = useSwrValue<Product[]>(getProductsCacheKey());
  const [settled, setSettled] = useState(false);
  const [failedImageIds, setFailedImageIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let active = true;
    void getProducts()
      .catch(() => undefined)
      .finally(() => {
        if (active) setSettled(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const products = (cachedProducts ?? []).slice(0, 3);
  const loading = !settled && cachedProducts === null;

  return (
    <section className={styles.bestsellers} aria-labelledby="featured-dishes-title">
      <header>
        <p className={styles.kicker}>From our kitchen</p>
        <h2 id="featured-dishes-title">Featured Menu Favorites</h2>
        <p>A handpicked selection of our most loved specialties, prepared fresh daily.</p>
      </header>

      {loading ? (
        <p className={styles.catalogFallback} aria-live="polite">
          Loading our featured dishes...
        </p>
      ) : products.length > 0 ? (
        <div>
          {products.map((product) => (
            <article key={product.id}>
              <div className={styles.highlightImage}>
                {product.image_url && !failedImageIds.has(product.id) ? (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    loading="eager"
                    sizes="(max-width: 850px) 100vw, 33vw"
                    onError={() => {
                      setFailedImageIds((prev) => new Set(prev).add(product.id));
                    }}
                  />
                ) : (
                  <span aria-label={`${product.name} image pending`}>
                    {product.name.slice(0, 1)}
                  </span>
                )}
              </div>
              <h3>{product.name}</h3>
              <p>{product.description || "Freshly prepared and ready to enjoy."}</p>
              <footer>
                <b>{currencyFormatter.format(product.price)}</b>
                <Link href={`/menu/${product.id}`} aria-label={`View dish details for ${product.name}`}>
                  <span>View dish</span>
                  <ArrowRightIcon size={14} style={{ display: "inline", marginLeft: "4px", verticalAlign: "-2px" }} />
                </Link>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.catalogFallback}>
          Catalog highlights are temporarily unavailable.
        </p>
      )}

      <Link href="/menu" className={styles.outline}>
        View full menu
      </Link>
    </section>
  );
}

export function PopularCategories() {
  const cachedCategories = useSwrValue<Category[]>(CATEGORIES_CACHE_KEY);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let active = true;
    void getCategories()
      .catch(() => undefined)
      .finally(() => {
        if (active) setSettled(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const categories = (cachedCategories ?? []).slice(0, 6);
  const loading = !settled && cachedCategories === null;

  return (
    <section className={styles.cream} aria-labelledby="categories-title">
      <header>
        <p className={styles.kicker}>What we serve</p>
        <h2 id="categories-title">Browse Our Menu</h2>
        <p>Explore comforting flavors crafted with fresh ingredients and genuine culinary passion.</p>
      </header>

      {loading ? (
        <p className={styles.catalogFallback} aria-live="polite">
          Loading categories...
        </p>
      ) : categories.length > 0 ? (
        <div className={styles.categories}>
          {categories.map((category) => {
            const image = categoryImages[category.name];
            return (
              <Link key={category.id} href={`/menu?category=${category.id}`}>
                {image ? (
                  <span className={styles.categoryImage}>
                    <Image
                      src={image}
                      alt={category.name}
                      fill
                      loading="eager"
                      sizes="(max-width: 520px) 42vw, (max-width: 850px) 28vw, 15vw"
                    />
                  </span>
                ) : (
                  <span className={styles.categoryInitial} aria-hidden="true">
                    {category.name.slice(0, 1)}
                  </span>
                )}
                <b>{category.name}</b>
                <small>Explore dishes</small>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className={styles.catalogFallback}>
          Categories are temporarily unavailable.
        </p>
      )}
    </section>
  );
}
