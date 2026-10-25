"""Ingredient matching must see past prep notes, plurals and parentheticals."""
import asyncio
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.ingredient import Ingredient
from app.services.matching import IngredientMatcher, core_words


class CoreWordsTests(unittest.TestCase):
    def test_drops_prep_notes_and_parentheticals(self):
        self.assertEqual(core_words("Onion, diced"), ["onion"])
        self.assertEqual(core_words("Black pepper (or to taste)"), ["black", "pepper"])

    def test_keeps_all_words_when_everything_is_filler(self):
        self.assertTrue(core_words("to taste"))


class MatcherTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        for name in ("Onions, Raw", "Onion Powder Blend", "Spices, Pepper, Black", "Tomato Paste"):
            self.db.add(Ingredient(name=name, calories=1, protein=0, carbs=0, fat=0, unit="per 100g",
                                   source="local", serving_quantity=1))
        self.db.commit()

    def match(self, name):
        result = asyncio.run(IngredientMatcher().match(name, self.db))
        return result["name"] if result else None

    def test_onion_diced_finds_onions_raw(self):
        self.assertEqual(self.match("Onion, diced"), "Onions, Raw")

    def test_black_pepper_to_taste_finds_spice_row(self):
        self.assertEqual(self.match("Black pepper (or to taste)"), "Spices, Pepper, Black")

    def test_unrelated_name_does_not_match(self):
        self.assertIsNone(self.match("Dragon fruit"))


if __name__ == "__main__":
    unittest.main()
