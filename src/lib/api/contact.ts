import type { ContactInquiryPayload, ContactInquiryResponse } from "../../types/contact";
import { getApiBaseUrl } from "./base-url";

export async function submitContactInquiry(
  payload: ContactInquiryPayload,
): Promise<ContactInquiryResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      subject: payload.subject.trim(),
      message: payload.message.trim(),
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  const data: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    let msg = "Failed to submit your message. Please try again later.";
    if (typeof data === "object" && data !== null && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ");
      }
    }
    throw new Error(msg);
  }

  return data as ContactInquiryResponse;
}
