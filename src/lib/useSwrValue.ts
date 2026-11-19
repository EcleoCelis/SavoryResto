"use client";

import { useCallback, useSyncExternalStore } from "react";

import { getSwrSnapshot, subscribeSwrCache } from "./swrCache";

const getServerNull = () => null;

/**
 * Subscribe cleanly to an SWR cache entry without SSR hydration mismatches or synchronous useEffect setState.
 */
export function useSwrValue<T>(key: string): T | null {
  const getSnapshot = useCallback(() => getSwrSnapshot<T>(key), [key]);
  return useSyncExternalStore(subscribeSwrCache, getSnapshot, getServerNull);
}
