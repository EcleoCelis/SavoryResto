export type AppRole = "customer" | "manager" | "kitchen_staff";
export type PortalName = "customer" | "manager" | "kds";

export const Permission = {
  // Customer operations
  ORDER_CREATE: "order.create",
  ORDER_VIEW_OWN: "order.view_own",
  PROFILE_MANAGE: "profile.manage",

  // KDS workplace operations
  KDS_VIEW: "kds.view",
  KDS_UPDATE: "kds.update",

  // Manager operations & administration
  INVENTORY_MANAGE: "inventory.manage",
  MENU_MANAGE: "menu.manage",
  SALES_VIEW: "sales.view",
  STAFF_MANAGE: "staff.manage",
  ROLES_ASSIGN: "roles.assign",
  SECURITY_MANAGE: "security.manage",
  SYSTEM_CONFIG_MANAGE: "system_config.manage",
  AUDIT_VIEW: "audit.view",
  ORDER_MONITOR: "order.monitor",
  ORDER_COMPLETE: "order.complete",
  CUSTOMER_VIEW: "customer.view",
  CUSTOMER_MANAGE: "customer.manage",
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

/**
 * Authoritative frontend RBAC policy mirror of backend/app/core/permissions.py.
 * Manager and KDS are strictly independent roles with zero inherited portal permissions.
 */
export const ROLE_PERMISSIONS: Record<AppRole, readonly PermissionValue[]> = {
  customer: [
    Permission.ORDER_CREATE,
    Permission.ORDER_VIEW_OWN,
    Permission.PROFILE_MANAGE,
  ],
  kitchen_staff: [
    Permission.KDS_VIEW,
    Permission.KDS_UPDATE,
  ],
  manager: [
    Permission.INVENTORY_MANAGE,
    Permission.MENU_MANAGE,
    Permission.SALES_VIEW,
    Permission.STAFF_MANAGE,
    Permission.ROLES_ASSIGN,
    Permission.SECURITY_MANAGE,
    Permission.SYSTEM_CONFIG_MANAGE,
    Permission.AUDIT_VIEW,
    Permission.ORDER_MONITOR,
    Permission.ORDER_COMPLETE,
    Permission.CUSTOMER_VIEW,
    Permission.CUSTOMER_MANAGE,
  ],
};

export const AUTH_STATE_CHANGED_EVENT = "savorybites:auth-changed";

export function hasPermission(role: AppRole | null | undefined, permission: PermissionValue): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function homePathForRole(role: AppRole | null | undefined): string {
  if (role === "manager") return "/manager";
  if (role === "kitchen_staff") return "/kds";
  return "/";
}

export function roleDisplayName(role: AppRole | null | undefined): string {
  if (role === "manager") return "Manager";
  if (role === "kitchen_staff") return "Kitchen Display System (KDS)";
  if (role === "customer") return "Customer";
  return "Guest";
}

export function portalDisplayName(portal: PortalName): string {
  if (portal === "manager") return "Manager Portal";
  if (portal === "kds") return "Kitchen Display System (KDS)";
  return "Customer Account & Ordering";
}

export function loginPathForPortal(portal: PortalName): string {
  return portal === "customer" ? "/login" : "/staff/login";
}

export function isSafeCustomerNextPath(nextPath: string | null | undefined): string {
  if (!nextPath) return "/customer";
  const trimmed = nextPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/customer";
  }
  if (
    trimmed.startsWith("/manager") ||
    trimmed.startsWith("/kds") ||
    trimmed.startsWith("/staff") ||
    trimmed.startsWith("/access-denied")
  ) {
    return "/customer";
  }
  return trimmed;
}

export function notifyAuthStateChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
  }
}
