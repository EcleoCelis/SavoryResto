from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.inventory import InventoryItem, InventoryTransaction, MenuItemIngredient
from app.db.models.order import Order
from app.db.models.staff import StaffUser
from app.schemas.inventory import InventoryItemResponse, InventoryTransactionCreate, InventoryTransactionResponse


ORDER_CONFIRMATION_REFERENCE = "order_confirmation"
ORDER_CANCELLATION_REFERENCE = "order_cancellation"


def stock_status(item: InventoryItem) -> str:
    if item.current_stock <= 0:
        return "out_of_stock"
    if item.current_stock <= item.reorder_level:
        return "low_stock"
    return "normal"


def serialize_item(item: InventoryItem) -> InventoryItemResponse:
    return InventoryItemResponse(
        id=item.id,
        name=item.name,
        sku=item.sku,
        unit=item.unit,
        current_stock=item.current_stock,
        reorder_level=item.reorder_level,
        unit_cost=item.unit_cost,
        is_active=item.is_active,
        stock_status=stock_status(item),
        updated_at=item.updated_at,
    )


def list_inventory_items(db: Session, low_stock_only: bool = False) -> list[InventoryItemResponse]:
    statement = select(InventoryItem).where(InventoryItem.deleted_at.is_(None)).order_by(InventoryItem.name)
    if low_stock_only:
        statement = statement.where(InventoryItem.is_active.is_(True), InventoryItem.current_stock <= InventoryItem.reorder_level)
    return [serialize_item(item) for item in db.scalars(statement)]


def _requirements_for_order(db: Session, order: Order) -> dict[int, Decimal]:
    product_quantities = defaultdict(Decimal)
    for item in order.items:
        product_quantities[item.menu_item_id] += Decimal(item.quantity)
    if not product_quantities:
        return {}

    requirements = defaultdict(Decimal)
    recipes = db.scalars(
        select(MenuItemIngredient).where(MenuItemIngredient.menu_item_id.in_(product_quantities))
    )
    for recipe in recipes:
        requirements[recipe.inventory_item_id] += Decimal(recipe.quantity_required) * product_quantities[recipe.menu_item_id]
    return dict(requirements)


def ensure_stock_for_product_quantities(db: Session, product_quantities: dict[int, Decimal]) -> None:
    if not product_quantities:
        return
    requirements = defaultdict(Decimal)
    recipes = db.scalars(select(MenuItemIngredient).where(MenuItemIngredient.menu_item_id.in_(product_quantities)))
    for recipe in recipes:
        requirements[recipe.inventory_item_id] += Decimal(recipe.quantity_required) * product_quantities[recipe.menu_item_id]
    if not requirements:
        return
    items = {item.id: item for item in db.scalars(select(InventoryItem).where(InventoryItem.id.in_(requirements)))}
    for item_id, required in requirements.items():
        item = items.get(item_id)
        if item is None or not item.is_active or item.deleted_at is not None or item.current_stock < required:
            name = item.name if item is not None else "a required ingredient"
            raise ValueError(f"Insufficient stock for {name}.")


def deduct_inventory_for_confirmed_order(db: Session, order: Order, performed_by: StaffUser) -> None:
    requirements = _requirements_for_order(db, order)
    if not requirements:
        return

    existing = list(db.scalars(select(InventoryTransaction).where(
        InventoryTransaction.reference_type == ORDER_CONFIRMATION_REFERENCE,
        InventoryTransaction.reference_id == order.id,
        InventoryTransaction.transaction_type == "sale",
    )))
    if existing:
        if len(existing) == len(requirements):
            return
        raise RuntimeError("The order has an incomplete inventory deduction record.")

    items = list(db.scalars(
        select(InventoryItem)
        .where(InventoryItem.id.in_(requirements))
        .order_by(InventoryItem.id)
        .with_for_update()
    ))
    items_by_id = {item.id: item for item in items}
    for item_id, required in requirements.items():
        item = items_by_id.get(item_id)
        if item is None or not item.is_active or item.deleted_at is not None or item.current_stock < required:
            name = item.name if item is not None else "a required ingredient"
            raise ValueError(f"Insufficient stock for {name}; the order cannot be confirmed.")

    now = datetime.now(timezone.utc)
    for item_id, required in requirements.items():
        item = items_by_id[item_id]
        item.current_stock -= required
        item.updated_at = now
        db.add(InventoryTransaction(
            inventory_item_id=item.id,
            performed_by=performed_by.id,
            transaction_type="sale",
            quantity_change=-required,
            unit_cost=item.unit_cost,
            reference_type=ORDER_CONFIRMATION_REFERENCE,
            reference_id=order.id,
            notes=f"Order {order.order_number} confirmed.",
            created_at=now,
        ))


def restore_inventory_for_cancelled_order(db: Session, order: Order) -> None:
    """Restore deducted stock once when a confirmed order is cancelled."""
    sale_transactions = list(
        db.scalars(
            select(InventoryTransaction).where(
                InventoryTransaction.reference_type == ORDER_CONFIRMATION_REFERENCE,
                InventoryTransaction.reference_id == order.id,
                InventoryTransaction.transaction_type == "sale",
            )
        )
    )
    if not sale_transactions:
        return

    already_restored = db.scalar(
        select(InventoryTransaction.id).where(
            InventoryTransaction.reference_type == ORDER_CANCELLATION_REFERENCE,
            InventoryTransaction.reference_id == order.id,
            InventoryTransaction.transaction_type == "return",
        )
    )
    if already_restored is not None:
        return

    item_ids = sorted({tx.inventory_item_id for tx in sale_transactions})
    items = list(
        db.scalars(
            select(InventoryItem)
            .where(InventoryItem.id.in_(item_ids))
            .order_by(InventoryItem.id)
            .with_for_update()
        )
    )
    items_by_id = {item.id: item for item in items}
    now = datetime.now(timezone.utc)

    for sale_tx in sale_transactions:
        item = items_by_id.get(sale_tx.inventory_item_id)
        if item is None:
            continue
        restore_qty = abs(Decimal(sale_tx.quantity_change))
        if restore_qty <= 0:
            continue
        item.current_stock += restore_qty
        item.updated_at = now
        db.add(
            InventoryTransaction(
                inventory_item_id=item.id,
                performed_by=sale_tx.performed_by,
                transaction_type="return",
                quantity_change=restore_qty,
                unit_cost=sale_tx.unit_cost if sale_tx.unit_cost is not None else item.unit_cost,
                reference_type=ORDER_CANCELLATION_REFERENCE,
                reference_id=order.id,
                notes=f"Order {order.order_number} cancelled by customer; stock restored.",
                created_at=now,
            )
        )


def record_inventory_transaction(
    db: Session,
    item_id: int,
    request: InventoryTransactionCreate,
    performed_by: StaffUser,
) -> InventoryTransactionResponse | None:
    item = db.scalar(select(InventoryItem).where(InventoryItem.id == item_id, InventoryItem.deleted_at.is_(None)).with_for_update())
    if item is None:
        return None
    change = request.quantity_change
    if item.current_stock + change < 0:
        raise ValueError("This transaction would make stock negative.")

    before = Decimal(item.current_stock)
    now = datetime.now(timezone.utc)
    item.current_stock = before + change
    item.updated_at = now
    transaction = InventoryTransaction(
        inventory_item_id=item.id,
        performed_by=performed_by.id,
        transaction_type=request.transaction_type,
        quantity_change=change,
        unit_cost=item.unit_cost,
        notes=request.notes,
        created_at=now,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return InventoryTransactionResponse(
        id=transaction.id,
        inventory_item_id=item.id,
        inventory_item_name=item.name,
        transaction_type=transaction.transaction_type,
        quantity_change=transaction.quantity_change,
        stock_before=before,
        stock_after=item.current_stock,
        unit_cost=transaction.unit_cost,
        reference_type=transaction.reference_type,
        reference_id=transaction.reference_id,
        notes=transaction.notes,
        performed_by=transaction.performed_by,
        created_at=transaction.created_at,
    )


def list_inventory_transactions(db: Session, item_id: int | None = None) -> list[InventoryTransactionResponse]:
    statement = select(InventoryTransaction, InventoryItem.name).join(InventoryItem).order_by(InventoryTransaction.created_at.desc(), InventoryTransaction.id.desc())
    if item_id is not None:
        statement = statement.where(InventoryTransaction.inventory_item_id == item_id)
    balances: dict[int, Decimal] = {}
    result: list[InventoryTransactionResponse] = []
    for transaction, item_name in db.execute(statement):
        after = balances.get(transaction.inventory_item_id)
        if after is None:
            current = db.scalar(select(InventoryItem.current_stock).where(InventoryItem.id == transaction.inventory_item_id))
            after = Decimal(current)
        before = after - Decimal(transaction.quantity_change)
        balances[transaction.inventory_item_id] = before
        result.append(InventoryTransactionResponse(
            id=transaction.id, inventory_item_id=transaction.inventory_item_id, inventory_item_name=item_name,
            transaction_type=transaction.transaction_type, quantity_change=transaction.quantity_change,
            stock_before=before, stock_after=after, unit_cost=transaction.unit_cost,
            reference_type=transaction.reference_type, reference_id=transaction.reference_id,
            notes=transaction.notes, performed_by=transaction.performed_by, created_at=transaction.created_at,
        ))
    return result
