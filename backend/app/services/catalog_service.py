from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db.models.category import MenuCategory
from app.db.models.inventory import MenuItemIngredient
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemAddon, MenuItemSize
from app.schemas.category import CategoryCreate, CategoryUpdate
from app.schemas.product import ProductCreate, ProductUpdate
from app.services.media_storage_service import delete_stored_dish_image


class CatalogConflictError(ValueError):
    """Raised when optimistic locking or uniqueness checks detect a concurrent change."""


def _timestamps_match(actual: datetime, expected: datetime) -> bool:
    actual_utc = actual if actual.tzinfo else actual.replace(tzinfo=timezone.utc)
    expected_utc = expected if expected.tzinfo else expected.replace(tzinfo=timezone.utc)
    return abs((actual_utc - expected_utc).total_seconds()) < 0.001


def _product_options():
    return (
        selectinload(MenuProduct.sizes.and_(MenuItemSize.is_active.is_(True))),
        selectinload(MenuProduct.addons.and_(MenuItemAddon.is_active.is_(True))),
        selectinload(MenuProduct.ingredients).selectinload(MenuItemIngredient.inventory_item),
    )


def list_categories(db: Session) -> list[MenuCategory]:
    statement = (
        select(MenuCategory)
        .where(MenuCategory.is_active.is_(True))
        .order_by(MenuCategory.display_order, MenuCategory.name)
    )
    return list(db.scalars(statement))


def list_manager_categories(db: Session) -> list[dict[str, Any]]:
    product_count_subq = (
        select(func.count(MenuProduct.id))
        .where(
            MenuProduct.category_id == MenuCategory.id,
            MenuProduct.deleted_at.is_(None),
        )
        .correlate(MenuCategory)
        .scalar_subquery()
    )
    statement = (
        select(MenuCategory, product_count_subq.label("product_count"))
        .order_by(MenuCategory.display_order, MenuCategory.name)
    )
    results = []
    for category, count in db.execute(statement).all():
        results.append({
            "id": category.id,
            "name": category.name,
            "description": category.description,
            "display_order": category.display_order,
            "is_active": category.is_active,
            "product_count": count or 0,
            "updated_at": category.updated_at,
        })
    return results


def get_category(db: Session, category_id: int) -> MenuCategory | None:
    return db.get(MenuCategory, category_id)


def create_category(db: Session, data: CategoryCreate) -> MenuCategory:
    clean_name = data.name.strip()
    existing = db.scalar(select(MenuCategory).where(func.lower(MenuCategory.name) == clean_name.lower()))
    if existing:
        raise ValueError(f"A category with name '{clean_name}' already exists.")
    now = datetime.now(timezone.utc)
    category = MenuCategory(
        name=clean_name,
        description=data.description.strip() if data.description else None,
        display_order=data.display_order,
        is_active=data.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(category)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise CatalogConflictError(f"A category with name '{clean_name}' already exists.") from exc
    db.refresh(category)
    return category


def update_category(db: Session, category_id: int, data: CategoryUpdate) -> MenuCategory | None:
    category = db.get(MenuCategory, category_id)
    if not category:
        return None
    if data.expected_updated_at is not None and not _timestamps_match(category.updated_at, data.expected_updated_at):
        raise CatalogConflictError("Category was updated by another manager. Refresh the menu and try again.")
    if data.name is not None:
        clean_name = data.name.strip()
        existing = db.scalar(
            select(MenuCategory).where(
                func.lower(MenuCategory.name) == clean_name.lower(),
                MenuCategory.id != category_id,
            )
        )
        if existing:
            raise ValueError(f"A category with name '{clean_name}' already exists.")
        category.name = clean_name
    if data.description is not None:
        category.description = data.description.strip() if data.description else None
    if data.display_order is not None:
        category.display_order = data.display_order
    if data.is_active is not None:
        category.is_active = data.is_active
    category.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise CatalogConflictError("Category update conflicted with an existing record.") from exc
    db.refresh(category)
    return category


def delete_category(db: Session, category_id: int) -> tuple[bool, str]:
    category = db.get(MenuCategory, category_id)
    if not category:
        return False, "Category not found."
    total_count = db.scalar(
        select(func.count(MenuProduct.id)).where(MenuProduct.category_id == category_id)
    ) or 0
    active_count = db.scalar(
        select(func.count(MenuProduct.id)).where(
            MenuProduct.category_id == category_id,
            MenuProduct.deleted_at.is_(None),
        )
    ) or 0
    if active_count > 0:
        return False, f"Cannot delete category '{category.name}' because it contains {active_count} active dish(es). Please reassign or delete them first."
    if total_count > 0:
        category.is_active = False
        category.updated_at = datetime.now(timezone.utc)
        db.commit()
        return True, f"Category '{category.name}' was deactivated because historical dishes reference it."
    db.delete(category)
    db.commit()
    return True, "Category deleted successfully."


AvailabilityFilter = Literal["available", "unavailable", "all"]


def _contains_pattern(value: str) -> str:
    """Escape wildcard characters so search terms remain literal user input."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_products(
    db: Session,
    category_id: int | None = None,
    search: str | None = None,
    availability: AvailabilityFilter = "available",
) -> list[MenuProduct]:
    statement = (
        select(MenuProduct)
        .join(MenuProduct.category)
        .options(joinedload(MenuProduct.category), *_product_options())
        .where(
            MenuProduct.deleted_at.is_(None),
            MenuCategory.is_active.is_(True),
        )
        .order_by(MenuProduct.name)
    )
    if category_id is not None:
        statement = statement.where(MenuProduct.category_id == category_id)
    if availability == "available":
        statement = statement.where(MenuProduct.is_available.is_(True))
    elif availability == "unavailable":
        statement = statement.where(MenuProduct.is_available.is_(False))
    if search is not None and search.strip():
        pattern = f"%{_contains_pattern(search.strip())}%"
        statement = statement.where(or_(
            MenuProduct.name.ilike(pattern, escape="\\"),
            MenuProduct.description.ilike(pattern, escape="\\"),
            MenuCategory.name.ilike(pattern, escape="\\"),
        ))
    return list(db.scalars(statement))


def list_manager_products(
    db: Session,
    category_id: int | None = None,
    search: str | None = None,
    availability: AvailabilityFilter = "all",
) -> list[MenuProduct]:
    statement = (
        select(MenuProduct)
        .join(MenuProduct.category)
        .options(joinedload(MenuProduct.category), *_product_options())
        .where(MenuProduct.deleted_at.is_(None))
        .order_by(MenuProduct.name)
    )
    if category_id is not None:
        statement = statement.where(MenuProduct.category_id == category_id)
    if availability == "available":
        statement = statement.where(MenuProduct.is_available.is_(True))
    elif availability == "unavailable":
        statement = statement.where(MenuProduct.is_available.is_(False))
    if search is not None and search.strip():
        pattern = f"%{_contains_pattern(search.strip())}%"
        statement = statement.where(or_(
            MenuProduct.name.ilike(pattern, escape="\\"),
            MenuProduct.description.ilike(pattern, escape="\\"),
            MenuCategory.name.ilike(pattern, escape="\\"),
        ))
    return list(db.scalars(statement))


def get_product(db: Session, product_id: int) -> MenuProduct | None:
    statement = (
        select(MenuProduct)
        .join(MenuProduct.category)
        .options(joinedload(MenuProduct.category), *_product_options())
        .where(
            MenuProduct.id == product_id,
            MenuProduct.deleted_at.is_(None),
            MenuCategory.is_active.is_(True),
        )
    )
    return db.scalar(statement)


def get_product_any_status(db: Session, product_id: int) -> MenuProduct | None:
    statement = (
        select(MenuProduct)
        .join(MenuProduct.category)
        .options(joinedload(MenuProduct.category), *_product_options())
        .where(
            MenuProduct.id == product_id,
            MenuProduct.deleted_at.is_(None),
        )
    )
    return db.scalar(statement)


def create_product(db: Session, data: ProductCreate) -> MenuProduct:
    category = db.get(MenuCategory, data.category_id)
    if not category:
        raise ValueError(f"Category with id {data.category_id} does not exist.")
    now = datetime.now(timezone.utc)
    product = MenuProduct(
        category_id=data.category_id,
        name=data.name.strip(),
        description=data.description.strip() if data.description else None,
        image_url=data.image_url.strip() if data.image_url else None,
        price=data.price,
        is_available=data.is_available,
        created_at=now,
        updated_at=now,
    )
    db.add(product)
    db.flush()

    default_size = MenuItemSize(
        product_id=product.id,
        code="Regular",
        label="Regular",
        price_adjustment=Decimal("0"),
        display_order=1,
        is_active=True,
    )
    db.add(default_size)
    db.commit()

    return get_product_any_status(db, product.id)  # type: ignore[return-value]


def update_product(db: Session, product_id: int, data: ProductUpdate) -> MenuProduct | None:
    product = get_product_any_status(db, product_id)
    if not product:
        return None
    if data.expected_updated_at is not None and not _timestamps_match(product.updated_at, data.expected_updated_at):
        raise CatalogConflictError("This dish was modified by another manager. Refresh the menu and try again.")
    old_image_url = product.image_url
    if data.category_id is not None:
        category = db.get(MenuCategory, data.category_id)
        if not category:
            raise ValueError(f"Category with id {data.category_id} does not exist.")
        product.category_id = data.category_id
    if data.name is not None:
        product.name = data.name.strip()
    if data.description is not None:
        product.description = data.description.strip() if data.description else None
    if data.image_url is not None:
        product.image_url = data.image_url.strip() if data.image_url else None
    if data.price is not None:
        product.price = data.price
    if data.is_available is not None:
        product.is_available = data.is_available
    product.updated_at = datetime.now(timezone.utc)
    db.commit()
    # Compensating cleanup: if an uploaded image was replaced, remove the old file
    if data.image_url is not None and old_image_url and old_image_url != product.image_url:
        delete_stored_dish_image(old_image_url)
    return get_product_any_status(db, product_id)


def update_product_availability(db: Session, product_id: int, is_available: bool) -> MenuProduct | None:
    product = get_product_any_status(db, product_id)
    if not product:
        return None
    product.is_available = is_available
    product.updated_at = datetime.now(timezone.utc)
    db.commit()
    return get_product_any_status(db, product_id)


def delete_product(db: Session, product_id: int) -> bool:
    product = get_product_any_status(db, product_id)
    if not product:
        return False
    now = datetime.now(timezone.utc)
    product.deleted_at = now
    product.is_available = False
    product.updated_at = now
    db.commit()
    return True
