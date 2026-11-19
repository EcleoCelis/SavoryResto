import type {
  Category,
  CategoryCreateInput,
  CategoryDetail,
  CategoryUpdateInput,
  DishImageUploadResponse,
  Product,
  ProductCreateInput,
  ProductOption,
  ProductUpdateInput,
} from "../../types/product";
import {
  fetchWithSwrCache,
  getSwrSnapshot,
  invalidateSwrPrefix,
} from "../swrCache";
import { getStaffApiUrl, getStaffToken, StaffApiError } from "./staff";

type ProductOptionApiResponse = Omit<ProductOption, "price_adjustment"> & { price_adjustment: number | string };
type ProductApiResponse = Omit<Product, "price" | "sizes" | "addons"> & {
  price: number | string;
  sizes: ProductOptionApiResponse[];
  addons: ProductOptionApiResponse[];
};

async function request<T>(path: string): Promise<T> {
  const baseUrl = getStaffApiUrl();
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error("Unable to load the restaurant catalog.");
  return response.json() as Promise<T>;
}

async function managerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getStaffApiUrl();
  const token = getStaffToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null && "detail" in data ? (data as { detail: unknown }).detail : null;
    throw new StaffApiError(response.status, typeof detail === "string" ? detail : "Operation failed.");
  }
  return data as T;
}

export const CATEGORIES_CACHE_KEY = "catalog:categories";

export function getCategories(options: { force?: boolean } = {}) {
  return fetchWithSwrCache(
    CATEGORIES_CACHE_KEY,
    () => request<Category[]>("/api/v1/categories"),
    { freshMs: 45_000, force: options.force }
  );
}

export function getCachedCategories(): Category[] | null {
  return getSwrSnapshot<Category[]>(CATEGORIES_CACHE_KEY);
}

export function getManagerCategories() {
  return managerRequest<CategoryDetail[]>("/api/v1/categories/manage");
}

export function createCategory(input: CategoryCreateInput) {
  return managerRequest<CategoryDetail>("/api/v1/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    invalidateSwrPrefix("catalog:");
    return res;
  });
}

export function updateCategory(id: number, input: CategoryUpdateInput) {
  return managerRequest<CategoryDetail>(`/api/v1/categories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => {
    invalidateSwrPrefix("catalog:");
    return res;
  });
}

export function deleteCategory(id: number) {
  return managerRequest<{ message: string }>(`/api/v1/categories/${id}`, {
    method: "DELETE",
  }).then((res) => {
    invalidateSwrPrefix("catalog:");
    return res;
  });
}

export type ProductQuery = {
  categoryId?: number | null;
  search?: string;
  availability?: "available" | "unavailable" | "all";
};

function buildProductsSuffix(query: ProductQuery = {}): string {
  const params = new URLSearchParams();
  if (query.categoryId) params.set("category_id", String(query.categoryId));
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.availability) params.set("availability", query.availability);
  return params.size > 0 ? `?${params}` : "";
}

export function getProductsCacheKey(query: ProductQuery = {}): string {
  return `catalog:products:${buildProductsSuffix(query) || "default"}`;
}

export function getCachedProducts(query: ProductQuery = {}): Product[] | null {
  return getSwrSnapshot<Product[]>(getProductsCacheKey(query));
}

export function getProducts(query: ProductQuery = {}, options: { force?: boolean } = {}) {
  const suffix = buildProductsSuffix(query);
  const cacheKey = getProductsCacheKey(query);
  return fetchWithSwrCache(
    cacheKey,
    () =>
      request<ProductApiResponse[]>(`/api/v1/products${suffix}`).then((products) =>
        products.map(normalizeProduct)
      ),
    { freshMs: 30_000, force: options.force }
  );
}

export function getManagerProducts(query: ProductQuery = {}) {
  const suffix = buildProductsSuffix(query);
  return managerRequest<ProductApiResponse[]>(`/api/v1/products/manage${suffix}`).then((products) =>
    products.map(normalizeProduct),
  );
}

export function getProductCacheKey(productId: string): string {
  return `catalog:product:${productId}`;
}

export function getCachedProduct(productId: string): Product | null {
  return getSwrSnapshot<Product>(getProductCacheKey(productId));
}

export function getProduct(productId: string, options: { force?: boolean } = {}) {
  return fetchWithSwrCache(
    getProductCacheKey(productId),
    () =>
      request<ProductApiResponse>(`/api/v1/products/${encodeURIComponent(productId)}`).then(
        normalizeProduct
      ),
    { freshMs: 30_000, force: options.force }
  );
}

export function createProduct(input: ProductCreateInput) {
  return managerRequest<ProductApiResponse>("/api/v1/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
    .then(normalizeProduct)
    .then((res) => {
      invalidateSwrPrefix("catalog:");
      return res;
    });
}

export function updateProduct(id: number, input: ProductUpdateInput) {
  return managerRequest<ProductApiResponse>(`/api/v1/products/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
    .then(normalizeProduct)
    .then((res) => {
      invalidateSwrPrefix("catalog:");
      return res;
    });
}

export function toggleProductAvailability(id: number, is_available: boolean) {
  return managerRequest<ProductApiResponse>(`/api/v1/products/${id}/availability`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_available }),
  })
    .then(normalizeProduct)
    .then((res) => {
      invalidateSwrPrefix("catalog:");
      return res;
    });
}

export function deleteProduct(id: number) {
  return managerRequest<{ message: string }>(`/api/v1/products/${id}`, {
    method: "DELETE",
  }).then((res) => {
    invalidateSwrPrefix("catalog:");
    return res;
  });
}

export async function uploadDishImage(file: File): Promise<DishImageUploadResponse> {
  const baseUrl = getStaffApiUrl();
  const token = getStaffToken();
  const formData = new FormData();
  formData.append("file", file);

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl}/api/v1/products/upload-image`, {
    method: "POST",
    credentials: "include",
    headers,
    body: formData,
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? (data as { detail: unknown }).detail
        : null;
    throw new StaffApiError(
      response.status,
      typeof detail === "string" ? detail : "Failed to upload image file."
    );
  }
  return data as DishImageUploadResponse;
}

export async function deleteUploadedDishImage(imageUrl: string): Promise<{ deleted: boolean }> {
  const baseUrl = getStaffApiUrl();
  const token = getStaffToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(
    `${baseUrl}/api/v1/products/upload-image?image_url=${encodeURIComponent(imageUrl)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers,
    }
  );

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? (data as { detail: unknown }).detail
        : null;
    throw new StaffApiError(
      response.status,
      typeof detail === "string" ? detail : "Failed to remove image."
    );
  }
  return data as { deleted: boolean };
}

function normalizeProduct(product: ProductApiResponse): Product {
  const price = Number(product.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("The restaurant catalog returned an invalid product price.");
  }

  return {
    ...product,
    price,
    sizes: product.sizes.map(normalizeOption),
    addons: product.addons.map(normalizeOption),
  };
}

function normalizeOption(option: ProductOptionApiResponse): ProductOption {
  const priceAdjustment = Number(option.price_adjustment);
  if (!option.code.trim() || !option.label.trim() || !Number.isFinite(priceAdjustment) || priceAdjustment < 0) {
    throw new Error("The restaurant catalog returned an invalid product option.");
  }
  return { ...option, price_adjustment: priceAdjustment };
}
