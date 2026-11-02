"""OCR reads some characters of a quantity wrong in ways that still look plausible ("1202 skinless
chicken"), and a cook has no way to spot that from the text alone. The repairs here are the
misreads actually seen on real recipe cards, kept narrow so they can't turn real numbers into units.
"""
import unittest
from unittest.mock import patch

import pytesseract
from PIL import Image

from app.services import ocr


class RepairUnitsTests(unittest.TestCase):
    def test_ounces_read_as_digits_are_restored(self):
        # "o" read as 0 and "z" as z, or "oz" read as "02", seen on a real card
        self.assertEqual(ocr.repair_units("1202 skinless chicken\nthighs"), "12oz skinless chicken\nthighs")
        self.assertEqual(ocr.repair_units("(half a 120z can)"), "(half a 12oz can)")
        self.assertEqual(ocr.repair_units("80Z cream cheese"), "8oz cream cheese")

    def test_a_correct_unit_is_left_alone(self):
        for text in ("12oz skinless chicken", "12 oz skinless chicken", "8 ounces cream cheese"):
            self.assertEqual(ocr.repair_units(text), text)

    def test_real_numbers_are_not_turned_into_units(self):
        for text in (
            "Bake at 350 for 12-15 minutes",
            "Serves 4 and keeps 3 days",
            "since 2002 I have made this",   # a year, not "20oz"
            "320g Protein penne",
            "375 degrees",
            "1202 calories per serving",      # a count of something else, not 12oz
        ):
            with self.subTest(text=text):
                self.assertEqual(ocr.repair_units(text), text)

    def test_a_lone_bar_read_for_the_digit_one_before_a_unit_word(self):
        self.assertEqual(ocr.repair_units("| tablespoon adobo sauce"), "1 tablespoon adobo sauce")
        self.assertEqual(ocr.repair_units("l teaspoon salt\nI cup milk"), "1 teaspoon salt\n1 cup milk")

    def test_a_bar_or_l_that_is_really_a_word_is_left_alone(self):
        for text in ("l love this recipe", "I stir the cups together", "| Notes", "Bake until golden"):
            with self.subTest(text=text):
                self.assertEqual(ocr.repair_units(text), text)

    def test_extract_text_applies_the_repairs(self):
        import io

        buffer = io.BytesIO()
        Image.new("RGB", (1600, 400), "white").save(buffer, format="PNG")
        with patch.object(pytesseract, "image_to_string", return_value="1202 skinless chicken\n"):
            self.assertEqual(ocr.extract_text(buffer.getvalue()), "12oz skinless chicken")


if __name__ == "__main__":
    unittest.main()
