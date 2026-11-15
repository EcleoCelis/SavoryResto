from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.services.media_storage_service import get_customer_avatar_path, get_dish_image_path

router = APIRouter(prefix="/api/v1/media", tags=["Media"])


@router.get(
    "/dishes/{filename}",
    response_class=FileResponse,
    responses={
        200: {
            "content": {"image/webp": {}},
            "description": "The dish image in WebP format.",
        },
        404: {"description": "Dish image not found."},
    },
)
def get_dish_image(filename: str):
    """Publicly serve processed dish images with strict path traversal protection."""
    file_path = get_dish_image_path(filename)
    if not file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dish image not found.")

    return FileResponse(
        path=file_path,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/avatars/{filename}",
    response_class=FileResponse,
    responses={
        200: {
            "content": {"image/webp": {}},
            "description": "The customer profile picture in WebP format.",
        },
        404: {"description": "Profile picture not found."},
    },
)
def get_customer_avatar(filename: str):
    """Serve processed customer avatars with strict path traversal protection."""
    file_path = get_customer_avatar_path(filename)
    if not file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile picture not found.")

    return FileResponse(
        path=file_path,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
