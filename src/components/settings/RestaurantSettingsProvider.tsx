"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { getLiveOperatingStatus, RESTAURANT_INFO } from "../../config/restaurant";
import {
  getPublicRestaurantSettings,
  PUBLIC_SETTINGS_CACHE_KEY,
} from "../../lib/api/staff";
import { useSwrValue } from "../../lib/useSwrValue";
import type { PublicRestaurantSettingsResponse } from "../../types/staff";

const SETTINGS_CHANGED_EVENT = "savorybites-restaurant-settings-changed";

export function notifyRestaurantSettingsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
  }
}

function buildFallbackSettings(): PublicRestaurantSettingsResponse {
  const live = getLiveOperatingStatus();
  return {
    restaurant: {
      name: RESTAURANT_INFO.name,
      tagline: RESTAURANT_INFO.tagline,
      locality: RESTAURANT_INFO.locality,
      full_address: RESTAURANT_INFO.fullAddress,
      phone: RESTAURANT_INFO.phone,
      email: RESTAURANT_INFO.email,
      timezone: RESTAURANT_INFO.timeZone,
      kitchen_cutoff_minutes: 30,
      kitchen_notice: RESTAURANT_INFO.kitchenNotice,
      holiday_notice: RESTAURANT_INFO.holidayNotice,
    },
    hours: RESTAURANT_INFO.schedule.map((d) => ({
      day_of_week: d.dayIndex,
      day_name: d.day,
      short_day: d.shortDay,
      is_open: d.isOpen,
      open_time: `${String(d.openHour24).padStart(2, "0")}:${String(d.openMinute).padStart(2, "0")}`,
      close_time: `${String(d.closeHour24).padStart(2, "0")}:${String(d.closeMinute).padStart(2, "0")}`,
    })),
    ordering: {
      online_ordering_enabled: true,
      online_ordering_pause_reason: null,
      dine_in_enabled: true,
      takeout_enabled: true,
      enforce_operating_hours: false,
      kitchen_cutoff_minutes: 30,
      minimum_order_amount: 0,
    },
    is_currently_open: live.isOpen,
    operating_status_text: live.statusText,
  };
}

type RestaurantSettingsContextValue = {
  settings: PublicRestaurantSettingsResponse;
  refresh: () => void;
};

const FALLBACK_SETTINGS = buildFallbackSettings();

const RestaurantSettingsContext = createContext<RestaurantSettingsContextValue>({
  settings: FALLBACK_SETTINGS,
  refresh: () => {},
});

export function RestaurantSettingsProvider({ children }: { children: ReactNode }) {
  const cachedSettings = useSwrValue<PublicRestaurantSettingsResponse>(PUBLIC_SETTINGS_CACHE_KEY);
  const [reloadNonce, setReloadNonce] = useState(0);

  const refresh = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getPublicRestaurantSettings(controller.signal, { force: reloadNonce > 0 })
      .catch(() => {
        // Keep fallback values cleanly when API is unreachable during startup
      });
    return () => controller.abort();
  }, [reloadNonce]);

  useEffect(() => {
    function handleExternalUpdate() {
      setReloadNonce((n) => n + 1);
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, handleExternalUpdate);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handleExternalUpdate);
  }, []);

  const settings = cachedSettings ?? FALLBACK_SETTINGS;

  return (
    <RestaurantSettingsContext.Provider value={{ settings, refresh }}>
      {children}
    </RestaurantSettingsContext.Provider>
  );
}

export function useRestaurantSettings(): RestaurantSettingsContextValue {
  return useContext(RestaurantSettingsContext);
}
