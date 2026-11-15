import type {
  CustomerUser,
  ForgotPasswordPayload,
  ForgotPasswordResponse,
  LoginPayload,
  LoginResponse,
  RegisterPayload,
  RegisterResponse,
  ResetPasswordPayload,
  ResetPasswordResponse,
} from "../../types/auth";
import { getApiBaseUrl } from "./base-url";

export class AuthApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: "include",
    ...init,
  });

  const contentType = response.headers.get("content-type") || "";
  const data: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    let message = "An error occurred with authentication.";
    if (typeof data === "object" && data !== null && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ");
      }
    }
    throw new AuthApiError(response.status, message);
  }

  return data as T;
}

export function registerCustomer(payload: RegisterPayload): Promise<RegisterResponse> {
  return request<RegisterResponse>("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: payload.full_name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone.replace(/[\s-]/g, ""),
      password: payload.password,
    }),
  });
}

export function loginCustomer(payload: LoginPayload): Promise<LoginResponse> {
  return request<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
      remember_me: Boolean(payload.remember_me),
    }),
  });
}

export function getCustomerMe(): Promise<CustomerUser> {
  return request<CustomerUser>("/api/v1/auth/me");
}

export function logoutCustomer(): Promise<{ message: string }> {
  return request<{ message: string }>("/api/v1/auth/logout", {
    method: "POST",
  });
}

export function requestPasswordReset(
  payload: ForgotPasswordPayload,
): Promise<ForgotPasswordResponse> {
  return request<ForgotPasswordResponse>("/api/v1/auth/password/forgot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email.trim().toLowerCase(),
    }),
  });
}

export function resetPassword(
  payload: ResetPasswordPayload,
): Promise<ResetPasswordResponse> {
  return request<ResetPasswordResponse>("/api/v1/auth/password/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: payload.token.trim(),
      new_password: payload.new_password,
      confirm_password: payload.confirm_password,
    }),
  });
}
