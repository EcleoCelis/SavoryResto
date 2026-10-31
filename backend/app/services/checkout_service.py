from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.category import MenuCategory
from app.db.models.product import MenuProduct
from app.db.models.product_option import MenuItemAddon, MenuItemSize
from app.schemas.checkout import CheckoutLineRequest, CheckoutQuoteLine
from app.services.inventory_service import ensure_stock_for_product_quantities

def quote_checkout_items(db: Session, items: list[CheckoutLineRequest]) -> list[CheckoutQuoteLine]:
    product_ids = {item.product_id for item in items}
    statement = (
        select(MenuProduct)
        .join(MenuProduct.category)
        .where(
            MenuProduct.id.in_(product_ids),
            MenuProduct.is_available.is_(True),
            MenuProduct.deleted_at.is_(None),
            MenuCategory.is_active.is_(True),
        )
    )
    products = {product.id: product for product in db.scalars(statement)}

    if len(products) != len(product_ids):
        raise ValueError("One or more cart items are unavailable. Please update your cart and try again.")

    product_quantities: dict[int, Decimal] = {}
    for item in items:
        product_quantities[item.product_id] = product_quantities.get(item.product_id, Decimal("0")) + Decimal(item.quantity)
    ensure_stock_for_product_quantities(db, product_quantities)

    quote_lines: list[CheckoutQuoteLine] = []
    for item in items:
        product = products[item.product_id]
        size = db.scalar(
            select(MenuItemSize).where(
                MenuItemSize.product_id == product.id,
                MenuItemSize.code == item.size,
                MenuItemSize.is_active.is_(True),
            )
        )
        if size is None:
            raise ValueError(f"The selected size is unavailable for {product.name}.")

        addons = list(
            db.scalars(
                select(MenuItemAddon).where(
                    MenuItemAddon.product_id == product.id,
                    MenuItemAddon.code.in_(item.addons),
                    MenuItemAddon.is_active.is_(True),
                )
            )
        )
        if len(addons) != len(item.addons):
            raise ValueError(f"One or more selected add-ons are unavailable for {product.name}.")

        unit_price = Decimal(product.price) + Decimal(size.price_adjustment)
        unit_price += sum((Decimal(addon.price_adjustment) for addon in addons), Decimal("0"))
        quote_lines.append(
            CheckoutQuoteLine(
                cart_line_id=item.cart_line_id,
                product_id=product.id,
                name=product.name,
                quantity=item.quantity,
                unit_price=unit_price,
                subtotal=unit_price * item.quantity,
            )
        )

    return quote_lines
