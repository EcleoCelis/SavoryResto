import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const scriptSrc = isProduction
  ? "'self' 'unsafe-inline'"
  : "'self' 'unsafe-inline' 'unsafe-eval'";

function normalizeOriginUrl(rawValue: string | undefined): URL | null {
  if (!rawValue) return null;
  const cleaned = rawValue
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!cleaned) return null;

  const withScheme = /^https?:\/\//i.test(cleaned)
    ? cleaned
    : /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(cleaned)
      ? `http://${cleaned}`
      : `https://${cleaned}`;

  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

const parsedApiUrl = normalizeOriginUrl(process.env.NEXT_PUBLIC_API_URL);
const parsedBackendInternalUrl = normalizeOriginUrl(
  process.env.BACKEND_INTERNAL_URL
);

if (process.env.BACKEND_INTERNAL_URL?.trim() && !parsedBackendInternalUrl) {
  throw new Error(
    "Invalid BACKEND_INTERNAL_URL environment variable. Provide a valid backend origin such as https://your-service.onrender.com."
  );
}

const devLoopbackOrigins = isProduction
  ? []
  : [
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      "http://localhost:8001",
      "http://127.0.0.1:8001",
    ];

const connectSrc = Array.from(
  new Set([
    "'self'",
    ...devLoopbackOrigins,
    ...(parsedApiUrl ? [parsedApiUrl.origin] : []),
  ])
).join(" ");

const imgSrc = Array.from(
  new Set([
    "'self'",
    "data:",
    "blob:",
    ...devLoopbackOrigins,
    ...(parsedApiUrl ? [parsedApiUrl.origin] : []),
  ])
).join(" ");

const cspHeader = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `img-src ${imgSrc}`,
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "http",
    hostname: "localhost",
  },
  {
    protocol: "http",
    hostname: "127.0.0.1",
  },
];

if (
  parsedApiUrl &&
  (parsedApiUrl.protocol === "http:" || parsedApiUrl.protocol === "https:")
) {
  remotePatterns.push({
    protocol: parsedApiUrl.protocol === "https:" ? "https" : "http",
    hostname: parsedApiUrl.hostname,
    ...(parsedApiUrl.port ? { port: parsedApiUrl.port } : {}),
  });
}

const nextConfig: NextConfig = {
  distDir: isProduction ? ".next" : ".next-dev",
  ...(isProduction ? { output: "standalone" as const } : {}),
  // Permit local testing through the loopback IP as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  reactCompiler: true,
  poweredByHeader: false,
  images: {
    remotePatterns,
  },
  async redirects() {
    return [
      {
        source: "/manager/inventory",
        destination: "/manager/menu",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const backendOrigin =
      parsedBackendInternalUrl?.origin ||
      parsedApiUrl?.origin ||
      "http://127.0.0.1:8001";
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },

  async headers() {
    const headers = [
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      {
        key: "Content-Security-Policy",
        value: cspHeader,
      },
    ];

    // Only apply HSTS in production HTTPS environments
    if (isProduction && process.env.ENABLE_HSTS === "true") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    return [
      {
        source: "/(.*)",
        headers,
      },
    ];
  },
};

export default nextConfig;
