import type { StaffUser } from "../types/staff";

export function staffHomeForRole(role: StaffUser["role"]): "/manager" | "/kds" {
  if (role === "manager") return "/manager";
  return "/kds";
}
