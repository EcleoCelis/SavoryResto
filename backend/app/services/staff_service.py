from sqlalchemy.orm import Session, joinedload

from app.core.security import verify_password
from app.db.models.staff import StaffUser


ALLOWED_STAFF_ROLES = frozenset({"kitchen_staff", "manager"})


def authenticate_staff(db: Session, email: str, password: str) -> StaffUser | None:
    staff_user = db.query(StaffUser).options(joinedload(StaffUser.role)).filter(StaffUser.email == email.lower()).first()
    if staff_user is None or staff_user.status != "active" or staff_user.password_hash is None:
        return None
    if not verify_password(password, staff_user.password_hash):
        return None
    return staff_user
