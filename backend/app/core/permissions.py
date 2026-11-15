"""SavoryBites Three-Role Permission Definitions and RBAC Model.

Defines the explicit permissions and role-to-permission mappings for the three
intended application roles:
1. Customer: customer-facing ordering, cart, checkout, profile, order history.
2. Kitchen Staff (KDS): kitchen display workplace, active queue viewing, ticket preparation.
3. Manager: privileged restaurant operations, inventory, catalog, sales analytics,
   staff administration, role assignment, security settings, and audit logs.
"""

from enum import StrEnum


class Permission(StrEnum):
    # Customer operations
    ORDER_CREATE = "order.create"
    ORDER_VIEW_OWN = "order.view_own"
    PROFILE_MANAGE = "profile.manage"

    # KDS workplace operations
    KDS_VIEW = "kds.view"
    KDS_UPDATE = "kds.update"

    # Manager operations & administration
    INVENTORY_MANAGE = "inventory.manage"
    MENU_MANAGE = "menu.manage"
    SALES_VIEW = "sales.view"
    STAFF_MANAGE = "staff.manage"
    ROLES_ASSIGN = "roles.assign"
    SECURITY_MANAGE = "security.manage"
    SYSTEM_CONFIG_MANAGE = "system_config.manage"
    AUDIT_VIEW = "audit.view"
    ORDER_COMPLETE = "order.complete"
    CUSTOMER_VIEW = "customer.view"
    CUSTOMER_MANAGE = "customer.manage"


# Authoritative mapping of the three application roles to permissions:
ROLE_PERMISSIONS: dict[str, frozenset[Permission]] = {
    "customer": frozenset({
        Permission.ORDER_CREATE,
        Permission.ORDER_VIEW_OWN,
        Permission.PROFILE_MANAGE,
    }),
    "kitchen_staff": frozenset({
        Permission.KDS_VIEW,
        Permission.KDS_UPDATE,
    }),
    "manager": frozenset({
        # Full operational authority
        Permission.INVENTORY_MANAGE,
        Permission.MENU_MANAGE,
        Permission.SALES_VIEW,
        Permission.STAFF_MANAGE,
        Permission.ROLES_ASSIGN,
        Permission.SECURITY_MANAGE,
        Permission.SYSTEM_CONFIG_MANAGE,
        Permission.AUDIT_VIEW,
        Permission.ORDER_COMPLETE,
        Permission.KDS_VIEW,
        Permission.CUSTOMER_VIEW,
        Permission.CUSTOMER_MANAGE,
        # Manager is also authorized to view KDS queue for service supervision
    }),
}


def get_role_permissions(role_name: str) -> frozenset[Permission]:
    """Return the immutable set of permissions granted to a canonical role."""
    return ROLE_PERMISSIONS.get(role_name, frozenset())


def has_permission(role_name: str, permission: Permission | str) -> bool:
    """Check whether a canonical role grants the specified permission."""
    target = Permission(permission) if isinstance(permission, str) else permission
    return target in get_role_permissions(role_name)
