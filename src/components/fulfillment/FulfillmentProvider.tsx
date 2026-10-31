"use client";

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";

import { FULFILLMENT_STORAGE_KEY, FULFILLMENT_UPDATED_EVENT, clearFulfillment, loadFulfillment, saveFulfillment } from "../../lib/fulfillment";
import type { FulfillmentSelection } from "../../types/fulfillment";

type FulfillmentContextValue = {
  selection: FulfillmentSelection | null;
  setSelection: (selection: FulfillmentSelection) => void;
  clearSelection: () => void;
};

const FulfillmentContext = createContext<FulfillmentContextValue | null>(null);
let cachedSelection: FulfillmentSelection | null | undefined;

function getFulfillmentSnapshot() {
  if (cachedSelection === undefined) cachedSelection = loadFulfillment();
  return cachedSelection;
}

function getServerSnapshot() {
  return null;
}

function subscribe(onStoreChange: () => void) {
  const update = () => {
    cachedSelection = loadFulfillment();
    onStoreChange();
  };
  const storage = (event: StorageEvent) => { if (event.key === FULFILLMENT_STORAGE_KEY) update(); };
  window.addEventListener(FULFILLMENT_UPDATED_EVENT, update);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(FULFILLMENT_UPDATED_EVENT, update); window.removeEventListener("storage", storage); };
}

export function FulfillmentProvider({ children }: { children: ReactNode }) {
  const selection = useSyncExternalStore(subscribe, getFulfillmentSnapshot, getServerSnapshot);

  function setSelection(nextSelection: FulfillmentSelection) {
    cachedSelection = nextSelection;
    saveFulfillment(nextSelection);
  }

  function clearSelection() {
    cachedSelection = null;
    clearFulfillment();
  }

  return <FulfillmentContext value={{ selection, setSelection, clearSelection }}>{children}</FulfillmentContext>;
}

export function useFulfillment() {
  const fulfillment = useContext(FulfillmentContext);
  if (fulfillment === null) throw new Error("useFulfillment must be used within FulfillmentProvider.");
  return fulfillment;
}
