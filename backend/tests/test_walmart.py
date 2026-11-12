"""Reading a Walmart item number out of what the user pastes."""
import unittest

from app.services.walmart import parse_item_id


class ParseItemIdTests(unittest.TestCase):
    def test_product_page_address(self):
        url = "https://www.walmart.com/ip/Great-Value-Whole-Vitamin-D-Milk-Gallon-Plastic-Jug-128-Fl-Oz/10450114"
        self.assertEqual(parse_item_id(url), "10450114")

    def test_address_with_query_string_and_trailing_slash(self):
        url = "https://www.walmart.com/ip/Some-Product/10450114/?classType=REGULAR&athbdg=L1200"
        self.assertEqual(parse_item_id(url), "10450114")

    def test_address_without_slug_or_scheme(self):
        self.assertEqual(parse_item_id("walmart.com/ip/10450114"), "10450114")

    def test_bare_item_number(self):
        self.assertEqual(parse_item_id("  10450114 "), "10450114")

    def test_blank_clears(self):
        self.assertIsNone(parse_item_id(""))
        self.assertIsNone(parse_item_id("   "))
        self.assertIsNone(parse_item_id(None))

    def test_rejects_other_sites_and_pages(self):
        for value in (
            "https://www.amazon.com/ip/Thing/10450114",
            "https://walmart.com.evil.example/ip/Thing/10450114",
            "https://www.walmart.com/search?q=milk",
            "https://www.walmart.com/browse/food/976759",
            "chicken thighs",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_item_id(value)


if __name__ == "__main__":
    unittest.main()
