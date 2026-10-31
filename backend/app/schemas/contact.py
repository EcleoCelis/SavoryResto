import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ContactInquiryRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    subject: str = Field(min_length=3, max_length=150)
    message: str = Field(min_length=10, max_length=3000)

    @field_validator("name", "subject")
    @classmethod
    def sanitize_single_line_headers(cls, value: str) -> str:
        # Prevent email header injection by rejecting or stripping newline characters
        sanitized = re.sub(r"[\r\n]+", " ", value).strip()
        if not sanitized:
            raise ValueError("Field cannot be empty or contain only line breaks.")
        return sanitized


class ContactInquiryResponse(BaseModel):
    message: str
