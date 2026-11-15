import io
import logging
import re
import uuid
from pathlib import Path
from PIL import Image, UnidentifiedImageError

from app.core.config import settings

logger = logging.getLogger("savorybites.media")

# Security: Limit maximum pixels to mitigate decompression bomb attacks (DoS)
Image.MAX_IMAGE_PIXELS = 25_000_000

# Regex for strictly generated media filenames (prevents any traversal)
DISH_FILENAME_PATTERN = re.compile(r"^dish_[a-f0-9]{32}\.webp$")
AVATAR_FILENAME_PATTERN = re.compile(r"^avatar_[a-f0-9]{32}\.webp$")

MAGIC_BYTES = {
    b"\xff\xd8\xff": "JPEG",
    b"\x89PNG\r\n\x1a\n": "PNG",
    b"RIFF": "WEBP",
}

MAX_DIMENSION = 1600
MAX_AVATAR_DIMENSION = 512
MIN_DIMENSION = 50


def _get_media_subdir(subdir: str) -> Path:
    target_dir = settings.MEDIA_DIR / subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir


def _get_dishes_dir() -> Path:
    return _get_media_subdir("dishes")


def _get_avatars_dir() -> Path:
    return _get_media_subdir("avatars")


def _validate_magic_bytes(header: bytes) -> bool:
    if header.startswith(b"\xff\xd8\xff"):
        return True
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP":
        return True
    return False


def _save_processed_image(
    file_bytes: bytes,
    *,
    subdir: str,
    prefix: str,
    url_base: str,
    max_dimension: int,
    quality: int = 85,
) -> dict:
    """Validate, strip metadata, resize, and store an uploaded JPEG/PNG/WebP image as clean WebP."""
    if not file_bytes:
        raise ValueError("Uploaded image file is empty.")

    if len(file_bytes) > settings.MAX_UPLOAD_SIZE_BYTES:
        raise ValueError(
            f"Image file size ({len(file_bytes)} bytes) exceeds maximum permitted limit of {settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB."
        )

    if not _validate_magic_bytes(file_bytes[:16]):
        raise ValueError("Unsupported or invalid image file format. Supported formats: JPEG, PNG, WebP.")

    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            image_format = (img.format or "").upper()
            if image_format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError(f"Image format '{image_format}' is not supported. Use JPEG, PNG, or WebP.")

            width, height = img.size
            if width < MIN_DIMENSION or height < MIN_DIMENSION:
                raise ValueError(
                    f"Image dimensions ({width}x{height}) are too small. Minimum size is {MIN_DIMENSION}x{MIN_DIMENSION}px."
                )
            if width > 6000 or height > 6000:
                raise ValueError("Image dimensions exceed 6000x6000px limit.")

            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                processed_img = img.convert("RGBA")
            else:
                processed_img = img.convert("RGB")

            if processed_img.width > max_dimension or processed_img.height > max_dimension:
                processed_img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

            unique_id = uuid.uuid4().hex
            filename = f"{prefix}_{unique_id}.webp"
            target_path = _get_media_subdir(subdir) / filename

            buffer = io.BytesIO()
            processed_img.save(buffer, format="WEBP", quality=quality, method=6)
            webp_bytes = buffer.getvalue()
            target_path.write_bytes(webp_bytes)

            logger.info(
                "Stored %s image '%s' (%d bytes, %dx%d)",
                subdir,
                filename,
                len(webp_bytes),
                processed_img.width,
                processed_img.height,
            )

            return {
                "filename": filename,
                "image_url": f"{url_base}/{filename}",
                "size_bytes": len(webp_bytes),
                "width": processed_img.width,
                "height": processed_img.height,
                "content_type": "image/webp",
            }
    except UnidentifiedImageError:
        raise ValueError("The provided file could not be decoded as a valid image.")
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        logger.error("Unexpected error processing image upload: %s", exc)
        raise ValueError("Failed to process image file. Ensure it is a valid, uncorrupted image.")


def _get_stored_image_path(filename: str, *, subdir: str, pattern: re.Pattern[str]) -> Path | None:
    if not pattern.match(filename):
        return None

    base_dir = _get_media_subdir(subdir).resolve()
    target_path = (base_dir / filename).resolve()

    if not target_path.is_relative_to(base_dir):
        return None
    if not target_path.is_file():
        return None

    return target_path


def _delete_stored_image(image_url_or_filename: str, *, subdir: str, pattern: re.Pattern[str]) -> bool:
    if not image_url_or_filename:
        return False

    filename = Path(image_url_or_filename.strip()).name
    if not pattern.match(filename):
        return False

    base_dir = _get_media_subdir(subdir).resolve()
    target_path = (base_dir / filename).resolve()

    if not target_path.is_relative_to(base_dir):
        logger.warning("Blocked path traversal attempt deleting media: %s", image_url_or_filename)
        return False

    try:
        if target_path.is_file():
            target_path.unlink()
            logger.info("Deleted %s image '%s'", subdir, filename)
            return True
    except OSError as exc:
        logger.error("Failed to delete %s image '%s': %s", subdir, filename, exc)

    return False


def save_dish_image(file_bytes: bytes, original_filename: str | None = None) -> dict:
    """Validate, optimize, strip metadata, and persist an uploaded dish image."""
    del original_filename
    return _save_processed_image(
        file_bytes,
        subdir="dishes",
        prefix="dish",
        url_base="/api/v1/media/dishes",
        max_dimension=MAX_DIMENSION,
    )


def get_dish_image_path(filename: str) -> Path | None:
    return _get_stored_image_path(filename, subdir="dishes", pattern=DISH_FILENAME_PATTERN)


def delete_stored_dish_image(image_url_or_filename: str) -> bool:
    return _delete_stored_image(image_url_or_filename, subdir="dishes", pattern=DISH_FILENAME_PATTERN)


def save_customer_avatar(file_bytes: bytes, original_filename: str | None = None) -> dict:
    """Validate, optimize, strip metadata, and persist an uploaded customer avatar image."""
    del original_filename
    return _save_processed_image(
        file_bytes,
        subdir="avatars",
        prefix="avatar",
        url_base="/api/v1/media/avatars",
        max_dimension=MAX_AVATAR_DIMENSION,
        quality=84,
    )


def get_customer_avatar_path(filename: str) -> Path | None:
    return _get_stored_image_path(filename, subdir="avatars", pattern=AVATAR_FILENAME_PATTERN)


def delete_stored_avatar_image(image_url_or_filename: str) -> bool:
    return _delete_stored_image(image_url_or_filename, subdir="avatars", pattern=AVATAR_FILENAME_PATTERN)
