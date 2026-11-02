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


# --- page layout: columns, photos and full-width blocks -------------------------------------
import random

from PIL import ImageDraw

LINE_H, PITCH = 14, 22  # ink height and line-to-line distance, like ~16px body text


def text_block(draw, x0, x1, y0, lines, *, ink=0, seed=0, word_gap=7):
    """Ragged lines of word-sized blocks, so no blank column lines up from one line to the next."""
    rng = random.Random(seed)
    for line in range(lines):
        x, y = x0 + rng.randint(0, 6), y0 + line * PITCH
        while True:
            width = rng.randint(22, 64)
            if x + width > x1 - rng.randint(0, 40):
                break
            for stroke in range(x, x + width, 3):  # thin strokes: real text is ~20% ink, not solid
                draw.line([stroke, y, stroke, y + LINE_H], fill=ink)
            x += width + word_gap


def heading(draw, box):
    """Big bold lettering: strokes, not a solid slab, so it doesn't look like a photo."""
    left, top, right, bottom = box
    for stroke in range(left, right, 3):
        draw.line([stroke, top, stroke, bottom], fill=0)


def page(size=(1200, 700), paint=lambda d: None, bg=255):
    image = Image.new("L", size, bg)
    paint(ImageDraw.Draw(image))
    return image


def as_png(image):
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def two_columns(d):
    text_block(d, 60, 560, 40, 12, seed=1)
    text_block(d, 640, 1140, 40, 12, seed=2)


def recipe_card(d):
    """Photo left, heading across the column gap, two ingredient columns, full-width steps below."""
    d.rectangle([40, 20, 340, 400], fill=100)            # photo
    heading(d, (460, 20, 700, 50))                       # "INGREDIENTS" spans the column gutter
    text_block(d, 360, 560, 80, 13, seed=3)              # left ingredient column
    text_block(d, 600, 800, 80, 13, seed=4)              # right ingredient column
    heading(d, (420, 430, 640, 460))                     # "INSTRUCTIONS"
    text_block(d, 40, 1160, 480, 8, seed=5)              # numbered steps, full width


class FindRegionsTests(unittest.TestCase):
    def test_two_columns_are_found_left_to_right(self):
        boxes = ocr.find_regions(page(paint=two_columns))
        self.assertEqual(len(boxes), 2)
        self.assertLess(boxes[0][2], 600)
        self.assertGreater(boxes[1][0], 600)

    def test_single_wide_column_is_not_split(self):
        boxes = ocr.find_regions(page(paint=lambda d: text_block(d, 60, 1140, 40, 20, seed=7)))
        self.assertEqual(len(boxes), 1)

    def test_a_gap_no_wider_than_a_word_space_is_not_a_gutter(self):
        def narrow(d):  # 8px between the halves on every line; a gutter is at least 11px here
            for line in range(12):
                y = 40 + line * PITCH
                d.rectangle([60, y, 596, y + LINE_H], fill=0)
                d.rectangle([604, y, 1140, y + LINE_H], fill=0)
        self.assertEqual(len(ocr.find_regions(page(paint=narrow))), 1)

    def test_a_short_block_is_not_split_into_columns(self):
        def two_lines(d):
            text_block(d, 60, 400, 40, 2, seed=1)
            text_block(d, 700, 1140, 40, 2, seed=2)
        self.assertEqual(len(ocr.find_regions(page(paint=two_lines))), 1)

    def test_blank_page_is_one_region(self):
        self.assertEqual(len(ocr.find_regions(page())), 1)

    def test_recipe_card_is_cut_into_reading_order_blocks(self):
        boxes = ocr.find_regions(page(paint=recipe_card))
        # photo, heading, left column, right column, then heading + steps read as one block
        self.assertEqual(len(boxes), 5)
        photo, heading, left, right, steps = boxes
        self.assertLess(photo[2], 360)
        self.assertLess(heading[3], 75)
        self.assertGreater(left[1], 70)
        self.assertLess(left[2], 590)
        self.assertGreater(right[0], 590)
        self.assertGreater(steps[1], 400)
        self.assertGreater(steps[2] - steps[0], 900)


class ExtractTextLayoutTests(unittest.TestCase):
    def read(self, image):
        reads = iter(["HEADING", "LEFT", "RIGHT", "STEPS"])
        calls = []

        def fake(img, **_kwargs):
            calls.append(img.size)
            return next(reads)

        with patch.object(pytesseract, "image_to_string", fake):
            return ocr.extract_text(as_png(image)), calls

    def test_columns_are_read_separately_and_joined_in_order(self):
        reads = iter(["LEFT\nline", "RIGHT\nline"])
        with patch.object(pytesseract, "image_to_string", lambda img, **_: next(reads)):
            text = ocr.extract_text(as_png(page(paint=two_columns)))
        self.assertEqual(text, "LEFT\nline\n\nRIGHT\nline")

    def test_photo_is_not_sent_to_the_engine(self):
        text, calls = self.read(page(paint=recipe_card))
        self.assertEqual(len(calls), 4)  # five blocks, but the photo is never sent to the engine
        self.assertEqual(text.split("\n\n"), ["HEADING", "LEFT", "RIGHT", "STEPS"])

    def test_dark_mode_columns_are_still_split(self):
        def dark(d):
            text_block(d, 60, 560, 40, 12, ink=255, seed=1)
            text_block(d, 640, 1140, 40, 12, ink=255, seed=2)
        reads = iter(["L", "R"])
        with patch.object(pytesseract, "image_to_string", lambda img, **_: next(reads)):
            self.assertEqual(ocr.extract_text(as_png(page(paint=dark, bg=0))), "L\n\nR")

    def test_falls_back_to_whole_image_when_every_block_reads_empty(self):
        calls = []

        def fake(img, **_kwargs):
            calls.append(img.size)
            return "" if len(calls) <= 2 else "WHOLE PAGE"

        with patch.object(pytesseract, "image_to_string", fake):
            text = ocr.extract_text(as_png(page(paint=two_columns)))
        self.assertEqual(text, "WHOLE PAGE")
