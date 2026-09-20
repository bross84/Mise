"""CORS_ORIGINS parsing, and that the middleware is built from it."""
import os
import unittest
from unittest import mock

from fastapi.middleware.cors import CORSMiddleware

from app import main

DEFAULTS = ["http://localhost:5173", "http://localhost:5174"]


def origins_with(value):
    env = {} if value is None else {"CORS_ORIGINS": value}
    with mock.patch.dict(os.environ, env, clear=False):
        if value is None:
            os.environ.pop("CORS_ORIGINS", None)
        return main._cors_origins()


class CorsOriginsTests(unittest.TestCase):
    def test_unset_keeps_the_defaults(self):
        self.assertEqual(origins_with(None), DEFAULTS)

    def test_blank_keeps_the_defaults(self):
        # .env.example ships "CORS_ORIGINS=" so a copied file must not disable CORS
        self.assertEqual(origins_with(""), DEFAULTS)
        self.assertEqual(origins_with("  ,  ,"), DEFAULTS)

    def test_single_origin(self):
        self.assertEqual(origins_with("http://localhost:5175"), ["http://localhost:5175"])

    def test_multiple_origins_with_whitespace(self):
        self.assertEqual(
            origins_with(" http://localhost:5175 , http://192.168.1.20:5173 "),
            ["http://localhost:5175", "http://192.168.1.20:5173"],
        )

    def test_trailing_slash_is_dropped(self):
        # browsers send the Origin header without one, so "http://x/" would never match
        self.assertEqual(origins_with("http://localhost:5175/"), ["http://localhost:5175"])

    def test_configured_value_replaces_the_defaults(self):
        self.assertNotIn("http://localhost:5173", origins_with("http://localhost:5175"))

    def test_defaults_are_not_shared_between_calls(self):
        first = origins_with(None)
        first.append("http://evil.example")
        self.assertEqual(origins_with(None), DEFAULTS)


class CorsWiringTests(unittest.TestCase):
    def test_app_middleware_uses_the_parsed_origins(self):
        cors = next(m for m in main.app.user_middleware if m.cls is CORSMiddleware)
        self.assertEqual(cors.kwargs["allow_origins"], main._cors_origins())


if __name__ == "__main__":
    unittest.main()
