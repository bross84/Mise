"""Ingredient create/update/audit endpoints, against an isolated in-memory database."""
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models.ingredient import Ingredient

# Label for a dry lasagna noodle box: 2 pieces = 56 g = 200 kcal.
LABEL = {"name": "Lasagna noodles", "calories": 200, "protein": 6, "carbs": 37, "fat": 1}


class IngredientApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)

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

    def seed(self, **values):
        defaults = {"protein": 0, "carbs": 0, "fat": 0, "unit": "per 100g", "source": "local",
                    "serving_grams": None, "serving_quantity": 1}
        with self.Session() as db:
            row = Ingredient(**{**defaults, **values})
            db.add(row)
            db.commit()
            return row.id

    # ── create ───────────────────────────────────────────────────────────────

    def test_per_serving_label_is_converted_and_stored_per_100g(self):
        response = self.client.post("/api/ingredients", json={
            **LABEL, "nutrition_basis": "per_serving", "serving_grams": 56, "serving_quantity": 2,
        })
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["unit"], "per 100g")
        self.assertAlmostEqual(body["calories"], 357.1, places=1)
        self.assertAlmostEqual(body["carbs"], 66.1, places=1)
        self.assertEqual(body["serving_grams"], 56)
        self.assertEqual(body["serving_quantity"], 2)
        # derived, never stored
        self.assertAlmostEqual(body["per_serving"]["calories"], 200, delta=0.5)
        self.assertAlmostEqual(body["per_piece"]["calories"], 100, delta=0.5)
        self.assertEqual(body["grams_per_piece"], 28.0)
        self.assertTrue(body["calorie_check"]["ok"])

    def test_per_serving_requires_serving_weight(self):
        response = self.client.post("/api/ingredients", json={**LABEL, "nutrition_basis": "per_serving"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("Serving weight", response.json()["detail"])

    def test_per_100g_values_are_stored_as_entered(self):
        response = self.client.post("/api/ingredients", json={
            "name": "Pasta", "calories": 360, "protein": 12, "carbs": 74, "fat": 1.5,
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["calories"], 360)
        self.assertIsNone(response.json()["per_serving"])

    def test_legacy_unit_from_an_old_client_is_ignored(self):
        response = self.client.post("/api/ingredients", json={
            "name": "Pasta", "calories": 360, "protein": 12, "carbs": 74, "fat": 1.5, "unit": "per 45g",
        })
        self.assertEqual(response.json()["unit"], "per 100g")

    def test_calorie_mismatch_is_a_409_with_details(self):
        response = self.client.post("/api/ingredients", json={
            "name": "Mixed-basis pasta", "calories": 360, "protein": 6, "carbs": 37, "fat": 1,
        })
        self.assertEqual(response.status_code, 409)
        detail = response.json()["detail"]
        self.assertEqual(detail["code"], "calorie_mismatch")
        self.assertEqual(detail["calories"], 360)
        self.assertEqual(detail["expected_calories"], 181.0)
        self.assertGreater(detail["delta_pct"], 15)
        self.assertEqual(self.client.get("/api/ingredients").json(), [])  # nothing saved

    def test_mismatch_can_be_overridden(self):
        response = self.client.post("/api/ingredients", json={
            "name": "Mixed-basis pasta", "calories": 360, "protein": 6, "carbs": 37, "fat": 1,
            "override_calorie_check": True,
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertFalse(response.json()["calorie_check"]["ok"])

    def test_check_runs_on_the_converted_values_too(self):
        response = self.client.post("/api/ingredients", json={
            "name": "Bad label", "calories": 400, "protein": 6, "carbs": 37, "fat": 1,
            "nutrition_basis": "per_serving", "serving_grams": 56,
        })
        self.assertEqual(response.status_code, 409)

    def test_zero_or_negative_serving_weight_is_not_stored(self):
        response = self.client.post("/api/ingredients", json={
            "name": "Pasta", "calories": 360, "protein": 12, "carbs": 74, "fat": 1.5, "serving_grams": 0,
        })
        self.assertIsNone(response.json()["serving_grams"])

    # ── update ───────────────────────────────────────────────────────────────

    def test_renaming_a_failing_food_is_not_blocked(self):
        food = self.seed(name="Old", calories=360, protein=6, carbs=37, fat=1)
        response = self.client.patch(f"/api/ingredients/{food}", json={"name": "Renamed"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["name"], "Renamed")

    def test_editing_macros_into_a_mismatch_is_blocked_then_overridable(self):
        food = self.seed(name="Pasta", calories=360, protein=12, carbs=74, fat=1.5)
        blocked = self.client.patch(f"/api/ingredients/{food}", json={"calories": 900})
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(self.client.get(f"/api/ingredients/{food}").json()["calories"], 360)
        allowed = self.client.patch(f"/api/ingredients/{food}", json={"calories": 900, "override_calorie_check": True})
        self.assertEqual(allowed.json()["calories"], 900)

    def test_edit_can_convert_a_legacy_row_from_a_per_serving_label(self):
        food = self.seed(name="Bars", calories=200, protein=6, carbs=37, fat=1, unit="per 56g", serving_quantity=2)
        response = self.client.patch(f"/api/ingredients/{food}", json={
            **{k: LABEL[k] for k in ("calories", "protein", "carbs", "fat")},
            "nutrition_basis": "per_serving", "serving_grams": 56, "serving_quantity": 2,
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["unit"], "per 100g")
        self.assertAlmostEqual(body["calories"], 357.1, places=1)
        self.assertEqual(body["serving_grams"], 56)

    def test_per_serving_edit_needs_all_four_macros(self):
        food = self.seed(name="Pasta", calories=360, protein=12, carbs=74, fat=1.5)
        response = self.client.patch(f"/api/ingredients/{food}", json={
            "calories": 200, "nutrition_basis": "per_serving", "serving_grams": 56,
        })
        self.assertEqual(response.status_code, 422)

    # ── audit ────────────────────────────────────────────────────────────────

    def test_audit_lists_foods_to_review(self):
        self.seed(name="Fine", calories=360, protein=12, carbs=74, fat=1.5)
        self.seed(name="Mixed basis", calories=360, protein=6, carbs=37, fat=1)
        self.seed(name="Way off", calories=900, protein=1, carbs=1, fat=1)
        self.seed(name="Serving row", calories=150, protein=3, carbs=30, fat=2, unit="per 45g")
        self.seed(name="Lasagna", calories=360, protein=12, carbs=74, fat=1.5, serving_quantity=2)
        self.seed(name="Lasagna with weight", calories=360, protein=12, carbs=74, fat=1.5,
                  serving_quantity=2, serving_grams=56)

        body = self.client.get("/api/ingredients/audit").json()
        self.assertEqual(body["total"], 6)
        self.assertEqual(body["tolerance"], 0.15)
        # worst offender first
        self.assertEqual([i["name"] for i in body["calorie_mismatch"]], ["Way off", "Mixed basis"])
        self.assertEqual(body["calorie_mismatch"][1]["expected_calories"], 181.0)
        self.assertEqual([i["name"] for i in body["non_standard_basis"]], ["Serving row"])
        self.assertEqual([i["name"] for i in body["missing_serving_weight"]], ["Lasagna"])

    def test_audit_tolerance_is_adjustable(self):
        self.seed(name="Slightly off", calories=100, protein=10, carbs=10, fat=0)  # expected 80, +25%
        strict = self.client.get("/api/ingredients/audit?tolerance=0.15").json()
        loose = self.client.get("/api/ingredients/audit?tolerance=0.3").json()
        self.assertEqual(len(strict["calorie_mismatch"]), 1)
        self.assertEqual(len(loose["calorie_mismatch"]), 0)

    def test_audit_is_not_swallowed_by_the_id_route(self):
        self.assertEqual(self.client.get("/api/ingredients/audit").status_code, 200)

    def test_list_endpoint_carries_the_calorie_check(self):
        self.seed(name="Mixed basis", calories=360, protein=6, carbs=37, fat=1)
        row = self.client.get("/api/ingredients").json()[0]
        self.assertFalse(row["calorie_check"]["ok"])


if __name__ == "__main__":
    unittest.main()
