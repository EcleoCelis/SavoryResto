"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import styles from "../../app/menu/menu.module.css";
import { getProduct } from "../../lib/api/products";
import type { Product } from "../../types/product";
import { ProductOrderPanel } from "./ProductOrderPanel";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export function ProductDetail({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProduct(productId)
      .then((loadedProduct) => {
        if (active) setProduct(loadedProduct);
      })
      .catch(() => {
        if (active) setError("This menu dish is currently unavailable.");
      });
    return () => {
      active = false;
    };
  }, [productId]);

  if (error) {
    return (
      <div className={styles.catalogMessage} role="alert">
        <p>{error}</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className={styles.catalogMessage} aria-live="polite">
        <p>Loading dish details...</p>
      </div>
    );
  }

  return (
    <article className={styles.detail} aria-labelledby="product-name">
      <div className={styles.detailImage}>
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            priority
            fill
            sizes="(max-width: 820px) 100vw, 480px"
          />
        ) : (
          <div
            className={styles.detailImageFallback}
            aria-label={`${product.name} image pending`}
          >
            {product.name.slice(0, 1)}
          </div>
        )}
      </div>

      <div>
        <span className={styles.detailCategory}>{product.category.name}</span>
        <h1 id="product-name">{product.name}</h1>
        <p className={styles.detailDescription}>
          {product.description || "Freshly prepared and made to order with quality ingredients."}
        </p>
        <b className={styles.detailPrice}>
          From {currencyFormatter.format(product.price)}
        </b>

        <ProductOrderPanel item={product} />
      </div>
    </article>
  );
}
