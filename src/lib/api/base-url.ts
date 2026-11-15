/**
 * Resolve the backend API base URL safely across local dev and staging proxies.
 * Returns "" (relative same-origin) when NEXT_PUBLIC_API_URL is omitted, and aligns
 * localhost / 127.0.0.1 hostnames in the browser to keep SameSite=Lax cookies intact.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "") || "";
  if (!configured) {
    return "";
  }

  if (typeof window !== "undefined") {
    try {
      const parsed = new URL(configured);
      const isConfiguredLoopback =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      const isBrowserLoopback =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      if (isConfiguredLoopback && isBrowserLoopback) {
        parsed.hostname = window.location.hostname;
        return parsed.origin;
      }
      return configured;
    } catch {
      return configured;
    }
  }

  return configured;
}
