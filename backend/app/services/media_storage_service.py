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

# Regex for strictly generated dish image filenames (prevents any traversal)
DISH_FILENAME_PATTERN = re.compile(r"^dish_[a-f0-9]{32}\.webp$")

# Magic bytes detection for fast header verification
MAGIC_BYTES = {
    b"\xff\xd8\xff": "JPEG",
    b"\x89PNG\r\n\x1a\n": "PNG",
    b"RIFF": "WEBP",
}

MAX_DIMENSION = 1600
MIN_DIMENSION = 50


def _get_dishes_dir() -> Path:
    dishes_dir = settings.MEDIA_DIR / "dishes"
    dishes_dir.mkdir(parents=True, exist_ok=True)
    return dishes_dir


def _validate_magic_bytes(header: bytes) -> bool:
    if header.startswith(b"\xff\xd8\xff"):
        return True
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP":
        return True
    return False


def save_dish_image(file_bytes: bytes, original_filename: str | None = None) -> dict:
    """
    Validates, strips metadata, optimizes, and securely persists an uploaded dish image.
    Returns metadata dict containing public URL, filename, and dimensions.
    """
    if not file_bytes:
        raise ValueError("Uploaded image file is empty.")

    if len(file_bytes) > settings.MAX_UPLOAD_SIZE_BYTES:
        raise ValueError(
            f"Image file size ({len(file_bytes)} bytes) exceeds maximum permitted limit of {settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB."
        )

    # Magic byte header check
    if not _validate_magic_bytes(file_bytes[:16]):
        raise ValueError("Unsupported or invalid image file format. Supported formats: JPEG, PNG, WebP.")

    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            image_format = (img.format or "").upper()
            if image_format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError(f"Image format '{image_format}' is not supported. Use JPEG, PNG, or WebP.")

            width, height = img.size
            if width < MIN_DIMENSION or height < MIN_DIMENSION:
                raise ValueError(f"Image dimensions ({width}x{height}) are too small. Minimum size is {MIN_DIMENSION}x{MIN_DIMENSION}px.")
            if width > 6000 or height > 6000:
                raise ValueError("Image dimensions exceed 6000x6000px limit.")

            # Convert color modes appropriately
            # Preserve alpha for transparent PNGs / WebPs
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                processed_img = img.convert("RGBA")
            else:
                processed_img = img.convert("RGB")

            # Scale down large images preserving aspect ratio
            if processed_img.width > MAX_DIMENSION or processed_img.height > MAX_DIMENSION:
                processed_img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)

            # Generate random opaque filename to eliminate path traversal & script execution risks
            unique_id = uuid.uuid4().hex
            filename = f"dish_{unique_id}.webp"
            target_path = _get_dishes_dir() / filename

            # Re-encode to clean, metadata-free WebP
            buffer = io.BytesIO()
            processed_img.save(
                buffer,
                format="WEBP",
                quality=85,
                method=6,
            )
            webp_bytes = buffer.getvalue()

            # Write atomically to disk
            target_path.write_bytes(webp_bytes)

            logger.info(
                "Stored dish image '%s' (%d bytes, %dx%d)",
                filename,
                len(webp_bytes),
                processed_img.width,
                processed_img.height,
            )

            return {
                "filename": filename,
                "image_url": f"/api/v1/media/dishes/{filename}",
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


def get_dish_image_path(filename: str) -> Path | None:
    """
    Safely resolves the filesystem path for a dish image with strict filename format enforcement.
    Prevents directory traversal attacks.
    """
    if not DISH_FILENAME_PATTERN.match(filename):
        return None

    dishes_dir = _get_dishes_dir().resolve()
    target_path = (dishes_dir / filename).resolve()

    # Path traversal safety check: target must be inside dishes directory
    if not str(target_path).startswith(str(dishes_dir)):
        return None

    if not target_path.is_file():
        return None

    return target_path


def delete_stored_dish_image(image_url_or_filename: str) -> bool:
    """
    Safely deletes a managed dish image from disk (compensating cleanup or replacement).
    Returns True if deleted, False if not found or skipped.
    """
    if not image_url_or_filename:
        return False

    # Extract filename from URL or path
    filename = Path(image_url_or_filename.strip()).name
    if not DISH_FILENAME_PATTERN.match(filename):
        return False

    dishes_dir = _get_dishes_dir().resolve()
    target_path = (dishes_dir / filename).resolve()

    if not str(target_path).startswith(str(dishes_dir)):
        logger.warning("Blocked path traversal attempt in delete_stored_dish_image: %s", image_url_or_filename)
        return False

    try:
        if target_path.is_file():
            target_path.unlink()
            logger.info("Deleted dish image '%s'", filename)
            return True
    except OSError as exc:
        logger.error("Failed to delete dish image '%s': %s", filename, exc)

    return False
