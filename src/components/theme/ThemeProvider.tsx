"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/AuthProvider";
import type { ThemePreference } from "../../types/auth";

export const THEME_STORAGE_KEY = "savorybites_theme_preference";

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: "light" | "dark";
  setThemePreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isValidTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function subscribeSystemTheme(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSystemThemeSnapshot(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getSystemThemeServerSnapshot(): "light" | "dark" {
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [manualTheme, setManualTheme] = useState<ThemePreference | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (isValidTheme(stored)) {
          return stored;
        }
      } catch {
        // Ignore storage read errors.
      }
    }
    return null;
  });

  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    getSystemThemeServerSnapshot,
  );

  const userTheme = isValidTheme(user?.theme_preference) ? user.theme_preference : null;
  const theme: ThemePreference = manualTheme ?? userTheme ?? "system";
  const resolvedTheme: "light" | "dark" = theme === "system" ? systemTheme : theme;

  const setThemePreference = useCallback((next: ThemePreference) => {
    setManualTheme(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage write errors.
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.resolvedTheme = resolvedTheme;
  }, [resolvedTheme, theme]);

  useEffect(() => {
    if (!userTheme || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, userTheme);
    } catch {
      // Ignore storage write errors.
    }
  }, [userTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
