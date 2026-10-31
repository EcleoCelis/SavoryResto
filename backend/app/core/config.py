from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    DATABASE_URL: str
    FRONTEND_URL: str = "http://localhost:3000"
    ENVIRONMENT: str = "development"
    COOKIE_SECURE: bool | None = None

    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    STAFF_ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    REMEMBER_ME_EXPIRE_DAYS: int = 30

    # Password Reset & Recovery
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30
    PASSWORD_RESET_RATE_LIMIT_MINUTES: int = 15
    PASSWORD_RESET_MAX_PER_EMAIL: int = 3
    PASSWORD_RESET_MAX_PER_IP: int = 10

    # Transactional Email / SMTP
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_TLS: bool = True
    EMAILS_FROM_EMAIL: str = "noreply@savorybites.com"
    EMAILS_FROM_NAME: str = "SavoryBites Restaurant"

    # Media and Upload Storage
    MEDIA_DIR: Path = BASE_DIR / "media"
    MAX_UPLOAD_SIZE_BYTES: int = 5 * 1024 * 1024  # 5 MB
    ALLOWED_IMAGE_TYPES: tuple[str, ...] = ("image/jpeg", "image/png", "image/webp")

    # Reverse Proxy & Security Hardening
    TRUSTED_PROXIES: str = "127.0.0.1,::1"
    ALLOWED_CORS_ORIGINS: str | None = None

    @property
    def cookie_secure(self) -> bool:
        """Use secure cookies outside local development unless explicitly configured."""
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE

        return self.ENVIRONMENT.lower() not in {
            "development",
            "local",
            "test",
            "testing",
        }

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.FRONTEND_URL.rstrip("/")]
        if self.ENVIRONMENT.lower() in ("development", "local", "test", "testing"):
            origins.extend(["http://localhost:3000", "http://127.0.0.1:3000"])
        if self.ALLOWED_CORS_ORIGINS:
            origins.extend([o.strip().rstrip("/") for o in self.ALLOWED_CORS_ORIGINS.split(",") if o.strip()])
        # Deduplicate preserving order
        return list(dict.fromkeys(origins))

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.ENVIRONMENT.lower() in ("production", "prod"):
            if len(self.JWT_SECRET_KEY) < 32:
                raise ValueError(
                    "Production security requirement: JWT_SECRET_KEY must have at least 32 characters."
                )
            if "ndkHD0154eXrBigjbbXDDiCncEcowPl" in self.JWT_SECRET_KEY:
                raise ValueError(
                    "Production security requirement: JWT_SECRET_KEY must be changed from the development template key."
                )
        return self

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        case_sensitive=True,
    )


settings = Settings()
