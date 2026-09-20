"""Timestamps are stored as UTC and come back timezone-aware, so the API sends an offset."""
import unittest
import warnings
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models.blocked_ingredient import BlockedIngredient
from app.models.ingredient import Ingredient
from app.models.meal_plan import MealPlanItem
from app.models.recipe import Recipe
from app.models.timestamps import utcnow


class TimestampTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

        def override_get_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def new_recipe(self, **extra):
        with self.Session() as db:
            recipe = Recipe(title="Soup", servings=2, **extra)
            db.add(recipe)
            db.commit()
            return recipe.id

    def read_recipe(self, recipe_id):
        with self.Session() as db:  # a fresh session, so this is what a later request sees
            return db.get(Recipe, recipe_id)

    # ── the helper ───────────────────────────────────────────────────────────

    def test_utcnow_is_aware_utc(self):
        now = utcnow()
        self.assertIsNotNone(now.tzinfo)
        self.assertEqual(now.utcoffset(), timedelta(0))

    def test_utcnow_does_not_use_the_deprecated_call(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            utcnow()
            self.new_recipe()
        self.assertEqual([str(w.message) for w in caught if "utcnow" in str(w.message)], [])

    # ── stored and read back ─────────────────────────────────────────────────

    def test_every_timestamp_column_reads_back_aware_utc(self):
        with self.Session() as db:
            recipe = Recipe(title="Soup", servings=2)
            ingredient = Ingredient(name="Salt", calories=0, protein=0, carbs=0, fat=0)
            blocked = BlockedIngredient(name="x", source="usda", source_id="1")
            planned = MealPlanItem(recipe_id=1)
            db.add_all([recipe, ingredient, blocked, planned])
            db.commit()
            ids = (recipe.id, ingredient.id, blocked.id, planned.id)
        with self.Session() as db:
            values = [
                db.get(Recipe, ids[0]).created_at, db.get(Recipe, ids[0]).updated_at,
                db.get(Ingredient, ids[1]).created_at, db.get(BlockedIngredient, ids[2]).created_at,
                db.get(MealPlanItem, ids[3]).added_at,
            ]
        for value in values:
            self.assertEqual(value.utcoffset(), timedelta(0), value)
            self.assertLess(abs(utcnow() - value), timedelta(seconds=30))

    def test_rows_saved_before_this_change_read_as_the_same_utc_instant(self):
        # Old rows hold naive UTC (from datetime.utcnow); they must not shift.
        recipe_id = self.new_recipe()
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE recipes SET updated_at = '2026-09-21 03:30:00.000000' WHERE id = :i"), {"i": recipe_id})
        self.assertEqual(self.read_recipe(recipe_id).updated_at, datetime(2026, 9, 21, 3, 30, tzinfo=timezone.utc))

    def test_a_value_with_another_offset_is_stored_as_utc(self):
        eastern = timezone(timedelta(hours=-4))
        moment = datetime(2026, 9, 20, 23, 30, tzinfo=eastern)  # = 03:30 UTC on the 21st
        recipe_id = self.new_recipe(created_at=moment)
        with self.engine.connect() as conn:
            raw = conn.execute(text("SELECT created_at FROM recipes WHERE id = :i"), {"i": recipe_id}).scalar()
        self.assertTrue(str(raw).startswith("2026-09-21 03:30"), raw)
        self.assertEqual(self.read_recipe(recipe_id).created_at, moment)

    def test_a_naive_value_is_taken_as_utc(self):
        recipe_id = self.new_recipe(created_at=datetime(2026, 1, 2, 3, 4, 5))
        self.assertEqual(self.read_recipe(recipe_id).created_at, datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc))

    # ── what the API sends ───────────────────────────────────────────────────

    def test_api_sends_a_utc_offset(self):
        recipe_id = self.new_recipe()
        body = self.client.get(f"/api/recipes/{recipe_id}").json()
        for field in ("created_at", "updated_at"):
            self.assertRegex(body[field], r"(Z|\+00:00)$", body[field])

    def test_legacy_row_is_serialized_with_its_true_utc_time(self):
        recipe_id = self.new_recipe()
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE recipes SET updated_at = '2026-09-21 03:30:00.000000' WHERE id = :i"), {"i": recipe_id})
        updated = self.client.get(f"/api/recipes/{recipe_id}").json()["updated_at"]
        self.assertEqual(datetime.fromisoformat(updated.replace("Z", "+00:00")), datetime(2026, 9, 21, 3, 30, tzinfo=timezone.utc))

    def test_updating_a_recipe_moves_updated_at_forward(self):
        recipe_id = self.new_recipe()
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE recipes SET updated_at = '2020-01-01 00:00:00.000000' WHERE id = :i"), {"i": recipe_id})
        response = self.client.patch(f"/api/recipes/{recipe_id}", json={"title": "Better soup"})
        self.assertEqual(response.status_code, 200, response.text)
        updated = datetime.fromisoformat(response.json()["updated_at"].replace("Z", "+00:00"))
        self.assertLess(abs(utcnow() - updated), timedelta(seconds=30))

    def test_meal_plan_and_ingredient_timestamps_carry_an_offset(self):
        recipe_id = self.new_recipe()
        planned = self.client.post("/api/meal-plan", json={"recipe_id": recipe_id}).json()
        self.assertRegex(planned["added_at"], r"(Z|\+00:00)$")
        ingredient = self.client.post("/api/ingredients", json={
            "name": "Pasta", "calories": 360, "protein": 12, "carbs": 74, "fat": 1.5,
        }).json()
        self.assertRegex(ingredient["created_at"], r"(Z|\+00:00)$")


if __name__ == "__main__":
    unittest.main()
