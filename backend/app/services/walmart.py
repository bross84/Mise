"""Turning what the user pastes (a Walmart product page address or a bare item number) into
Walmart's item number, which is what the shopping list's add-to-cart link needs."""
import re
from urllib.parse import urlparse

_ITEM_ID = re.compile(r"^\d{5,15}$")
# Product pages look like /ip/<slug>/<item number>, sometimes without the slug.
_PRODUCT_PATH = re.compile(r"^/ip/(?:[^/]+/)?(\d{5,15})/?$")


def parse_item_id(value: str | None) -> str | None:
    """Return the item number, or None when the value is blank (which clears the link).

    Raises ValueError for anything that isn't a Walmart product page or an item number.
    """
    text = (value or "").strip()
    if not text:
        return None
    if _ITEM_ID.match(text):
        return text

    parsed = urlparse(text if "://" in text else f"https://{text}")
    host = (parsed.hostname or "").lower()
    if host == "walmart.com" or host.endswith(".walmart.com"):
        match = _PRODUCT_PATH.match(parsed.path)
        if match:
            return match.group(1)
    raise ValueError("Paste a Walmart product page address (walmart.com/ip/…) or its item number.")
