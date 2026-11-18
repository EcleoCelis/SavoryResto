from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.permissions import Permission
from app.core.security import require_permission
from app.db.database import get_db
from app.db.models.staff import StaffUser
from app.schemas.reports import (
    ManagerInventoryReportResponse,
    ManagerMenuReportResponse,
    ManagerOrdersReportResponse,
    ManagerPaymentsReportResponse,
    ManagerReportOverviewResponse,
    ManagerSalesReportResponse,
    MenuSortBy,
    ReportDatePreset,
    ReportExportType,
    ReportGranularity,
    SortDirection,
)
from app.services.reporting_service import (
    generate_report_csv,
    get_manager_inventory_report,
    get_manager_menu_report,
    get_manager_orders_report,
    get_manager_payments_report,
    get_manager_report_overview,
    get_manager_sales_report,
)

router = APIRouter(prefix="/api/v1/manager/reports", tags=["Manager Reports"])

perm_reports = require_permission(Permission.SALES_VIEW)


def _handle_window_error(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.get("/overview", response_model=ManagerReportOverviewResponse)
def report_overview(
    preset: ReportDatePreset = Query(default="last_30_days"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current_staff: StaffUser = Depends(perm_reports),
    db: Session = Depends(get_db),
):
    del current_staff
    try:
        return get_manager_report_overview(db, preset=preset, date_from=date_from, date_to=date_to)
    except ValueError as exc:
        raise _handle_window_error(exc) from exc


@router.get("/sales", response_model=ManagerSalesReportResponse)
def report_sales(
    preset: ReportDatePreset = Query(default="last_30_days"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    granularity: ReportGranularity = Query(default="daily"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
    current_staff: StaffUser = Depends(perm_reports),
    db: Session = Depends(get_db),
):
    del current_staff
    try:
        return get_manager_sales_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            granularity=granularity,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise _handle_window_error(exc) from exc


@router.get("/orders", response_model=ManagerOrdersReportResponse)
def report_orders(
    preset: ReportDatePreset = Query(default="last_30_days"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status", max_length=30),
    order_type: str | None = Query(default=None, max_length=30),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
    current_staff: StaffUser = Depends(perm_reports),
    db: Session = Depends(get_db),
):
    del current_staff
    try:
        return get_manager_orders_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            status_filter=status_filter,
            order_type=order_type,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise _handle_window_error(exc) from exc


@router.get("/menu", response_model=ManagerMenuReportResponse)
def report_menu(
    preset: ReportDatePreset = Query(default="last_30_days"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    category_id: int | None = Query(default=None, ge=1),
    search: str | None = Query(default=None, max_length=120),
    sort_by: MenuSortBy = Query(default="units_sold"),
    sort_dir: SortDirection = Query(default="desc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
    current_staff: StaffUser = Depends(perm_reports),
    db: Session = Depends(get_db),
):
    del current_staff
    try:
        return get_manager_menu_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            category_id=category_id,
            search=search,
            sort_by=sort_by,
            sort_dir=sort_dir,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise _handle_window_error(exc) from exc


@router.get("/payments", response_model=ManagerPaymentsReportResponse)
def report_payments(
    preset: ReportDatePreset = Query(default="last_30_days"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    settlement: Literal["all", "settled", "pending", "voided"] = Query(default="all"),
    method_code: str | None = Query(default=None, max_length=50),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
    current_staff: StaffUser = Depends(perm_reports),
    db: Session = Depends(get_db),
):
    del current_staff
    try:
        return get_manager_payments_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            settlement=settlement,
            method_code=method_code,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise _handle_window_error(exc) from exc


@router.get("/inventory", response_model=ManagerInventoryReportResponse)
def report_inventory(
    preset: ReportDatePreset = Query(default="last_30_days"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    transaction_type: str | None = Query(default=None, max_length=30),
    search: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
    current_staff: StaffUser = Depends(perm_reports),
    db: Session = Depends(get_db),
):
    del current_staff
    try:
        return get_manager_inventory_report(
            db,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            transaction_type=transaction_type,
            search=search,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise _handle_window_error(exc) from exc


@router.get("/export")
def export_report_csv(
    report: ReportExportType = Query(...),
    preset: ReportDatePreset = Query(default="last_30_days"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    granularity: ReportGranularity = Query(default="daily"),
    status_filter: str | None = Query(default=None, alias="status", max_length=30),
    order_type: str | None = Query(default=None, max_length=30),
    category_id: int | None = Query(default=None, ge=1),
    search: str | None = Query(default=None, max_length=120),
    sort_by: MenuSortBy = Query(default="units_sold"),
    sort_dir: SortDirection = Query(default="desc"),
    settlement: Literal["all", "settled", "pending", "voided"] = Query(default="all"),
    method_code: str | None = Query(default=None, max_length=50),
    transaction_type: str | None = Query(default=None, max_length=30),
    current_staff: StaffUser = Depends(perm_reports),
    db: Session = Depends(get_db),
):
    del current_staff
    try:
        filename, csv_content = generate_report_csv(
            db,
            report_type=report,
            preset=preset,
            date_from=date_from,
            date_to=date_to,
            granularity=granularity,
            status_filter=status_filter,
            order_type=order_type,
            category_id=category_id,
            search=search,
            sort_by=sort_by,
            sort_dir=sort_dir,
            settlement=settlement,
            method_code=method_code,
            transaction_type=transaction_type,
        )
    except ValueError as exc:
        raise _handle_window_error(exc) from exc

    return Response(
        content=csv_content.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
