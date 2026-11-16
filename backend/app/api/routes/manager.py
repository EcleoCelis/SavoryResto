from datetime import date, datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.order_status import OrderStatus
from app.core.password_policy import validate_password_strength
from app.core.permissions import Permission
from app.core.security import get_client_ip, hash_password, require_permission
from app.db.database import get_db
from app.db.models.order import Order
from app.db.models.staff import Role, StaffUser
from app.schemas.analytics import (
    KpiSummaryResponse,
    OperationalAlertsResponse,
    OrderDistributionResponse,
    OrderVolumeResponse,
    RevenuePeriod,
    RevenueTrendResponse,
    TopSellingDishesResponse,
)
from app.schemas.customer import (
    ManagerCustomerDetailResponse,
    ManagerCustomerListResponse,
    ManagerCustomerStatusUpdateRequest,
    ManagerCustomerSummaryResponse,
)
from app.schemas.kds import (
    KdsOrderResponse,
    KdsStatusUpdateRequest,
    ManagerOrderDetailResponse,
    ManagerOrderListResponse,
)
from app.schemas.staff import (
    AuditLogResponse,
    StaffCreateRequest,
    StaffDetailResponse,
    StaffRoleUpdateRequest,
    StaffStatusUpdateRequest,
)
from app.services.analytics_service import (
    get_kpi_summary,
    get_operational_alerts,
    get_order_distribution,
    get_order_volume,
    get_revenue_trend,
    get_top_selling_dishes,
)
from app.services.audit_service import list_audit_logs, record_audit_event
from app.services.customer_service import (
    get_manager_customer_detail,
    list_manager_customers,
    update_manager_customer_status,
)
from app.services.kds_service import (
    get_manager_order_detail,
    list_kds_orders,
    list_manager_orders_directory,
    update_manager_order_status,
)
from app.services.staff_service import ALLOWED_STAFF_ROLES

router = APIRouter(prefix="/api/v1/manager", tags=["Manager Operations"])

# Permission dependencies
perm_orders_monitor = require_permission(Permission.ORDER_MONITOR)
perm_orders = require_permission(Permission.ORDER_COMPLETE)
perm_staff = require_permission(Permission.STAFF_MANAGE)
perm_roles = require_permission(Permission.ROLES_ASSIGN)
perm_security = require_permission(Permission.SECURITY_MANAGE)
perm_analytics = require_permission(Permission.SALES_VIEW)
perm_audit = require_permission(Permission.AUDIT_VIEW)
perm_customer_view = require_permission(Permission.CUSTOMER_VIEW)
perm_customer_manage = require_permission(Permission.CUSTOMER_MANAGE)


def _serialize_staff_detail(user: StaffUser) -> StaffDetailResponse:
    return StaffDetailResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role.name,
        status=user.status,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


# ============================================================
# Order Fulfillment Queue
# ============================================================

@router.get("/orders", response_model=list[KdsOrderResponse])
def get_manager_orders(
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    current_staff: StaffUser = Depends(perm_orders_monitor),
    db: Session = Depends(get_db),
):
    """Return the active fulfillment queue to authorized managers only."""
    del current_staff
    return list_kds_orders(db, status_filter)


@router.get("/orders/directory", response_model=ManagerOrderListResponse)
def get_manager_orders_directory(
    search: str | None = Query(default=None, max_length=120),
    status_filter: Literal[
        "all", "active", "pending", "confirmed", "preparing", "ready", "completed", "cancelled"
    ] = Query(default="all", alias="status"),
    fulfillment_type: Literal["all", "table_service", "counter_pickup"] = Query(default="all"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
    current_staff: StaffUser = Depends(perm_orders_monitor),
    db: Session = Depends(get_db),
):
    """Return paginated historical and active orders with customer, payment, and status counts."""
    del current_staff
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="date_from cannot be later than date_to.",
        )
    return list_manager_orders_directory(
        db,
        search=search,
        status_filter=status_filter,
        fulfillment_type=fulfillment_type,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )


@router.get("/orders/{order_id}", response_model=ManagerOrderDetailResponse)
def get_manager_order_detail_endpoint(
    order_id: int,
    current_staff: StaffUser = Depends(perm_orders_monitor),
    db: Session = Depends(get_db),
):
    """Return authoritative receipt-level details for a single restaurant order."""
    del current_staff
    order = get_manager_order_detail(db, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return order


@router.patch("/orders/{order_id}/status", response_model=KdsOrderResponse)
def update_manager_order_status_endpoint(
    order_id: int,
    request: KdsStatusUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_orders),
    db: Session = Depends(get_db),
):
    """Allow authorized managers to complete or cancel orders through manager-only routes."""
    try:
        order = update_manager_order_status(
            db,
            current_staff,
            order_id,
            request.status,
            cancellation_reason=request.cancellation_reason,
        )
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")

    audit_details: dict[str, Any] = {
        "order_number": order.order_number,
        "new_status": order.status.value,
    }
    if request.cancellation_reason and request.cancellation_reason.strip():
        audit_details["cancellation_reason"] = request.cancellation_reason.strip()

    record_audit_event(
        db=db,
        event_type="manager.order.status_change",
        actor_type="staff",
        actor_id=current_staff.id,
        actor_email=current_staff.email,
        target_type="order",
        target_id=str(order.id),
        outcome="success",
        ip_address=get_client_ip(req),
        details=audit_details,
    )
    return order


# ============================================================
# Staff Account Administration (Privileged IAM)
# ============================================================

@router.get("/staff", response_model=list[StaffDetailResponse])
def list_staff_accounts(
    search: str | None = Query(default=None, max_length=120),
    role: Literal["kitchen_staff", "manager"] | None = Query(default=None),
    status_filter: Literal["active", "inactive"] | None = Query(default=None, alias="status"),
    current_staff: StaffUser = Depends(perm_staff),
    db: Session = Depends(get_db),
):
    """List all staff accounts with their assigned roles and status."""
    del current_staff
    stmt = (
        select(StaffUser)
        .options(joinedload(StaffUser.role))
        .join(Role)
        .where(Role.name.in_(ALLOWED_STAFF_ROLES))
    )
    if role is not None:
        stmt = stmt.where(Role.name == role)
    if status_filter is not None:
        stmt = stmt.where(StaffUser.status == status_filter)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(StaffUser.name.ilike(pattern), StaffUser.email.ilike(pattern))
        )
    users = db.scalars(stmt.order_by(StaffUser.id)).all()
    return [_serialize_staff_detail(u) for u in users]


@router.post("/staff", response_model=StaffDetailResponse, status_code=status.HTTP_201_CREATED)
def create_staff_account(
    request: StaffCreateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_staff),
    db: Session = Depends(get_db),
):
    """Create a new kitchen staff or additional manager account under administrative control."""
    client_ip = get_client_ip(req)
    role_name = request.role.strip().lower()
    if role_name not in ALLOWED_STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role '{request.role}' is not an authorized staff role.",
        )

    # Validate password policy
    valid_pwd, pwd_err = validate_password_strength(request.password)
    if not valid_pwd:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_err)

    email_clean = str(request.email).strip().lower()

    # Check for existing user with this email
    existing = db.scalar(select(StaffUser).where(StaffUser.email == email_clean))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A staff account with this email address already exists.",
        )

    target_role = db.scalar(select(Role).where(Role.name == role_name))
    if not target_role:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Configured role not found.")

    pwd_hash = hash_password(request.password)
    now = datetime.now(timezone.utc)
    new_staff = StaffUser(
        role_id=target_role.id,
        name=request.name.strip(),
        email=email_clean,
        legacy_password=pwd_hash,
        password_hash=pwd_hash,
        status="active",
        created_at=now,
        updated_at=now,
    )
    db.add(new_staff)
    db.commit()
    db.refresh(new_staff)

    # Record audit log
    record_audit_event(
        db=db,
        event_type="staff.create",
        actor_type="staff",
        actor_id=current_staff.id,
        actor_email=current_staff.email,
        target_type="staff",
        target_id=str(new_staff.id),
        outcome="success",
        ip_address=client_ip,
        details={"name": new_staff.name, "assigned_role": role_name, "email": email_clean},
    )

    return _serialize_staff_detail(new_staff)


@router.patch("/staff/{staff_id}/status", response_model=StaffDetailResponse)
def update_staff_status(
    staff_id: int,
    request: StaffStatusUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_staff),
    db: Session = Depends(get_db),
):
    """Activate or deactivate a staff member with self-deactivation and last-manager protections."""
    client_ip = get_client_ip(req)
    target = db.scalar(
        select(StaffUser).options(joinedload(StaffUser.role)).where(StaffUser.id == staff_id).with_for_update(of=StaffUser)
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff account not found.")

    # 1. Self-deactivation protection
    if staff_id == current_staff.id and request.status == "inactive":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own Manager account. Have another active Manager perform this action.",
        )

    # 2. Last active Manager protection
    if target.role.name == "manager" and target.status == "active" and request.status == "inactive":
        active_managers = db.scalar(
            select(func.count(StaffUser.id))
            .join(Role)
            .where(Role.name == "manager", StaffUser.status == "active")
        ) or 0
        if active_managers <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate the last active Manager account. At least one active Manager must be preserved.",
            )

    old_status = target.status
    target.status = request.status
    target.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(target)

    # Audit log
    record_audit_event(
        db=db,
        event_type="staff.status_change",
        actor_type="staff",
        actor_id=current_staff.id,
        actor_email=current_staff.email,
        target_type="staff",
        target_id=str(target.id),
        outcome="success",
        ip_address=client_ip,
        details={"previous_status": old_status, "new_status": request.status, "target_email": target.email},
    )

    return _serialize_staff_detail(target)


@router.patch("/staff/{staff_id}/role", response_model=StaffDetailResponse)
def update_staff_role(
    staff_id: int,
    request: StaffRoleUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_roles),
    db: Session = Depends(get_db),
):
    """Assign or modify a staff member's role with last-manager demotion protections."""
    client_ip = get_client_ip(req)
    role_name = request.role.strip().lower()
    if role_name not in ALLOWED_STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role '{request.role}' is not an authorized staff role.",
        )

    target = db.scalar(
        select(StaffUser).options(joinedload(StaffUser.role)).where(StaffUser.id == staff_id).with_for_update(of=StaffUser)
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff account not found.")

    new_role = db.scalar(select(Role).where(Role.name == role_name))
    if not new_role:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Configured role not found.")

    # Demotion protection: if demoting an active Manager to kitchen_staff
    if target.role.name == "manager" and role_name != "manager" and target.status == "active":
        active_managers = db.scalar(
            select(func.count(StaffUser.id))
            .join(Role)
            .where(Role.name == "manager", StaffUser.status == "active")
        ) or 0
        if active_managers <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote the last active Manager account. At least one active Manager must be preserved.",
            )

    old_role_name = target.role.name
    target.role_id = new_role.id
    target.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(target)

    # Audit log
    record_audit_event(
        db=db,
        event_type="staff.role_change",
        actor_type="staff",
        actor_id=current_staff.id,
        actor_email=current_staff.email,
        target_type="staff",
        target_id=str(target.id),
        outcome="success",
        ip_address=client_ip,
        details={"previous_role": old_role_name, "new_role": role_name, "target_email": target.email},
    )

    return _serialize_staff_detail(target)


# ============================================================
# Audit Logging & Administrative Accountability
# ============================================================

@router.get("/audit-logs", response_model=list[AuditLogResponse])
def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    event_type: str | None = Query(default=None),
    outcome: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=120),
    current_staff: StaffUser = Depends(perm_audit),
    db: Session = Depends(get_db),
):
    """Retrieve immutable audit event logs for administrative oversight and compliance."""
    del current_staff
    logs = list_audit_logs(
        db,
        limit=limit,
        offset=offset,
        event_type=event_type,
        outcome=outcome,
        search=search,
    )
    return [
        AuditLogResponse(
            id=log.id,
            event_type=log.event_type,
            actor_type=log.actor_type,
            actor_id=log.actor_id,
            actor_email=log.actor_email,
            target_type=log.target_type,
            target_id=log.target_id,
            outcome=log.outcome,
            created_at=log.created_at,
            details=log.details,
        )
        for log in logs
    ]


# ============================================================
# Security Configuration & Operational Analytics
# ============================================================

@router.get("/security/overview")
def get_security_overview(
    current_staff: StaffUser = Depends(perm_security),
    db: Session = Depends(get_db),
):
    """Provide administrative visibility into system authentication and security status."""
    del current_staff
    active_managers = db.scalar(
        select(func.count(StaffUser.id)).join(Role).where(Role.name == "manager", StaffUser.status == "active")
    ) or 0
    active_kitchen = db.scalar(
        select(func.count(StaffUser.id)).join(Role).where(Role.name == "kitchen_staff", StaffUser.status == "active")
    ) or 0

    return {
        "status": "secure",
        "environment": settings.ENVIRONMENT,
        "cookie_secure": settings.cookie_secure,
        "active_managers_count": active_managers,
        "active_kitchen_staff_count": active_kitchen,
        "staff_session_timeout_minutes": settings.STAFF_ACCESS_TOKEN_EXPIRE_MINUTES,
        "max_failed_logins_before_lockout": 10,
        "rate_limit_lockout_seconds": 300,
        "public_manager_registration": False,
        "initial_manager_provisioned": active_managers > 0,
    }


@router.get("/analytics/summary")
def get_sales_analytics(
    current_staff: StaffUser = Depends(perm_analytics),
    db: Session = Depends(get_db),
):
    """Provide operations managers with business metrics and completed order revenue."""
    del current_staff
    total_orders = db.scalar(select(func.count(Order.id))) or 0
    total_sales = db.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.status == "completed"
        )
    )
    completed_orders = db.scalar(
        select(func.count(Order.id)).where(Order.status == "completed")
    ) or 0
    ready_orders = db.scalar(
        select(func.count(Order.id)).where(Order.status == "ready")
    ) or 0

    return {
        "total_orders": total_orders,
        "completed_orders": completed_orders,
        "ready_orders": ready_orders,
        "total_revenue": str(total_sales),
    }


@router.get("/analytics/revenue-trend", response_model=RevenueTrendResponse)
def get_manager_revenue_trend(
    period: RevenuePeriod = Query(default="last_7_days"),
    current_staff: StaffUser = Depends(perm_analytics),
    db: Session = Depends(get_db),
):
    """Return time-bucketed completed order revenue in Asia/Manila for authorized managers."""
    del current_staff
    return get_revenue_trend(db, period=period)


@router.get("/analytics/order-distribution", response_model=OrderDistributionResponse)
def get_manager_order_distribution(
    period: RevenuePeriod = Query(default="last_7_days"),
    current_staff: StaffUser = Depends(perm_analytics),
    db: Session = Depends(get_db),
):
    """Return order distribution counts grouped by current operational status in Asia/Manila."""
    del current_staff
    return get_order_distribution(db, period=period)


@router.get("/analytics/top-dishes", response_model=TopSellingDishesResponse)
def get_manager_top_dishes(
    period: RevenuePeriod = Query(default="last_7_days"),
    current_staff: StaffUser = Depends(perm_analytics),
    db: Session = Depends(get_db),
):
    """Return top 5 selling menu dishes by qualifying units sold in Asia/Manila."""
    del current_staff
    return get_top_selling_dishes(db, period=period, limit=5)


@router.get("/analytics/order-volume", response_model=OrderVolumeResponse)
def get_manager_order_volume(
    period: RevenuePeriod = Query(default="last_7_days"),
    current_staff: StaffUser = Depends(perm_analytics),
    db: Session = Depends(get_db),
):
    """Return time-bucketed orders placed counts in Asia/Manila."""
    del current_staff
    return get_order_volume(db, period=period)


@router.get("/analytics/kpi-summary", response_model=KpiSummaryResponse)
def get_manager_kpi_summary(
    period: RevenuePeriod = Query(default="last_7_days"),
    current_staff: StaffUser = Depends(perm_analytics),
    db: Session = Depends(get_db),
):
    """Return period-synchronized KPI summary metrics in Asia/Manila."""
    del current_staff
    return get_kpi_summary(db, period=period)


@router.get("/analytics/operational-alerts", response_model=OperationalAlertsResponse)
def get_manager_operational_alerts(
    current_staff: StaffUser = Depends(perm_analytics),
    db: Session = Depends(get_db),
):
    """Return real-time actionable handoff and inventory restock alerts."""
    del current_staff
    return get_operational_alerts(db)


# ============================================================
# Customer Directory & Operational Oversight
# ============================================================

@router.get("/customers", response_model=ManagerCustomerListResponse)
def get_manager_customers(
    search: str | None = Query(default=None, max_length=100),
    status_filter: str = Query(default="all", alias="status", pattern=r"^(all|active|deactivated)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    current_staff: StaffUser = Depends(perm_customer_view),
    db: Session = Depends(get_db),
):
    """List registered customer summaries with real transaction aggregates for managers."""
    del current_staff
    return list_manager_customers(
        db,
        search=search,
        status_filter=status_filter,
        page=page,
        page_size=page_size,
    )


@router.get("/customers/{customer_id}", response_model=ManagerCustomerDetailResponse)
def get_manager_customer(
    customer_id: int,
    current_staff: StaffUser = Depends(perm_customer_view),
    db: Session = Depends(get_db),
):
    """Retrieve operational customer detail, order history, and consented allergy alerts."""
    del current_staff
    detail = get_manager_customer_detail(db, customer_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found.")
    return detail


@router.patch("/customers/{customer_id}/status", response_model=ManagerCustomerDetailResponse)
def patch_manager_customer_status(
    customer_id: int,
    payload: ManagerCustomerStatusUpdateRequest,
    req: Request,
    current_staff: StaffUser = Depends(perm_customer_manage),
    db: Session = Depends(get_db),
):
    """Activate or deactivate a customer account with mandatory reason and audit logging."""
    try:
        updated = update_manager_customer_status(
            db,
            staff_user=current_staff,
            customer_id=customer_id,
            request=payload,
            ip_address=get_client_ip(req),
        )
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(err))
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found.")
    return updated
