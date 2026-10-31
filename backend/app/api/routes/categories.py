from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import require_staff_roles
from app.db.database import get_db
from app.schemas.category import CategoryCreate, CategoryDetailResponse, CategoryResponse, CategoryUpdate
from app.services.catalog_service import (
    create_category,
    delete_category,
    list_categories,
    list_manager_categories,
    update_category,
)


router = APIRouter(prefix="/api/v1/categories", tags=["Categories"])


@router.get("", response_model=list[CategoryResponse])
def get_categories(db: Session = Depends(get_db)):
    return list_categories(db)


@router.get(
    "/manage",
    response_model=list[CategoryDetailResponse],
    dependencies=[Depends(require_staff_roles("manager"))],
)
def get_categories_for_manager(db: Session = Depends(get_db)):
    return list_manager_categories(db)


@router.post(
    "",
    response_model=CategoryDetailResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_staff_roles("manager"))],
)
def create_category_endpoint(
    category_in: CategoryCreate,
    db: Session = Depends(get_db),
):
    try:
        category = create_category(db, category_in)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return CategoryDetailResponse(
        id=category.id,
        name=category.name,
        description=category.description,
        display_order=category.display_order,
        is_active=category.is_active,
        product_count=0,
    )


@router.put(
    "/{category_id}",
    response_model=CategoryDetailResponse,
    dependencies=[Depends(require_staff_roles("manager"))],
)
def update_category_endpoint(
    category_id: int,
    category_in: CategoryUpdate,
    db: Session = Depends(get_db),
):
    try:
        category = update_category(db, category_id, category_in)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")
    
    # Get current product count for the response
    counts = {c["id"]: c["product_count"] for c in list_manager_categories(db)}
    return CategoryDetailResponse(
        id=category.id,
        name=category.name,
        description=category.description,
        display_order=category.display_order,
        is_active=category.is_active,
        product_count=counts.get(category.id, 0),
    )


@router.delete(
    "/{category_id}",
    dependencies=[Depends(require_staff_roles("manager"))],
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
