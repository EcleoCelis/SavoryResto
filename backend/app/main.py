import logging
import traceback

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.routes.auth import router as auth_router
from app.api.routes.categories import router as categories_router
from app.api.routes.checkout import router as checkout_router
from app.api.routes.contact import router as contact_router
from app.api.routes.customer import router as customer_router
from app.api.routes.inventory import router as inventory_router
from app.api.routes.kds import router as kds_router
from app.api.routes.manager import router as manager_router
from app.api.routes.media import router as media_router
from app.api.routes.orders import router as orders_router
from app.api.routes.payment_methods import router as payment_methods_router
from app.api.routes.products import router as products_router
from app.api.routes.restaurant_tables import router as restaurant_tables_router
from app.api.routes.staff_auth import router as staff_auth_router
from app.core.config import settings
from app.db.database import get_db

logger = logging.getLogger("savorybites.api")

app = FastAPI(
    title="SavoryBites Restaurant System API",
    description="Backend API for SavoryBites restaurant operations, menu, ordering, and customer accounts.",
    version="1.0.0",
)


# Security Headers & Cache-Control Middleware
@app.middleware("http")
async def apply_security_headers(request: Request, call_next):
    response: Response = await call_next(request)

    # Core Security Headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

    # Apply strict CSP for API routes (exclude Swagger UI / OpenAPI documentation)
    path = request.url.path
    if path.startswith("/api/"):
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"

    # Cache Prevention on Sensitive Authenticated Endpoints
    if any(
        path.startswith(prefix)
        for prefix in (
            "/api/v1/auth",
            "/api/v1/checkout",
            "/api/v1/customers",
            "/api/v1/orders",
            "/api/v1/manager",
            "/api/v1/kds",
            "/api/v1/staff",
        )
    ):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        response.headers["Pragma"] = "no-cache"

    return response


# Global Unhandled Exception Handler (prevents leaking internal traces while preserving HTTP exceptions)
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )
    if isinstance(exc, RequestValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": exc.errors()},
        )

    logger.error(
        "Unhandled server error on %s %s: %s\n%s",
        request.method,
        request.url.path,
        exc,
        traceback.format_exc(),
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal error occurred while processing your request. Please try again later."},
    )


# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=[
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
    ],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
    ],
)

# Route Mounting
app.include_router(auth_router)
app.include_router(contact_router)
app.include_router(customer_router)
app.include_router(categories_router)
app.include_router(checkout_router)
app.include_router(products_router)
app.include_router(orders_router)
app.include_router(payment_methods_router)
app.include_router(restaurant_tables_router)
app.include_router(staff_auth_router)
app.include_router(kds_router)
app.include_router(manager_router)
app.include_router(inventory_router)
app.include_router(media_router)


@app.get("/")
def root():
    return {
        "message": "SavoryBites Restaurant API is running.",
        "docs": "/docs",
        "health": "/health",
        "readiness": "/health/ready",
    }


@app.get("/health")
def health_liveness():
    """Liveness probe: verifies process is responding."""
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
    }


@app.get("/health/ready")
def health_readiness(db: Session = Depends(get_db)):
    """Readiness probe: validates database connection without exposing internal credentials."""
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "ready",
            "database": "connected",
        }
    except Exception as exc:
        logger.error("Readiness probe database connection failed: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unavailable", "database": "disconnected"},
        )
