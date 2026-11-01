"""POST /recipes/ocr-image reads text out of a pasted screenshot with Tesseract.

The Tesseract binary isn't needed here: tests stub the engine call and check everything around it
(what the engine is handed, and how bad uploads and a missing binary are reported).
"""
import io
import unittest
from unittest.mock import patch

import pytesseract
from fastapi.testclient import TestClient
from PIL import Image, ImageStat

from app.main import app
from app.services import ocr


def image_bytes(size=(1600, 400), color="white", fmt="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format=fmt)
    return buffer.getvalue()


class PrepareImageTests(unittest.TestCase):
    def test_dark_mode_screenshot_is_inverted_to_dark_text_on_light(self):
        prepared = ocr.prepare_image(image_bytes(color="black"))
        self.assertGreater(ImageStat.Stat(prepared).mean[0], 200)

    def test_light_screenshot_is_left_light(self):
        prepared = ocr.prepare_image(image_bytes(color="white"))
        self.assertGreater(ImageStat.Stat(prepared).mean[0], 200)

    def test_small_image_is_upscaled_for_the_engine(self):
        prepared = ocr.prepare_image(image_bytes(size=(400, 100)))
        self.assertGreaterEqual(prepared.width, ocr.MIN_WIDTH_PX)

    def test_huge_image_is_scaled_down(self):
        prepared = ocr.prepare_image(image_bytes(size=(6000, 500)))
        self.assertLessEqual(max(prepared.size), ocr.MAX_SIDE_PX)

    def test_non_image_bytes_are_rejected(self):
        with self.assertRaises(ocr.UnsupportedImageError):
            ocr.prepare_image(b"%PDF-1.7 not an image")

    def test_unsupported_image_format_is_rejected(self):
        with self.assertRaises(ocr.UnsupportedImageError):
            ocr.prepare_image(image_bytes(fmt="GIF"))


class OcrEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def post(self, data, name="shot.png", content_type="image/png"):
        return self.client.post("/api/recipes/ocr-image", files={"file": (name, data, content_type)})

    def test_returns_the_text_the_engine_read(self):
        raw = "INGREDIENTS\n. 2 cups flour\n. 1 egg\n\n"
        with patch.object(pytesseract, "image_to_string", return_value=raw) as engine:
            res = self.post(image_bytes())
        self.assertEqual(res.status_code, 200, res.text)
        # Layout repair is /recipes/parse's job, so the text comes back as read, only trimmed.
        self.assertEqual(res.json(), {"text": "INGREDIENTS\n. 2 cups flour\n. 1 egg"})
        self.assertIsInstance(engine.call_args.args[0], Image.Image)

    def test_a_bad_upload_is_a_415_not_a_crash(self):
        with patch.object(pytesseract, "image_to_string") as engine:
            res = self.post(b"just some text", name="notes.png")
        self.assertEqual(res.status_code, 415)
        engine.assert_not_called()

    def test_content_type_header_is_not_trusted(self):
        with patch.object(pytesseract, "image_to_string", return_value="1 egg"):
            res = self.post(image_bytes(), name="blob", content_type="application/octet-stream")
        self.assertEqual(res.status_code, 200, res.text)

    def test_oversized_upload_is_a_413(self):
        with patch.object(ocr, "MAX_IMAGE_BYTES", 1000), patch.object(pytesseract, "image_to_string") as engine:
            res = self.post(image_bytes())
        self.assertEqual(res.status_code, 413)
        engine.assert_not_called()

    def test_an_image_with_no_text_is_a_422(self):
        with patch.object(pytesseract, "image_to_string", return_value="  \n \n"):
            res = self.post(image_bytes())
        self.assertEqual(res.status_code, 422)
        self.assertIn("No text", res.json()["detail"])

    def test_missing_tesseract_binary_is_a_503_with_a_clear_message(self):
        with patch.object(pytesseract, "image_to_string", side_effect=pytesseract.TesseractNotFoundError()):
            res = self.post(image_bytes())
        self.assertEqual(res.status_code, 503)
        self.assertIn("Tesseract", res.json()["detail"])

    def test_engine_failure_is_a_502(self):
        with patch.object(pytesseract, "image_to_string", side_effect=pytesseract.TesseractError(1, "boom")):
            res = self.post(image_bytes())
        self.assertEqual(res.status_code, 502)


if __name__ == "__main__":
    unittest.main()
