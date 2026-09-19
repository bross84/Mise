"""Nutrition math, the OFF/USDA adapters, and recipe macro scaling.

Run from backend/:  python -m unittest discover -s tests -t .
"""
import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.ingredient import Ingredient
from app.routers.ingredients import _parse_off, _parse_usda, _usda_serving_grams
from app.routers.recipes import _compute_macros
from app.services import nutrition


class CalorieCheckTests(unittest.TestCase):
    def test_exact_match_passes(self):
        check = nutrition.check_calories(calories=208, protein=13, carbs=26, fat=5.6)
        self.assertTrue(check.ok)

    def test_boundary_is_inclusive(self):
        # 4*10 + 4*10 + 9*0 = 80 kcal expected; 15% either way is 92 / 68.
        self.assertTrue(nutrition.check_calories(92, 10, 10, 0).ok)
        self.assertTrue(nutrition.check_calories(68, 10, 10, 0).ok)
        self.assertFalse(nutrition.check_calories(92.5, 10, 10, 0).ok)
        self.assertFalse(nutrition.check_calories(67, 10, 10, 0).ok)

    def test_reports_signed_delta(self):
        check = nutrition.check_calories(120, 10, 10, 0)
        self.assertEqual(check.expected, 80.0)
        self.assertEqual(check.delta_pct, 50.0)

    def test_zero_expected(self):
        self.assertTrue(nutrition.check_calories(0, 0, 0, 0).ok)
        failing = nutrition.check_calories(5, 0, 0, 0)
        self.assertFalse(failing.ok)
        self.assertIsNone(failing.delta_pct)

    def test_reported_bug_calories_per_100g_but_macros_per_serving(self):
        # 360 kcal vs 6/37/1 g is what the old importer produced: expected 181 kcal.
        self.assertFalse(nutrition.check_calories(360, 6, 37, 1).ok)


class PickMacroSetTests(unittest.TestCase):
    PER_100G = {"calories": 360, "protein": 12, "carbs": 74, "fat": 1.5}
    PER_SERVING = {"calories": 200, "protein": 6, "carbs": 37, "fat": 1}

    def test_complete_per_100g_wins(self):
        pick = nutrition.pick_macro_set(self.PER_100G, self.PER_SERVING, 56)
        self.assertEqual(pick.macros["calories"], 360)
        self.assertFalse(pick.converted_from_serving)

    def test_per_serving_is_converted_using_serving_weight(self):
        pick = nutrition.pick_macro_set({}, self.PER_SERVING, 56)
        self.assertTrue(pick.converted_from_serving)
        self.assertAlmostEqual(pick.macros["calories"], 357.1, places=1)
        self.assertAlmostEqual(pick.macros["carbs"], 66.1, places=1)

    def test_per_serving_without_weight_needs_manual_entry(self):
        pick = nutrition.pick_macro_set({}, self.PER_SERVING, None)
        self.assertIsNone(pick.macros)
        self.assertIn("serving weight", pick.reason)

    def test_never_mixes_bases(self):
        # calories only per 100 g, protein/carbs/fat only per serving
        mixed_100g = {"calories": 360, "protein": None, "carbs": None, "fat": None}
        mixed_serving = {"calories": None, "protein": 6, "carbs": 37, "fat": 1}
        pick = nutrition.pick_macro_set(mixed_100g, mixed_serving, 56)
        self.assertIsNone(pick.macros)

    def test_one_missing_macro_is_not_filled_with_zero(self):
        pick = nutrition.pick_macro_set({"calories": 360, "protein": 12, "carbs": 74, "fat": None}, {}, 56)
        self.assertIsNone(pick.macros)


class OffAdapterTests(unittest.TestCase):
    def parse(self, nutriments, **product):
        data = {"products": [{"product_name": "Lasagna Sheets", "code": "123", "nutriments": nutriments, **product}]}
        return _parse_off(data)[0]

    def test_reported_mixed_product_requires_manual_entry(self):
        result = self.parse({
            "energy-kcal_100g": 360,
            "proteins_serving": 6, "carbohydrates_serving": 37, "fat_serving": 1,
        }, serving_size="56 g")
        self.assertFalse(result.nutrition_complete)
        self.assertIsNone(result.calories)
        self.assertIsNone(result.protein)
        self.assertTrue(result.incomplete_reason)

    def test_complete_per_100g_set(self):
        result = self.parse({
            "energy-kcal_100g": 360, "proteins_100g": 12, "carbohydrates_100g": 74, "fat_100g": 1.5,
        })
        self.assertTrue(result.nutrition_complete)
        self.assertEqual((result.calories, result.protein, result.carbs, result.fat), (360, 12, 74, 1.5))
        self.assertEqual(result.unit, "per 100g")

    def test_complete_per_serving_set_is_converted(self):
        result = self.parse({
            "energy-kcal_serving": 200, "proteins_serving": 6, "carbohydrates_serving": 37, "fat_serving": 1,
        }, serving_size="56 g")
        self.assertTrue(result.nutrition_complete)
        self.assertTrue(result.converted_from_serving)
        self.assertAlmostEqual(result.calories, 357.1, places=1)
        self.assertEqual(result.serving_grams, 56)

    def test_kilojoules_are_converted_within_the_same_set(self):
        result = self.parse({
            "energy_100g": 1506.24, "proteins_100g": 12, "carbohydrates_100g": 74, "fat_100g": 1.5,
        })
        self.assertAlmostEqual(result.calories, 360.0, delta=0.1)

    def test_string_values_and_junk(self):
        result = self.parse({
            "energy-kcal_100g": "360", "proteins_100g": "12", "carbohydrates_100g": "n/a", "fat_100g": "1.5",
        })
        self.assertFalse(result.nutrition_complete)


class UsdaAdapterTests(unittest.TestCase):
    def nutrient(self, name, value, unit="G"):
        return {"nutrientName": name, "value": value, "unitName": unit}

    def food(self, nutrients, **extra):
        return {"foods": [{"fdcId": 1, "description": "Pasta, dry", "foodNutrients": nutrients, **extra}]}

    def test_complete_set(self):
        result = _parse_usda(self.food([
            self.nutrient("Energy", 360, "KCAL"), self.nutrient("Protein", 12),
            self.nutrient("Carbohydrate, by difference", 74), self.nutrient("Total lipid (fat)", 1.5),
        ]))[0]
        self.assertTrue(result.nutrition_complete)
        self.assertEqual(result.calories, 360)

    def test_missing_macro_is_incomplete_not_zero(self):
        result = _parse_usda(self.food([
            self.nutrient("Energy", 360, "KCAL"), self.nutrient("Protein", 12),
            self.nutrient("Carbohydrate, by difference", 74),
        ]))[0]
        self.assertFalse(result.nutrition_complete)
        self.assertIsNone(result.fat)

    def test_kcal_wins_over_a_kilojoule_entry_with_the_same_name(self):
        result = _parse_usda(self.food([
            self.nutrient("Energy", 360, "KCAL"), self.nutrient("Energy", 1506.24, "KJ"),
            self.nutrient("Protein", 12), self.nutrient("Carbohydrate, by difference", 74),
            self.nutrient("Total lipid (fat)", 1.5),
        ]))[0]
        self.assertEqual(result.calories, 360)

    def test_kilojoule_only_is_converted(self):
        result = _parse_usda(self.food([
            self.nutrient("Energy", 1506.24, "KJ"), self.nutrient("Protein", 12),
            self.nutrient("Carbohydrate, by difference", 74), self.nutrient("Total lipid (fat)", 1.5),
        ]))[0]
        self.assertAlmostEqual(result.calories, 360.0, delta=0.1)

    def test_label_nutrients_used_only_as_a_complete_per_serving_set(self):
        result = _parse_usda(self.food(
            [self.nutrient("Protein", 12)],  # incomplete per-100 g
            servingSize=56, servingSizeUnit="g",
            labelNutrients={"calories": {"value": 200}, "protein": {"value": 6},
                            "carbohydrates": {"value": 37}, "fat": {"value": 1}},
        ))[0]
        self.assertTrue(result.converted_from_serving)
        self.assertAlmostEqual(result.calories, 357.1, places=1)

    def test_serving_weight_skips_volume_portions(self):
        self.assertIsNone(_usda_serving_grams({"foodPortions": [{"gramWeight": 240, "modifier": "cup"}]}))
        self.assertEqual(
            _usda_serving_grams({"foodPortions": [
                {"gramWeight": 240, "portionDescription": "1 cup"},
                {"gramWeight": 182, "portionDescription": "1 medium"},
            ]}),
            182,
        )
        self.assertEqual(_usda_serving_grams({"servingSize": 56, "servingSizeUnit": "g"}), 56)


class DerivedValueTests(unittest.TestCase):
    MACROS = {"calories": 357.1, "protein": 10.7, "carbs": 66.1, "fat": 1.8}

    def test_per_serving_and_per_piece(self):
        serving, piece, grams = nutrition.derive_values("per 100g", self.MACROS, 56, 2)
        self.assertAlmostEqual(serving["calories"], 200.0, places=0)
        self.assertAlmostEqual(piece["calories"], 100.0, places=0)
        self.assertEqual(grams, 28.0)

    def test_unknown_without_serving_weight(self):
        self.assertEqual(nutrition.derive_values("per 100g", self.MACROS, None, 2), (None, None, None))

    def test_legacy_per_serving_unit_counts_as_the_serving(self):
        serving, piece, grams = nutrition.derive_values("per 45g", {"calories": 150, "protein": 3, "carbs": 30, "fat": 2}, None, 3)
        self.assertEqual(serving["calories"], 150)
        self.assertEqual(piece["calories"], 50)
        self.assertEqual(grams, 15.0)


class RecipeMacroTests(unittest.TestCase):
    """Amounts in pieces, grams, servings and scoops must agree with one another."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()

    def add(self, name, calories, unit="per 100g", serving_grams=None, serving_quantity=1):
        row = Ingredient(name=name, calories=calories, protein=0, carbs=0, fat=0, unit=unit,
                         serving_grams=serving_grams, serving_quantity=serving_quantity)
        self.db.add(row)
        self.db.commit()
        return row.id

    def breakdown(self, ingredient_id, amount, unit, name="x"):
        recipe = SimpleNamespace(servings=1, ingredients=[
            {"id": "r", "name": name, "amount": amount, "unit": unit, "ingredient_id": ingredient_id},
        ])
        macros = _compute_macros(recipe, self.db)
        return macros, macros.breakdown[0]

    def test_lasagna_pieces_no_longer_double_calories(self):
        # 360 kcal per 100 g; a 56 g serving is 2 pieces, so 12 pieces = 336 g.
        noodles = self.add("noodles", 360, serving_grams=56, serving_quantity=2)
        macros, _ = self.breakdown(noodles, 12, "pieces")
        self.assertAlmostEqual(macros.total.calories, 1209.6, places=1)

    def test_pieces_and_grams_agree(self):
        noodles = self.add("noodles", 360, serving_grams=56, serving_quantity=2)
        by_pieces, _ = self.breakdown(noodles, 12, "pieces")
        by_grams, _ = self.breakdown(noodles, 336, "g")
        self.assertAlmostEqual(by_pieces.total.calories, by_grams.total.calories, places=1)

    def test_serving_weight_does_not_change_gram_math(self):
        with_weight = self.add("a", 360, serving_grams=56, serving_quantity=2)
        without = self.add("b", 360)
        self.assertEqual(self.breakdown(with_weight, 200, "g")[0].total.calories, 720.0)
        self.assertEqual(self.breakdown(without, 200, "g")[0].total.calories, 720.0)

    def test_pieces_without_serving_weight_are_flagged_not_guessed(self):
        noodles = self.add("noodles", 360, serving_quantity=2)
        macros, item = self.breakdown(noodles, 12, "pieces")
        self.assertFalse(item.matched)
        self.assertEqual(item.note, nutrition.NEEDS_SERVING_WEIGHT)
        self.assertEqual(macros.matched_count, 0)

    def test_produce_table_covers_a_whole_apple(self):
        apple = self.add("apple", 52)
        macros, _ = self.breakdown(apple, 1, "", name="apple")
        self.assertAlmostEqual(macros.total.calories, 94.6, places=1)

    def test_serving_and_scoop_units(self):
        powder = self.add("protein powder", 400, serving_grams=30, serving_quantity=1)
        self.assertAlmostEqual(self.breakdown(powder, 2, "scoops")[0].total.calories, 240.0, places=1)
        self.assertAlmostEqual(self.breakdown(powder, 1.5, "servings")[0].total.calories, 180.0, places=1)

    def test_legacy_per_serving_row_keeps_working(self):
        # "per 45g" + 3 pieces per serving: 12 pieces = 4 servings = 4 x the stored macros
        legacy = self.add("bars", 150, unit="per 45g", serving_quantity=3)
        self.assertEqual(self.breakdown(legacy, 12, "pieces")[0].total.calories, 600.0)
        self.assertEqual(self.breakdown(legacy, 90, "g")[0].total.calories, 300.0)

    def test_unknown_unit_reports_why(self):
        salt = self.add("salt", 0)
        _, item = self.breakdown(salt, 1, "pinch")
        self.assertFalse(item.matched)
        self.assertIn("pinch", item.note)


if __name__ == "__main__":
    unittest.main()
