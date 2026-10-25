"""Conversion of parsed ingredient amounts to grams."""
import unittest

from app.services.grams import convert_to_grams, needs_estimate, parse_amount


class ParseAmountTests(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(parse_amount("1 1/2"), 1.5)
        self.assertEqual(parse_amount("1/4"), 0.25)
        self.assertEqual(parse_amount("½"), 0.5)
        self.assertEqual(parse_amount("1½"), 1.5)
        self.assertEqual(parse_amount("2.5"), 2.5)
        self.assertIsNone(parse_amount(None))
        self.assertIsNone(parse_amount("to taste"))


class ConvertTests(unittest.TestCase):
    def test_weights_are_exact(self):
        r = convert_to_grams("Ground Beef", "1.3", "lb")
        self.assertEqual((r.amount, r.source), (590, "exact"))
        self.assertEqual(convert_to_grams("Cheese", "8", "oz").amount, 227)

    def test_volume_uses_density_table(self):
        r = convert_to_grams("All-Purpose Flour", "1", "cup")
        self.assertEqual(r.source, "table")
        self.assertAlmostEqual(r.amount, 121, delta=2)
        self.assertEqual(convert_to_grams("Olive Oil", "1", "tbsp").amount, 13)

    def test_longest_density_key_wins(self):
        powdered = convert_to_grams("Powdered Peanut Butter", "1 1/4", "cup").amount
        regular = convert_to_grams("Peanut Butter", "1 1/4", "cup").amount
        self.assertLess(powdered, regular)

    def test_unknown_volume_ingredient_needs_estimate(self):
        r = convert_to_grams("Dragon Fruit Puree", "1", "cup")
        self.assertIsNone(r)
        self.assertTrue(needs_estimate("1", "cup", r))

    def test_multi_can_is_label_weight(self):
        r = convert_to_grams("Black Beans", "3", "x 15.5 oz can")
        self.assertEqual((r.amount, r.source), (1318, "exact"))

    def test_drained_can_is_flagged_estimate(self):
        r = convert_to_grams(
            "Beans", "3", "x 15.5 oz can", raw="3 x 15.5 oz can beans, drained and rinsed",
        )
        self.assertEqual(r.source, "estimate")
        self.assertAlmostEqual(r.amount, 791, delta=2)

    def test_stated_grams_beat_conversion(self):
        r = convert_to_grams("Ground Beef", "1.3", "lb", raw="1.3 lb (590 g) Ground beef, 93/7")
        self.assertEqual((r.amount, r.source), (590, "exact"))
        r = convert_to_grams("Beans", "3", "x 15.5 oz can", raw="3 x 15.5 oz can (780 g) Beans, drained and rinsed")
        self.assertEqual((r.amount, r.source), (780, "exact"))
        r = convert_to_grams("Flour", "1", "cup", raw="1 cup / 120 g flour")
        self.assertEqual(r.amount, 120)

    def test_count_uses_piece_table(self):
        r = convert_to_grams("Onion", "2", None)
        self.assertEqual((r.amount, r.source), (220, "table"))

    def test_grams_and_missing_amounts_are_left_alone(self):
        self.assertFalse(needs_estimate("30", "g", None))
        self.assertFalse(needs_estimate(None, None, None))
        self.assertIsNone(convert_to_grams("Salt", None, None))


if __name__ == "__main__":
    unittest.main()
