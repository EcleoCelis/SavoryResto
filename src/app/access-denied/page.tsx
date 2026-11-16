import { AccessDenied } from "../../components/auth/AccessDenied";
import type { AppRole, PortalName } from "../../lib/rbac";

function parsePortal(value: string | undefined): PortalName {
  if (value === "manager" || value === "kds" || value === "customer") {
    return value;
  }
  return "customer";
}

function parseRole(value: string | undefined): AppRole | null {
  if (value === "customer" || value === "manager" || value === "kitchen_staff") {
    return value;
  }
  return null;
}

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ portal?: string; role?: string }>;
}) {
  const params = await searchParams;
  return <AccessDenied portal={parsePortal(params.portal)} actualRole={parseRole(params.role)} />;
}
