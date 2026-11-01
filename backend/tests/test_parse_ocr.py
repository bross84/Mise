"""Pasted OCR text (screen-grab tools, Tesseract) goes through /recipes/parse for cleanup.

OCR output is reflowed to the width of the page it was read from, so one ingredient can span
several lines and every book marks its bullets and steps differently. The model does the repair,
which these tests can't judge; they pin down that the raw text reaches it untouched and that the
prompt asks for the repair.
"""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.routers.recipes import PARSE_SYSTEM_PROMPT
from app.services.ai import AIService

# Hard-wrapped lines, "." where a bullet was, and ". 1." where a step number was.
DOT_BULLET_BOOK = """INGREDIENTS
. 20g Diced Jalapeños
. 1 Serving Light Laughing
Cow Cheese
. 120g Cooked Shredded
Chicken or Regular Chicken
(Brand: Coles Slow Cooked
Shredded Chicken)

DIRECTIONS
. 1. In a bowl add 20g diced jalapeños, 1 light
laughing cow cheese & mix.
. 2. Add the chicken."""

# No bullets at all; continuation lines are only recognisable by their lowercase start.
UNMARKED_BOOK = """Ingredients
2 cups all-purpose
flour
1 tsp baking powder
1 1/2 cups whole
milk

Method
1) Whisk the dry ingredients
together.
2) Stir in the milk."""

# Different glyphs for the same job.
SQUARE_BULLET_BOOK = """■ 3 tbsp olive oil
■ 2 cloves garlic,
finely minced
■ Salt & pepper
to taste"""


class ParseOcrTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def parse(self, text):
        calls = []

        async def fake_complete(_self, system, prompt):
            calls.append({"system": system, "prompt": prompt})
            return "# Recipe\n\n## Ingredients\n- 1 thing"

        with patch.object(AIService, "complete_with_system", fake_complete):
            res = self.client.post("/api/recipes/parse", json={"text": text})
        return res, calls

    def test_ocr_text_reaches_the_model_unmodified_for_any_book_layout(self):
        # No client-side or server-side guessing at a layout: stripping "." bullets would
        # mangle a book that uses them for something else, so the text goes through as-is.
        for text in (DOT_BULLET_BOOK, UNMARKED_BOOK, SQUARE_BULLET_BOOK):
            with self.subTest(text=text[:20]):
                res, calls = self.parse(text)
                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual(len(calls), 1)
                self.assertIn(text.strip(), calls[0]["prompt"])
                self.assertEqual(calls[0]["system"], PARSE_SYSTEM_PROMPT)

    def test_prompt_asks_for_ocr_repair_without_assuming_one_layout(self):
        prompt = PARSE_SYSTEM_PROMPT
        self.assertIn("OCR", prompt)
        self.assertIn("hard-wrapped", prompt)
        self.assertIn("bullet", prompt)
        self.assertIn("never add", prompt.lower())

    def test_prompt_does_not_hardcode_a_single_bullet_glyph_as_the_rule(self):
        # The sample book uses "." but another book will use something else.
        self.assertIn("•", PARSE_SYSTEM_PROMPT)
        self.assertIn("■", PARSE_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
