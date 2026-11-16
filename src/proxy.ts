import { NextResponse, type NextRequest } from "next/server";

const STAFF_COOKIE = "staff_access_token";
const CUSTOMER_COOKIE = "access_token";

function normalizeOrigin(rawValue: string | undefined): URL | null {
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

function getBackendOrigin(): string {
  const internalUrl = normalizeOrigin(process.env.BACKEND_INTERNAL_URL);
  if (internalUrl) return internalUrl.origin;
  const publicUrl = normalizeOrigin(process.env.NEXT_PUBLIC_API_URL);
  if (publicUrl) return publicUrl.origin;
  return "http://127.0.0.1:8001";
}

function isCrossOriginApi(request: NextRequest): boolean {
  const publicUrl = normalizeOrigin(process.env.NEXT_PUBLIC_API_URL);
  if (!publicUrl) return false;
  const reqHost = request.nextUrl.hostname.toLowerCase();
  const apiHost = publicUrl.hostname.toLowerCase();
  const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
  if (loopbackHosts.has(reqHost) && loopbackHosts.has(apiHost)) {
    return false;
  }
  return reqHost !== apiHost;
}

function applyNoCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

async function fetchVerifiedRole(
  backendOrigin: string,
  cookieName: string,
  cookieValue: string,
  endpoint: string,
): Promise<{ valid: boolean; role?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${backendOrigin}${endpoint}`, {
      method: "GET",
      headers: {
        Cookie: `${cookieName}=${cookieValue}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { valid: false };
    }
    const data = (await res.json().catch(() => null)) as { role?: string } | null;
    return { valid: true, role: data?.role };
  } catch {
    // If backend is temporarily unreachable from Next server, defer to client guard.
    return { valid: true, role: undefined };
  }
}

function redirectAccessDenied(
  request: NextRequest,
  portal: "manager" | "kds" | "customer",
  role: string,
): NextResponse {
  const deniedUrl = new URL("/access-denied", request.url);
  deniedUrl.searchParams.set("portal", portal);
  deniedUrl.searchParams.set("role", role);
  return applyNoCacheHeaders(NextResponse.redirect(deniedUrl));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const backendOrigin = getBackendOrigin();
  const staffCookie = request.cookies.get(STAFF_COOKIE)?.value;
  const customerCookie = request.cookies.get(CUSTOMER_COOKIE)?.value;
  const crossOrigin = isCrossOriginApi(request);

  const isManagerRoute = pathname.startsWith("/manager");
  const isKdsRoute = pathname.startsWith("/kds");
  const isCustomerRoute =
    pathname.startsWith("/customer") ||
    pathname.startsWith("/orders") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/payment") ||
    pathname.startsWith("/order-confirmation");

  if (isManagerRoute || isKdsRoute) {
    const targetPortal: "manager" | "kds" = isManagerRoute ? "manager" : "kds";
    const requiredRole = isManagerRoute ? "manager" : "kitchen_staff";

    if (staffCookie) {
      const staffSession = await fetchVerifiedRole(
        backendOrigin,
        STAFF_COOKIE,
        staffCookie,
        "/api/v1/staff/auth/me",
      );

      if (!staffSession.valid) {
        const res = NextResponse.redirect(new URL("/staff/login", request.url));
        res.cookies.delete(STAFF_COOKIE);
        return applyNoCacheHeaders(res);
      }

      if (staffSession.role && staffSession.role !== requiredRole) {
        return redirectAccessDenied(request, targetPortal, staffSession.role);
      }

      return applyNoCacheHeaders(NextResponse.next());
    }

    if (customerCookie) {
      const custSession = await fetchVerifiedRole(
        backendOrigin,
        CUSTOMER_COOKIE,
        customerCookie,
        "/api/v1/auth/me",
      );
      if (custSession.valid) {
        return redirectAccessDenied(request, targetPortal, "customer");
      }
      const res = NextResponse.redirect(new URL("/staff/login", request.url));
      res.cookies.delete(CUSTOMER_COOKIE);
      return applyNoCacheHeaders(res);
    }

    if (!crossOrigin) {
      return applyNoCacheHeaders(
        NextResponse.redirect(new URL("/staff/login", request.url)),
      );
    }

    return applyNoCacheHeaders(NextResponse.next());
  }

  if (isCustomerRoute) {
    if (customerCookie) {
      const custSession = await fetchVerifiedRole(
        backendOrigin,
        CUSTOMER_COOKIE,
        customerCookie,
        "/api/v1/auth/me",
      );

      if (custSession.valid) {
        return applyNoCacheHeaders(NextResponse.next());
      }

      if (staffCookie) {
        const staffSession = await fetchVerifiedRole(
          backendOrigin,
          STAFF_COOKIE,
          staffCookie,
          "/api/v1/staff/auth/me",
        );
        if (staffSession.valid && staffSession.role) {
          return redirectAccessDenied(request, "customer", staffSession.role);
        }
      }

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      const res = NextResponse.redirect(loginUrl);
      res.cookies.delete(CUSTOMER_COOKIE);
      return applyNoCacheHeaders(res);
    }

    if (staffCookie) {
      const staffSession = await fetchVerifiedRole(
        backendOrigin,
        STAFF_COOKIE,
        staffCookie,
        "/api/v1/staff/auth/me",
      );
      if (staffSession.valid && staffSession.role) {
        return redirectAccessDenied(request, "customer", staffSession.role);
      }
    }

    if (!crossOrigin) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return applyNoCacheHeaders(NextResponse.redirect(loginUrl));
    }

    return applyNoCacheHeaders(NextResponse.next());
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/manager/:path*",
    "/kds/:path*",
    "/customer/:path*",
    "/orders/:path*",
    "/checkout/:path*",
    "/payment/:path*",
    "/order-confirmation/:path*",
  ],
};
