"use client";

/**
 * Lightweight Stale-While-Revalidate (SWR) cache backed by an in-memory Map
 * (instant SPA navigation) and window.localStorage (instant repeat loads on any device).
 * Designed for useSyncExternalStore with referentially stable snapshots.
 */

const STORAGE_PREFIX = "sb_swr_v1:";
const MAX_STALE_MS = 24 * 60 * 60 * 1000; // Keep cached entries up to 24h for instant repeat paint
const DEFAULT_FRESH_MS = 30 * 1000; // Silently revalidate in background after 30s

type CacheRecord<T> = {
  data: T;
  serialized: string;
  cachedAt: number;
};

const memoryStore = new Map<string, CacheRecord<unknown>>();
const inflightRequests = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
const hydratedFromStorage = new Set<string>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSwrCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hydrateKeyFromStorage<T>(key: string): CacheRecord<T> | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (hydratedFromStorage.has(key)) {
    return memoryStore.get(key) as CacheRecord<T> | undefined;
  }
  hydratedFromStorage.add(key);

  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CacheRecord<T>>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.cachedAt !== "number" ||
      !("data" in parsed)
    ) {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return undefined;
    }
    if (Date.now() - parsed.cachedAt > MAX_STALE_MS) {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return undefined;
    }
    const serialized =
      typeof parsed.serialized === "string" ? parsed.serialized : JSON.stringify(parsed.data);
    const record: CacheRecord<T> = {
      data: parsed.data as T,
      serialized,
      cachedAt: parsed.cachedAt,
    };
    memoryStore.set(key, record);
    return record;
  } catch {
    return undefined;
  }
}

/**
 * Returns a referentially stable snapshot for React useSyncExternalStore, or null on cache miss.
 */
export function getSwrSnapshot<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  const existing = (memoryStore.get(key) as CacheRecord<T> | undefined) ?? hydrateKeyFromStorage<T>(key);
  if (!existing) {
    return null;
  }
  if (Date.now() - existing.cachedAt > MAX_STALE_MS) {
    memoryStore.delete(key);
    try {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } catch {
      // Ignore storage quota / privacy errors.
    }
    return null;
  }
  return existing.data;
}

export function isSwrFresh(key: string, freshMs: number = DEFAULT_FRESH_MS): boolean {
  if (typeof window === "undefined") return false;
  const existing = (memoryStore.get(key) as CacheRecord<unknown> | undefined) ?? hydrateKeyFromStorage(key);
  if (!existing) return false;
  return Date.now() - existing.cachedAt <= freshMs;
}

export function writeSwrValue<T>(key: string, data: T): T {
  const serialized = JSON.stringify(data);
  const now = Date.now();
  const prev = memoryStore.get(key);

  if (prev && prev.serialized === serialized) {
    // Bump cachedAt without breaking object reference identity if data is identical
    prev.cachedAt = now;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(prev));
      } catch {
        // Ignore storage write errors.
      }
    }
    return prev.data as T;
  }

  const record: CacheRecord<T> = { data, serialized, cachedAt: now };
  memoryStore.set(key, record);
  hydratedFromStorage.add(key);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(record));
    } catch {
      // Ignore storage quota / privacy errors.
    }
  }
  notifyListeners();
  return data;
}

/**
 * Fetch and cache with in-flight request deduplication.
 */
export function fetchWithSwrCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { freshMs?: number; force?: boolean } = {}
): Promise<T> {
  const freshMs = options.freshMs ?? DEFAULT_FRESH_MS;
  if (!options.force && typeof window !== "undefined") {
    const existing = (memoryStore.get(key) as CacheRecord<T> | undefined) ?? hydrateKeyFromStorage<T>(key);
    if (existing && Date.now() - existing.cachedAt <= freshMs) {
      return Promise.resolve(existing.data);
    }
  }

  const pending = inflightRequests.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }

  const requestPromise = fetcher()
    .then((freshData) => writeSwrValue(key, freshData))
    .finally(() => {
      inflightRequests.delete(key);
    });

  inflightRequests.set(key, requestPromise);
  return requestPromise;
}

/**
 * Immediately invalidate all memory + localStorage entries sharing a prefix (e.g., "catalog:", "settings:").
 */
export function invalidateSwrPrefix(prefix: string): void {
  let removedAny = false;
  for (const key of Array.from(memoryStore.keys())) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key);
      hydratedFromStorage.delete(key);
      removedAny = true;
    }
  }

  if (typeof window !== "undefined") {
    try {
      const storagePrefix = `${STORAGE_PREFIX}${prefix}`;
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(storagePrefix)) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) {
        window.localStorage.removeItem(k);
        hydratedFromStorage.delete(k.slice(STORAGE_PREFIX.length));
        removedAny = true;
      }
    } catch {
      // Ignore storage cleanup errors.
    }
  }

  if (removedAny) {
    notifyListeners();
  }
}
