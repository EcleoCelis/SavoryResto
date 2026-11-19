from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import TypeAdapter
from sqlalchemy.orm import Session

from app.core.permissions import Permission
from app.core.security import require_permission
from app.db.database import get_db
from app.schemas.product import (
    DishImageUploadResponse,
    ProductAvailabilityUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
)
from app.services.catalog_service import (
    AvailabilityFilter,
    CatalogConflictError,
    create_product,
    delete_product,
    get_product,
    get_product_any_status,
    list_manager_products,
    list_products,
    update_product,
    update_product_availability,
)
from app.services.media_storage_service import delete_stored_dish_image, save_dish_image
from app.services.response_cache import cached_json_response


router = APIRouter(prefix="/api/v1/products", tags=["Products"])
_PRODUCT_LIST_ADAPTER = TypeAdapter(list[ProductResponse])


@router.get("", response_model=list[ProductResponse])
def get_products(
    request: Request,
    category_id: int | None = Query(default=None, gt=0),
    search: str | None = Query(default=None, max_length=100),
    availability: AvailabilityFilter = Query(default="available"),
    db: Session = Depends(get_db),
):
    clean_search = search.strip().lower() if search and search.strip() else ""
    cache_key = f"catalog:products:c={category_id}:a={availability}:s={clean_search}"
    return cached_json_response(
        request,
        namespace="catalog",
        cache_key=cache_key,
        ttl_seconds=120,
        max_age_seconds=60,
        swr_seconds=300,
        store_in_memory=not bool(clean_search),
        compute_json_bytes=lambda: _PRODUCT_LIST_ADAPTER.dump_json(
            list_products(db, category_id, search, availability)
        ),
    )


@router.get(
    "/manage",
    response_model=list[ProductResponse],
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def get_products_for_manager(
    category_id: int | None = Query(default=None, gt=0),
    search: str | None = Query(default=None, max_length=100),
    availability: AvailabilityFilter = Query(default="all"),
    db: Session = Depends(get_db),
):
    return list_manager_products(db, category_id, search, availability)


@router.post(
    "/upload-image",
    response_model=DishImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
async def upload_dish_image_endpoint(
    file: UploadFile = File(...),
):
    """
    Securely uploads, verifies, and optimizes a dish image. Strips metadata, downscales if necessary,
    and converts to WebP. Restricted to authenticated Managers.
    """
    try:
        content = await file.read()
        result = save_dish_image(content, file.filename)
        return result
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while processing the image file.",
        )


@router.delete(
    "/upload-image",
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def delete_uploaded_dish_image_endpoint(
    image_url: str = Query(..., description="The public URL or storage key of the image to remove"),
):
    """
    Compensating cleanup endpoint to remove an uploaded image file if product creation/update fails.
    """
    deleted = delete_stored_dish_image(image_url)
    return {"deleted": deleted, "message": "Image cleanup processed."}


@router.post(
    "",
    response_model=ProductResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def create_product_endpoint(
    product_in: ProductCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_product(db, product_in)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@router.put(
    "/{product_id}",
    response_model=ProductResponse,
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def update_product_endpoint(
    product_id: int,
    product_in: ProductUpdate,
    db: Session = Depends(get_db),
):
    try:
        product = update_product(db, product_id, product_in)
    except CatalogConflictError as err:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    return product


@router.patch(
    "/{product_id}/availability",
    response_model=ProductResponse,
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def update_product_availability_endpoint(
    product_id: int,
    availability_in: ProductAvailabilityUpdate,
    db: Session = Depends(get_db),
):
    product = update_product_availability(db, product_id, availability_in.is_available)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    return product


@router.delete(
    "/{product_id}",
    dependencies=[Depends(require_permission(Permission.MENU_MANAGE))],
)
def delete_product_endpoint(
    product_id: int,
    db: Session = Depends(get_db),
):
    deleted = delete_product(db, product_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    return {"message": "Product deleted successfully."}


@router.get(
    "/{product_id}",
    response_model=ProductResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "Product not found.",
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "required": ["detail"],
                        "properties": {"detail": {"type": "string"}},
                    }
                }
            },
        }
    },
)
def get_product_by_id(request: Request, product_id: int, db: Session = Depends(get_db)):
    def _build() -> bytes | None:
        product = get_product(db, product_id)
        if product is None:
            return None
        return ProductResponse.model_validate(product).model_dump_json().encode("utf-8")

    response = cached_json_response(
        request,
        namespace="catalog",
        cache_key=f"catalog:product:{product_id}",
        ttl_seconds=120,
        max_age_seconds=60,
        swr_seconds=300,
        compute_json_bytes=_build,
    )
    if response is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    return response
