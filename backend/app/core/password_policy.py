"""Staff credential validation and security policies."""

import re

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


def validate_password_strength(password: str) -> tuple[bool, str]:
    """Validate password against SavoryBites enterprise staff policy.
    
    Requirements:
    - Minimum 12 characters
    - At least 1 uppercase letter
    - At least 1 lowercase letter
    - At least 1 numerical digit
    - At least 1 special character
    """
    if len(password) < 12:
        return False, "Password must be at least 12 characters long."
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter."
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter."
    if not re.search(r"\d", password):
        return False, "Password must contain at least one numeric digit."
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>\-_+=\[\]\\/`~]", password):
        return False, "Password must contain at least one special character."
    return True, ""


def validate_staff_email(email: str) -> tuple[bool, str]:
    """Validate staff email address format."""
    trimmed = email.strip()
    if not trimmed:
        return False, "Email address cannot be blank."
    if not EMAIL_REGEX.match(trimmed):
        return False, "Invalid email address format."
    return True, ""
