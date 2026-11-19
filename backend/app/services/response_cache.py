"""Bounded, thread-safe in-process TTL cache and ETag HTTP response helper for public read APIs."""

from collections import OrderedDict
from hashlib import sha256
from threading import RLock
import time
from typing import Callable

from fastapi import Request, Response

_MAX_CACHE_ENTRIES = 256


class _CacheRecord:
    __slots__ = ("namespace", "expires_at", "payload_bytes", "etag")

    def __init__(self, namespace: str, expires_at: float, payload_bytes: bytes, etag: str) -> None:
        self.namespace = namespace
        self.expires_at = expires_at
        self.payload_bytes = payload_bytes
        self.etag = etag


class ResponseCacheStore:
    """Bounded LRU-style TTL store partitioned by invalidation namespace."""

    def __init__(self, max_entries: int = _MAX_CACHE_ENTRIES) -> None:
        self._max_entries = max_entries
        self._lock = RLock()
        self._entries: OrderedDict[str, _CacheRecord] = OrderedDict()

    def get(self, key: str) -> _CacheRecord | None:
        now = time.monotonic()
        with self._lock:
            record = self._entries.get(key)
            if record is None:
                return None
            if record.expires_at <= now:
                self._entries.pop(key, None)
                return None
            self._entries.move_to_end(key)
            return record

    def set(self, namespace: str, key: str, payload_bytes: bytes, ttl_seconds: int) -> _CacheRecord:
        digest = sha256(payload_bytes).hexdigest()[:20]
        etag = f'"{digest}"'
        record = _CacheRecord(
            namespace=namespace,
            expires_at=time.monotonic() + max(1, ttl_seconds),
            payload_bytes=payload_bytes,
            etag=etag,
        )
        with self._lock:
            self._entries[key] = record
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)
        return record

    def invalidate_namespace(self, namespace: str) -> int:
        with self._lock:
            keys_to_remove = [k for k, rec in self._entries.items() if rec.namespace == namespace]
            for k in keys_to_remove:
                self._entries.pop(k, None)
            return len(keys_to_remove)

    def clear_all(self) -> None:
        with self._lock:
            self._entries.clear()


response_cache = ResponseCacheStore()


def invalidate_namespace(namespace: str) -> int:
    """Clear all cached HTTP payloads under the given namespace (e.g., 'catalog', 'settings')."""
    return response_cache.invalidate_namespace(namespace)


def clear_all_caches() -> None:
    """Clear every cached namespace across the process."""
    response_cache.clear_all()


def _etag_matches(request: Request, etag: str) -> bool:
    raw = request.headers.get("if-none-match")
    if not raw:
        return False
    candidates = [part.strip() for part in raw.split(",")]
    return "*" in candidates or etag in candidates or f"W/{etag}" in candidates


def cached_json_response(
    request: Request,
    *,
    namespace: str,
    cache_key: str,
    ttl_seconds: int,
    max_age_seconds: int,
    swr_seconds: int,
    compute_json_bytes: Callable[[], bytes | None],
    store_in_memory: bool = True,
) -> Response | None:
    """
    Serve pre-serialized JSON with ETag (304 Not Modified) and Cache-Control headers.
    Returns None when compute_json_bytes returns None (e.g. missing 404 entity).
    """
    cache_control = (
        f"public, max-age={max_age_seconds}, stale-while-revalidate={swr_seconds}"
    )

    record = response_cache.get(cache_key) if store_in_memory else None
    if record is None:
        payload_bytes = compute_json_bytes()
        if payload_bytes is None:
            return None
        if store_in_memory:
            record = response_cache.set(namespace, cache_key, payload_bytes, ttl_seconds)
        else:
            digest = sha256(payload_bytes).hexdigest()[:20]
            record = _CacheRecord(
                namespace=namespace,
                expires_at=0.0,
                payload_bytes=payload_bytes,
                etag=f'"{digest}"',
            )

    headers = {
        "ETag": record.etag,
        "Cache-Control": cache_control,
        "Vary": "Accept-Encoding",
    }

    if _etag_matches(request, record.etag):
        return Response(status_code=304, headers=headers)

    return Response(
        content=record.payload_bytes,
        media_type="application/json",
        headers=headers,
    )
