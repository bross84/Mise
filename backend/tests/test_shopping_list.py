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


if __name__ == "__main__":
    unittest.main()
