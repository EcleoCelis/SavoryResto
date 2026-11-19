from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.permissions import Permission
from app.core.security import require_permission
from app.db.database import get_db
from app.db.models.product import MenuProduct
from app.schemas.category import CategoryCreate, CategoryDetailResponse, CategoryResponse, CategoryUpdate
from app.services.catalog_service import (
    CatalogConflictError,
    create_category,
    delete_category,
    list_categories,
    list_manager_categories,
    update_category,
)
from app.services.response_cache import cached_json_response


router = APIRouter(prefix="/api/v1/categories", tags=["Categories"])
_CATEGORY_LIST_ADAPTER = TypeAdapter(list[CategoryResponse])


@router.get("", response_model=list[CategoryResponse])
def get_categories(request: Request, db: Session = Depends(get_db)):
    return cached_json_response(
        request,
        namespace="catalog",
        cache_key="catalog:categories:active",
        ttl_seconds=120,
        max_age_seconds=60,
        swr_seconds=300,
        compute_json_bytes=lambda: _CATEGORY_LIST_ADAPTER.dump_json(list_categories(db)),
    )


@router.get(
    "/manage",
    response_model=list[CategoryDetailResponse],
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def get_categories_for_manager(db: Session = Depends(get_db)):
    return list_manager_categories(db)


@router.post(
    "",
    response_model=CategoryDetailResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def create_category_endpoint(
    category_in: CategoryCreate,
    db: Session = Depends(get_db),
):
    try:
        category = create_category(db, category_in)
    except CatalogConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return CategoryDetailResponse(
        id=category.id,
        name=category.name,
        description=category.description,
        display_order=category.display_order,
        is_active=category.is_active,
        product_count=0,
        updated_at=category.updated_at,
    )


@router.put(
    "/{category_id}",
    response_model=CategoryDetailResponse,
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def update_category_endpoint(
    category_id: int,
    category_in: CategoryUpdate,
    db: Session = Depends(get_db),
):
    try:
        category = update_category(db, category_id, category_in)
    except CatalogConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")

    product_count = db.scalar(
        select(func.count(MenuProduct.id)).where(
            MenuProduct.category_id == category.id,
            MenuProduct.deleted_at.is_(None),
        )
    ) or 0
    return CategoryDetailResponse(
        id=category.id,
        name=category.name,
        description=category.description,
        display_order=category.display_order,
        is_active=category.is_active,
        product_count=product_count,
        updated_at=category.updated_at,
    )


@router.delete(
    "/{category_id}",
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def delete_category_endpoint(
    category_id: int,
    db: Session = Depends(get_db),
):
    success, message = delete_category(db, category_id)
    if not success:
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    return {"message": message}
