"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import styles from "../../app/menu/menu.module.css";
import { useAuth } from "../auth/AuthProvider";
import {
  addCustomerFavorite,
  getCustomerFavorites,
  getCustomerProfile,
  removeCustomerFavorite,
} from "../../lib/api/customer";
import { getProduct, getProductCacheKey } from "../../lib/api/products";
import { detectDishConflicts } from "../../lib/personalization";
import { useSwrValue } from "../../lib/useSwrValue";
import type { CustomerProfile } from "../../types/customer";
import type { Product } from "../../types/product";
import { HeartIcon } from "../ui/Icons";
import { AllergyConflictNotice } from "./AllergyConflictNotice";
import { ProductOrderPanel } from "./ProductOrderPanel";

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export function ProductDetail({ productId }: { productId: string }) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const product = useSwrValue<Product>(getProductCacheKey(productId));
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProduct(productId)
      .then(() => {
        if (active) setError("");
      })
      .catch(() => {
        if (active) setError("This menu dish is currently unavailable.");
      });
    return () => {
      active = false;
    };
  }, [productId]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let active = true;
    const numericId = Number(productId);
    void Promise.all([getCustomerFavorites(), getCustomerProfile()])
      .then(([favorites, profile]) => {
        if (!active) return;
        setIsFavorite(favorites.some((fav) => fav.product_id === numericId));
        setCustomerProfile(profile);
      })
      .catch(() => {
        // Ignore silent personalization load errors on dish page.
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, productId]);

  const activeIsFavorite = isAuthenticated ? isFavorite : false;
  const activeCustomerProfile = isAuthenticated ? customerProfile : null;

  async function handleToggleFavorite() {
    if (!product) return;
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(`/menu/${product.id}`)}`);
      return;
    }
    setFavoriteBusy(true);
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      if (next) {
        await addCustomerFavorite(product.id);
      } else {
        await removeCustomerFavorite(product.id);
      }
    } catch {
      setIsFavorite(!next);
    } finally {
      setFavoriteBusy(false);
    }
  }

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

  const conflicts = detectDishConflicts(product, activeCustomerProfile);

  return (
    <article className={styles.detail} aria-labelledby="product-name">
      <div className={styles.detailImage}>
        {product.image_url && failedImageUrl !== product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            priority
            fill
            sizes="(max-width: 820px) 100vw, 480px"
            onError={() => setFailedImageUrl(product.image_url)}
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
        <div className={styles.detailTitleRow}>
          <h1 id="product-name">{product.name}</h1>
          <button
            type="button"
            className={`${styles.favoriteBtn} ${activeIsFavorite ? styles.favoriteBtnActive : ""}`}
            onClick={() => void handleToggleFavorite()}
            disabled={favoriteBusy}
            aria-label={activeIsFavorite ? `Remove ${product.name} from favorites` : `Save ${product.name} to favorites`}
            aria-pressed={activeIsFavorite}
          >
            <HeartIcon size={18} filled={activeIsFavorite} />
          </button>
        </div>
        <p className={styles.detailDescription}>
          {product.description || "Freshly prepared and made to order with quality ingredients."}
        </p>

        {product.ingredient_names && product.ingredient_names.length > 0 && (
          <div className={styles.ingredientsBlock}>
            <span className={styles.ingredientsLabel}>Recipe Ingredients</span>
            <div className={styles.ingredientPills}>
              {product.ingredient_names.map((ing) => (
                <span key={ing} className={styles.ingredientPill}>
                  {ing}
                </span>
              ))}
            </div>
          </div>
        )}

        <AllergyConflictNotice conflicts={conflicts} />

        <b className={styles.detailPrice}>
          From {currencyFormatter.format(product.price)}
        </b>

        <ProductOrderPanel item={product} />
      </div>
    </article>
  );
}
