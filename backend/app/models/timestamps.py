from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    """Current time as a timezone-aware UTC datetime (datetime.utcnow() is naive and deprecated)."""
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """A UTC timestamp that always comes back timezone-aware.

    SQLite has no timezone storage, so values are kept as naive UTC, which is what every existing
    row already holds, and made aware on the way out. The API then serializes them with a UTC
    offset, so a browser reads "03:30Z" as 03:30 UTC instead of 03:30 local time.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value  # a naive value is taken to be UTC

    def process_result_value(self, value, dialect):
        return None if value is None else value.replace(tzinfo=timezone.utc)
