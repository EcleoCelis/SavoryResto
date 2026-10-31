from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.services.media_storage_service import get_dish_image_path

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
    """
    Publicly serve processed dish images with aggressive browser caching and strict path traversal protection.
    """
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
