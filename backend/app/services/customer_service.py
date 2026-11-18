from datetime import datetime, timezone
from decimal import Decimal
import logging

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.order_status import OrderStatus
from app.core.password_policy import validate_password_strength
from app.core.security import hash_password, verify_password
from app.db.models.address import CustomerAddress
from app.db.models.category import MenuCategory
from app.db.models.customer import Customer
from app.db.models.favorite import CustomerFavorite
from app.db.models.inventory import MenuItemIngredient
from app.db.models.order import Order
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemAddon, MenuItemSize
from app.db.models.staff import StaffUser
from app.schemas.customer import (
    AddressCreateRequest,
    AddressUpdateRequest,
    CustomerDeactivateRequest,
    CustomerEmailChangeRequest,
    CustomerPasswordChangeRequest,
    CustomerPreferencesUpdateRequest,
    CustomerProfileUpdateRequest,
    FavoriteProductResponse,
    ManagerCustomerDetailResponse,
    ManagerCustomerListResponse,
    ManagerCustomerOrderSummary,
    ManagerCustomerStatusUpdateRequest,
    ManagerCustomerSummaryResponse,
)
from app.schemas.product import ProductResponse
from app.services.audit_service import record_audit_event
from app.services.email_service import email_service
from app.services.media_storage_service import delete_stored_avatar_image, save_customer_avatar
from app.services.payment_method_service import get_active_payment_method

logger = logging.getLogger("savorybites.customer")

ALLERGEN_LABELS: dict[str, str] = {
    "peanuts": "Peanuts",
    "tree_nuts": "Tree Nuts",
    "milk_dairy": "Milk / Dairy",
    "eggs": "Eggs",
    "shellfish": "Shellfish",
    "fish": "Fish",
    "soy": "Soy",
    "wheat_gluten": "Wheat / Gluten",
    "sesame": "Sesame",
}


def _format_address_summary(address: CustomerAddress) -> str:
    parts = [address.street_address]
    if address.barangay:
        parts.append(f"Brgy. {address.barangay}")
    parts.append(address.city)
    return ", ".join(part for part in parts if part)


def format_operational_allergy_alert(customer: Customer) -> str | None:
    """Build a concise operational kitchen alert only when explicit allergy consent exists."""
    if not customer.allergy_consent_given or not customer.share_allergy_with_kitchen:
        return None
    segments: list[str] = []
    if customer.allergy_flags:
        labels = [ALLERGEN_LABELS.get(flag, flag.replace("_", " ").title()) for flag in customer.allergy_flags]
        segments.append(f"Allergens: {', '.join(labels)}")
    if customer.disliked_ingredients and customer.disliked_ingredients.strip():
        segments.append(f"Avoid: {customer.disliked_ingredients.strip()}")
    if not segments:
        return None
    return " | ".join(segments)


def update_customer_profile(
    db: Session,
    customer: Customer,
    request: CustomerProfileUpdateRequest,
) -> Customer:
    if request.phone and request.phone != customer.phone:
        existing = db.scalar(
            select(Customer).where(
                Customer.phone == request.phone,
                Customer.customer_id != customer.customer_id,
            )
        )
        if existing:
            raise ValueError("An account with this mobile number already exists.")
        customer.phone = request.phone
    elif request.phone is None:
        customer.phone = None

    customer.full_name = request.full_name.strip()
    db.commit()
    db.refresh(customer)
    return customer


def change_customer_email(
    db: Session,
    customer: Customer,
    request: CustomerEmailChangeRequest,
    ip_address: str | None = None,
) -> Customer:
    if not customer.password_hash or not verify_password(request.current_password, customer.password_hash):
        raise PermissionError("Current password is incorrect.")

    normalized_email = str(request.new_email).strip().lower()
    if normalized_email == (customer.email or "").lower():
        raise ValueError("Your new email address must differ from your current email address.")

    existing = db.scalar(
        select(Customer).where(
            func.lower(Customer.email) == normalized_email,
            Customer.customer_id != customer.customer_id,
        )
    )
    if existing:
        raise ValueError("An account with this email address already exists.")

    previous_email = customer.email
    customer.email = normalized_email
    db.commit()
    db.refresh(customer)

    record_audit_event(
        db=db,
        event_type="customer.email_change",
        actor_type="customer",
        actor_id=customer.customer_id,
        actor_email=normalized_email,
        target_type="customer",
        target_id=str(customer.customer_id),
        outcome="success",
        ip_address=ip_address,
        details={"previous_email": previous_email, "new_email": normalized_email},
    )

    try:
        if previous_email:
            email_service.send_security_alert_email(
                to_email=previous_email,
                customer_name=customer.full_name,
                event_summary=f"Your SavoryBites account email was updated to {normalized_email}.",
            )
        email_service.send_security_alert_email(
            to_email=normalized_email,
            customer_name=customer.full_name,
            event_summary="Your SavoryBites account email address was updated successfully.",
        )
    except Exception as exc:
        logger.warning("Security notification email failed after email change: %s", exc)

    return customer


def update_customer_avatar(
    db: Session,
    customer: Customer,
    file_bytes: bytes,
    original_filename: str | None = None,
) -> Customer:
    upload_result = save_customer_avatar(file_bytes, original_filename)
    previous_avatar = customer.avatar_url
    customer.avatar_url = upload_result["image_url"]
    try:
        db.commit()
        db.refresh(customer)
    except Exception:
        db.rollback()
        delete_stored_avatar_image(upload_result["image_url"])
        raise

    if previous_avatar and previous_avatar != customer.avatar_url:
        delete_stored_avatar_image(previous_avatar)
    return customer


def remove_customer_avatar(db: Session, customer: Customer) -> Customer:
    previous_avatar = customer.avatar_url
    customer.avatar_url = None
    db.commit()
    db.refresh(customer)
    if previous_avatar:
        delete_stored_avatar_image(previous_avatar)
    return customer


def update_customer_preferences(
    db: Session,
    customer: Customer,
    request: CustomerPreferencesUpdateRequest,
) -> Customer:
    now = datetime.now(timezone.utc)

    if request.preferred_payment_code is not None:
        payment_method = get_active_payment_method(db, request.preferred_payment_code)
        if payment_method is None:
            raise ValueError("Selected payment preference is currently unavailable.")

    valid_category_ids: list[int] = []
    if request.preferred_category_ids:
        valid_category_ids = list(
            db.scalars(
                select(MenuCategory.id).where(
                    MenuCategory.id.in_(request.preferred_category_ids),
                    MenuCategory.is_active.is_(True),
                )
            )
        )
        if len(valid_category_ids) != len(request.preferred_category_ids):
            raise ValueError("One or more selected favorite categories are invalid or inactive.")

    customer.preferred_payment_code = request.preferred_payment_code
    customer.default_order_type = request.default_order_type
    customer.dietary_preferences = request.dietary_preferences
    customer.preferred_category_ids = valid_category_ids
    customer.theme_preference = request.theme_preference

    if request.allergy_consent_given:
        if not customer.allergy_consent_given:
            customer.allergy_consent_at = now
        customer.allergy_consent_given = True
        customer.allergy_flags = request.allergy_flags
        customer.disliked_ingredients = request.disliked_ingredients.strip() if request.disliked_ingredients else None
        customer.share_allergy_with_kitchen = request.share_allergy_with_kitchen
    else:
        customer.allergy_consent_given = False
        customer.allergy_consent_at = None
        customer.allergy_flags = []
        customer.disliked_ingredients = None
        customer.share_allergy_with_kitchen = False

    customer.email_order_updates = request.email_order_updates
    if request.email_promotions and not customer.email_promotions:
        customer.marketing_consent_at = now
    elif not request.email_promotions:
        customer.marketing_consent_at = None
    customer.email_promotions = request.email_promotions
    customer.preferences_updated_at = now

    db.commit()
    db.refresh(customer)
    return customer


def change_customer_password(
    db: Session,
    customer: Customer,
    request: CustomerPasswordChangeRequest,
    ip_address: str | None = None,
) -> Customer:
    if not customer.password_hash or not verify_password(request.current_password, customer.password_hash):
        raise PermissionError("Current password is incorrect.")

    valid, err_msg = validate_password_strength(request.new_password)
    if not valid:
        raise ValueError(err_msg or "Password does not meet security requirements.")

    now = datetime.now(timezone.utc)
    customer.password_hash = hash_password(request.new_password)
    customer.password_changed_at = now
    db.commit()
    db.refresh(customer)

    record_audit_event(
        db=db,
        event_type="customer.password_change",
        actor_type="customer",
        actor_id=customer.customer_id,
        actor_email=customer.email,
        target_type="customer",
        target_id=str(customer.customer_id),
        outcome="success",
        ip_address=ip_address,
    )

    try:
        if customer.email:
            email_service.send_security_alert_email(
                to_email=customer.email,
                customer_name=customer.full_name,
                event_summary="Your SavoryBites account password was changed.",
            )
    except Exception as exc:
        logger.warning("Security alert email failed after password change: %s", exc)

    return customer


def deactivate_customer_account(
    db: Session,
    customer: Customer,
    request: CustomerDeactivateRequest,
    ip_address: str | None = None,
) -> None:
    if not request.confirm_deactivation:
        raise ValueError("Account deactivation confirmation is required.")

    if not customer.password_hash or not verify_password(request.current_password, customer.password_hash):
        raise PermissionError("Current password is incorrect.")

    now = datetime.now(timezone.utc)
    previous_avatar = customer.avatar_url
    customer.is_active = False
    customer.deactivated_at = now
    customer.password_changed_at = now
    customer.avatar_url = None
    customer.allergy_consent_given = False
    customer.allergy_consent_at = None
    customer.allergy_flags = []
    customer.disliked_ingredients = None
    customer.share_allergy_with_kitchen = False
    customer.email_promotions = False
    customer.marketing_consent_at = None

    db.commit()

    if previous_avatar:
        delete_stored_avatar_image(previous_avatar)

    record_audit_event(
        db=db,
        event_type="customer.deactivate",
        actor_type="customer",
        actor_id=customer.customer_id,
        actor_email=customer.email,
        target_type="customer",
        target_id=str(customer.customer_id),
        outcome="success",
        ip_address=ip_address,
        details={"reason": request.reason} if request.reason else None,
    )


def list_customer_favorites(db: Session, customer_id: int) -> list[FavoriteProductResponse]:
    statement = (
        select(CustomerFavorite)
        .join(CustomerFavorite.product)
        .join(MenuProduct.category)
        .options(
            joinedload(CustomerFavorite.product).joinedload(MenuProduct.category),
            joinedload(CustomerFavorite.product).selectinload(MenuProduct.sizes.and_(MenuItemSize.is_active.is_(True))),
            joinedload(CustomerFavorite.product).selectinload(MenuProduct.addons.and_(MenuItemAddon.is_active.is_(True))),
            joinedload(CustomerFavorite.product)
            .selectinload(MenuProduct.ingredients)
            .selectinload(MenuItemIngredient.inventory_item),
        )
        .where(
            CustomerFavorite.customer_id == customer_id,
            MenuProduct.deleted_at.is_(None),
            MenuCategory.is_active.is_(True),
        )
        .order_by(CustomerFavorite.created_at.desc())
    )
    rows = db.scalars(statement).unique().all()
    return [
        FavoriteProductResponse(
            product_id=fav.menu_item_id,
            favorited_at=fav.created_at,
            product=ProductResponse.model_validate(fav.product),
        )
        for fav in rows
    ]


def add_customer_favorite(db: Session, customer_id: int, product_id: int) -> FavoriteProductResponse:
    product = db.scalar(
        select(MenuProduct)
        .join(MenuProduct.category)
        .options(
            joinedload(MenuProduct.category),
            selectinload(MenuProduct.sizes.and_(MenuItemSize.is_active.is_(True))),
            selectinload(MenuProduct.addons.and_(MenuItemAddon.is_active.is_(True))),
            selectinload(MenuProduct.ingredients).selectinload(MenuItemIngredient.inventory_item),
        )
        .where(
            MenuProduct.id == product_id,
            MenuProduct.deleted_at.is_(None),
            MenuCategory.is_active.is_(True),
        )
    )
    if product is None:
        raise ValueError("Menu dish not found.")

    existing = db.scalar(
        select(CustomerFavorite).where(
            CustomerFavorite.customer_id == customer_id,
            CustomerFavorite.menu_item_id == product_id,
        )
    )
    if existing is None:
        existing = CustomerFavorite(
            customer_id=customer_id,
            menu_item_id=product_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(existing)
        db.commit()
        db.refresh(existing)

    return FavoriteProductResponse(
        product_id=existing.menu_item_id,
        favorited_at=existing.created_at,
        product=ProductResponse.model_validate(product),
    )


def remove_customer_favorite(db: Session, customer_id: int, product_id: int) -> bool:
    fav = db.scalar(
        select(CustomerFavorite).where(
            CustomerFavorite.customer_id == customer_id,
            CustomerFavorite.menu_item_id == product_id,
        )
    )
    if fav is None:
        return False
    db.delete(fav)
    db.commit()
    return True


def list_customer_addresses(db: Session, customer_id: int) -> list[CustomerAddress]:
    statement = (
        select(CustomerAddress)
        .where(CustomerAddress.customer_id == customer_id)
        .order_by(CustomerAddress.is_default.desc(), CustomerAddress.created_at.desc())
    )
    return list(db.scalars(statement))


def get_customer_address(db: Session, customer_id: int, address_id: int) -> CustomerAddress | None:
    statement = select(CustomerAddress).where(
        CustomerAddress.id == address_id,
        CustomerAddress.customer_id == customer_id,
    )
    return db.scalar(statement)


def create_customer_address(
    db: Session,
    customer_id: int,
    request: AddressCreateRequest,
) -> CustomerAddress:
    count = db.scalar(
        select(func.count(CustomerAddress.id)).where(CustomerAddress.customer_id == customer_id)
    ) or 0

    should_be_default = count == 0 or request.is_default
    if should_be_default:
        db.query(CustomerAddress).filter(CustomerAddress.customer_id == customer_id).update(
            {CustomerAddress.is_default: False}
        )

    now = datetime.now(timezone.utc)
    address = CustomerAddress(
        customer_id=customer_id,
        label=request.label.strip(),
        recipient_name=request.recipient_name.strip(),
        phone=request.phone.strip(),
        street_address=request.street_address.strip(),
        barangay=request.barangay.strip() if request.barangay else None,
        city=request.city.strip(),
        state_province=request.state_province.strip() if request.state_province else None,
        postal_code=request.postal_code.strip() if request.postal_code else None,
        delivery_instructions=request.delivery_instructions.strip() if request.delivery_instructions else None,
        is_default=should_be_default,
        created_at=now,
        updated_at=now,
    )
    db.add(address)

    if should_be_default:
        customer = db.get(Customer, customer_id)
        if customer:
            customer.address = _format_address_summary(address)

    db.commit()
    db.refresh(address)
    return address


def update_customer_address(
    db: Session,
    customer_id: int,
    address_id: int,
    request: AddressUpdateRequest,
) -> CustomerAddress | None:
    address = get_customer_address(db, customer_id, address_id)
    if address is None:
        return None

    if request.is_default is True:
        db.query(CustomerAddress).filter(CustomerAddress.customer_id == customer_id).update(
            {CustomerAddress.is_default: False}
        )
        address.is_default = True

    if request.label is not None:
        address.label = request.label.strip()
    if request.recipient_name is not None:
        address.recipient_name = request.recipient_name.strip()
    if request.phone is not None:
        address.phone = request.phone.strip()
    if request.street_address is not None:
        address.street_address = request.street_address.strip()
    if "barangay" in request.model_fields_set:
        address.barangay = request.barangay.strip() if request.barangay else None
    if request.city is not None:
        address.city = request.city.strip()
    if "state_province" in request.model_fields_set:
        address.state_province = request.state_province.strip() if request.state_province else None
    if "postal_code" in request.model_fields_set:
        address.postal_code = request.postal_code.strip() if request.postal_code else None
    if "delivery_instructions" in request.model_fields_set:
        address.delivery_instructions = (
            request.delivery_instructions.strip() if request.delivery_instructions else None
        )

    address.updated_at = datetime.now(timezone.utc)

    if address.is_default:
        customer = db.get(Customer, customer_id)
        if customer:
            customer.address = _format_address_summary(address)

    db.commit()
    db.refresh(address)
    return address


def set_default_address(
    db: Session,
    customer_id: int,
    address_id: int,
) -> CustomerAddress | None:
    address = get_customer_address(db, customer_id, address_id)
    if address is None:
        return None

    db.query(CustomerAddress).filter(CustomerAddress.customer_id == customer_id).update(
        {CustomerAddress.is_default: False}
    )
    address.is_default = True
    address.updated_at = datetime.now(timezone.utc)

    customer = db.get(Customer, customer_id)
    if customer:
        customer.address = _format_address_summary(address)

    db.commit()
    db.refresh(address)
    return address


def delete_customer_address(
    db: Session,
    customer_id: int,
    address_id: int,
) -> bool:
    address = get_customer_address(db, customer_id, address_id)
    if address is None:
        return False

    was_default = address.is_default
    db.delete(address)
    db.flush()

    if was_default:
        next_addr = db.scalars(
            select(CustomerAddress)
            .where(CustomerAddress.customer_id == customer_id)
            .order_by(CustomerAddress.created_at.desc())
        ).first()

        customer = db.get(Customer, customer_id)
        if next_addr:
            next_addr.is_default = True
            if customer:
                customer.address = _format_address_summary(next_addr)
        elif customer:
            customer.address = None

    db.commit()
    return True


def _serialize_manager_customer_summary(
    customer: Customer,
    order_count: int,
    total_spent: Decimal,
    last_order_at: datetime | None,
) -> ManagerCustomerSummaryResponse:
    return ManagerCustomerSummaryResponse(
        customer_id=customer.customer_id,
        full_name=customer.full_name,
        email=customer.email,
        phone=customer.phone,
        is_active=customer.is_active,
        created_at=customer.created_at,
        deactivated_at=customer.deactivated_at,
        order_count=int(order_count or 0),
        total_spent=total_spent or Decimal("0.00"),
        last_order_at=last_order_at,
    )


def list_manager_customers(
    db: Session,
    *,
    search: str | None = None,
    status_filter: str = "all",
    page: int = 1,
    page_size: int = 20,
) -> ManagerCustomerListResponse:
    filters = []
    if status_filter == "active":
        filters.append(Customer.is_active.is_(True))
    elif status_filter == "deactivated":
        filters.append(Customer.is_active.is_(False))

    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        filters.append(
            or_(
                Customer.full_name.ilike(pattern, escape="\\"),
                Customer.email.ilike(pattern, escape="\\"),
                Customer.phone.ilike(pattern, escape="\\"),
            )
        )

    total = db.scalar(select(func.count(Customer.customer_id)).where(*filters)) or 0

    order_agg = (
        select(
            Order.customer_id.label("cust_id"),
            func.count(Order.id).filter(Order.status != OrderStatus.CANCELLED.value).label("order_count"),
            func.coalesce(
                func.sum(Order.total_amount).filter(Order.status == OrderStatus.COMPLETED.value),
                0,
            ).label("total_spent"),
            func.max(Order.ordered_at).label("last_order_at"),
        )
        .group_by(Order.customer_id)
        .subquery()
    )

    stmt = (
        select(
            Customer,
            func.coalesce(order_agg.c.order_count, 0),
            func.coalesce(order_agg.c.total_spent, 0),
            order_agg.c.last_order_at,
        )
        .outerjoin(order_agg, order_agg.c.cust_id == Customer.customer_id)
        .where(*filters)
        .order_by(Customer.customer_id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = db.execute(stmt).all()
    items = [
        _serialize_manager_customer_summary(cust, count, Decimal(str(spent)), last_at)
        for cust, count, spent, last_at in rows
    ]
    return ManagerCustomerListResponse(items=items, page=page, page_size=page_size, total=total)


def get_manager_customer_detail(db: Session, customer_id: int) -> ManagerCustomerDetailResponse | None:
    customer = db.get(Customer, customer_id)
    if customer is None:
        return None

    orders = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.restaurant_table))
            .where(Order.customer_id == customer_id)
            .order_by(Order.ordered_at.desc(), Order.id.desc())
            .limit(20)
        )
    )

    non_cancelled_count = db.scalar(
        select(func.count(Order.id)).where(
            Order.customer_id == customer_id,
            Order.status != OrderStatus.CANCELLED.value,
        )
    ) or 0
    total_spent = db.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.customer_id == customer_id,
            Order.status == OrderStatus.COMPLETED.value,
        )
    ) or Decimal("0.00")
    last_order_at = orders[0].ordered_at if orders else None

    saved_addresses_count = db.scalar(
        select(func.count(CustomerAddress.id)).where(CustomerAddress.customer_id == customer_id)
    ) or 0

    return ManagerCustomerDetailResponse(
        customer=_serialize_manager_customer_summary(
            customer,
            non_cancelled_count,
            Decimal(str(total_spent)),
            last_order_at,
        ),
        default_address=customer.address,
        saved_addresses_count=saved_addresses_count,
        marketing_opt_in=bool(customer.email_promotions),
        operational_allergy_alert=format_operational_allergy_alert(customer),
        recent_orders=[
            ManagerCustomerOrderSummary(
                id=order.id,
                order_number=order.order_number,
                status=order.status,
                order_type=order.order_type,
                fulfillment_type=order.fulfillment_type,
                table_number=order.restaurant_table.table_number if order.restaurant_table else None,
                total=order.total_amount,
                ordered_at=order.ordered_at,
            )
            for order in orders
        ],
    )


def update_manager_customer_status(
    db: Session,
    *,
    staff_user: StaffUser,
    customer_id: int,
    request: ManagerCustomerStatusUpdateRequest,
    ip_address: str | None = None,
) -> ManagerCustomerDetailResponse | None:
    customer = db.scalar(
        select(Customer).where(Customer.customer_id == customer_id).with_for_update()
    )
    if customer is None:
        return None

    now = datetime.now(timezone.utc)
    if not request.is_active and (not request.reason or len(request.reason.strip()) < 3):
        raise ValueError("Please provide a brief reason before deactivating a customer account.")

    previous_status = customer.is_active
    customer.is_active = request.is_active
    if not request.is_active:
        customer.deactivated_at = now
        customer.password_changed_at = now
    else:
        customer.deactivated_at = None

    db.commit()
    db.refresh(customer)

    record_audit_event(
        db=db,
        event_type="manager.customer_status_update",
        actor_type="staff",
        actor_id=staff_user.id,
        actor_email=staff_user.email,
        target_type="customer",
        target_id=str(customer.customer_id),
        outcome="success",
        ip_address=ip_address,
        details={
            "previous_is_active": previous_status,
            "new_is_active": request.is_active,
            "reason": request.reason,
        },
    )

    return get_manager_customer_detail(db, customer_id)
