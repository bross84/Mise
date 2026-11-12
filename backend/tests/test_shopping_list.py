"""Shopping list totals, against an isolated in-memory database."""
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models.ingredient import Ingredient
from app.models.recipe import Recipe


class ShoppingListTests(unittest.TestCase):
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

    def seed_bacon(self):
        # Label: 2 slices = 26 g, so one slice weighs 13 g.
        with self.Session() as db:
            row = Ingredient(
                name="Bacon", calories=540, protein=40, carbs=0, fat=40, unit="per 100g",
                source="local", serving_grams=26, serving_quantity=2,
            )
            db.add(row)
            db.commit()
            return row.id

    def seed_recipe(self, ingredients):
        with self.Session() as db:
            recipe = Recipe(title="Test", servings=4, ingredients=ingredients)
            db.add(recipe)
            db.commit()
            return recipe.id

    def shopping_list(self, *recipe_ids):
        response = self.client.post("/api/recipes/shopping-list", json={"recipe_ids": list(recipe_ids)})
        self.assertEqual(response.status_code, 200, response.text)
        return response.text

    def test_piece_unit_is_not_reported_in_grams(self):
        bacon = self.seed_bacon()
        recipe = self.seed_recipe([{"ingredient_id": bacon, "name": "Bacon", "amount": 4, "unit": "slices"}])
        self.assertEqual(self.shopping_list(recipe), "Bacon - 4 slices")

    def test_piece_unit_sums_across_recipes(self):
        bacon = self.seed_bacon()
        first = self.seed_recipe([{"ingredient_id": bacon, "name": "Bacon", "amount": 4, "unit": "slices"}])
        second = self.seed_recipe([{"ingredient_id": bacon, "name": "Bacon", "amount": 2, "unit": "slices"}])
        self.assertEqual(self.shopping_list(first, second), "Bacon - 6 slices")

    def test_weight_unit_still_converts_back(self):
        bacon = self.seed_bacon()
        recipe = self.seed_recipe([{"ingredient_id": bacon, "name": "Bacon", "amount": 8, "unit": "oz"}])
        self.assertEqual(self.shopping_list(recipe), "Bacon - 8 oz")

    def shopping_list_items(self, *recipe_ids):
        response = self.client.post("/api/recipes/shopping-list/items", json={"recipe_ids": list(recipe_ids)})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_items_carry_ingredient_and_walmart_link(self):
        bacon = self.seed_bacon()
        self.client.patch(f"/api/ingredients/{bacon}", json={
            "walmart_item_id": "https://www.walmart.com/ip/Bacon-16-oz/123456789?from=search",
        })
        recipe = self.seed_recipe([
            {"ingredient_id": bacon, "name": "Bacon", "amount": 4, "unit": "slices"},
            {"name": "Sea salt flakes", "amount": 1, "unit": "pinch"},
            {"name": "Parsley"},
        ])
        self.assertEqual(self.shopping_list_items(recipe), [
            {"name": "Bacon", "amount": "4 slices", "ingredient_id": bacon,
             "walmart_item_id": "123456789", "line": "Bacon - 4 slices"},
            {"name": "Parsley", "amount": "", "ingredient_id": None,
             "walmart_item_id": None, "line": "Parsley"},
            {"name": "Sea salt flakes", "amount": "1 pinch", "ingredient_id": None,
             "walmart_item_id": None, "line": "Sea salt flakes - 1 pinch"},
        ])
        # The plain-text list is the same lines in the same order.
        self.assertEqual(self.shopping_list(recipe), "Bacon - 4 slices\nParsley\nSea salt flakes - 1 pinch")


    # Saving and clearing an ingredient's Walmart product.

    def test_rejects_an_address_that_is_not_a_walmart_product(self):
        bacon = self.seed_bacon()
        response = self.client.patch(f"/api/ingredients/{bacon}", json={"walmart_item_id": "https://www.walmart.com/search?q=bacon"})
        self.assertEqual(response.status_code, 422)

    def test_blank_clears_the_link(self):
        bacon = self.seed_bacon()
        self.client.patch(f"/api/ingredients/{bacon}", json={"walmart_item_id": "123456789"})
        response = self.client.patch(f"/api/ingredients/{bacon}", json={"walmart_item_id": ""})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["walmart_item_id"])

    def test_editing_other_fields_keeps_the_link(self):
        bacon = self.seed_bacon()
        self.client.patch(f"/api/ingredients/{bacon}", json={"walmart_item_id": "123456789"})
        response = self.client.patch(f"/api/ingredients/{bacon}", json={"name": "Thick Bacon"})
        self.assertEqual(response.json()["walmart_item_id"], "123456789")


if __name__ == "__main__":
    unittest.main()
