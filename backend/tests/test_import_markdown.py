"""/recipes/import-markdown turns pasted recipe text into form fields.

A document with no recipe name (a copied ingredient list and steps, a card with the heading cut off)
must still import: the Add Recipe form has a Recipe Name field and requires one before saving.
Only a document with no ingredients is rejected. The model's reply is faked here; these tests pin
down what the endpoint does with it.
"""
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.routers.recipes import IMPORT_MARKDOWN_SYSTEM_PROMPT
from app.services.ai import AIService


class ImportMarkdownTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def import_with_reply(self, reply):
        async def fake_complete(_self, _system, _prompt):
            return reply if isinstance(reply, str) else json.dumps(reply)

        with patch.object(AIService, "complete_with_system", fake_complete):
            return self.client.post("/api/recipes/import-markdown", json={"markdown": "1. Cook the rice."})

    def test_missing_title_imports_with_an_empty_name(self):
        for title in ("", None):
            with self.subTest(title=title):
                res = self.import_with_reply(
                    {"title": title, "servings": 4, "ingredients_text": "450g rice\n1 lb ground beef"}
                )
                self.assertEqual(res.status_code, 200, res.text)
                body = res.json()
                self.assertEqual(body["title"], "")
                self.assertEqual(body["ingredients_text"], "450g rice\n1 lb ground beef")
                self.assertEqual(body["servings"], 4)

    def test_title_key_absent_also_imports(self):
        res = self.import_with_reply({"ingredients_text": "2 eggs"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["title"], "")

    def test_a_given_title_is_kept_and_trimmed(self):
        res = self.import_with_reply({"title": "  Beef Rice Bowls ", "ingredients_text": "1 lb ground beef"})
        self.assertEqual(res.json()["title"], "Beef Rice Bowls")

    def test_no_ingredients_is_still_rejected(self):
        res = self.import_with_reply({"title": "Soup", "ingredients_text": "  "})
        self.assertEqual(res.status_code, 422)
        self.assertIn("ingredients_text", res.json()["detail"])

    def test_model_error_is_passed_through(self):
        res = self.import_with_reply({"error": "this is not a recipe"})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()["detail"], "this is not a recipe")

    def test_prompt_no_longer_demands_a_title(self):
        self.assertNotIn("recipe title AND", IMPORT_MARKDOWN_SYSTEM_PROMPT)
        self.assertIn("never invent a name", IMPORT_MARKDOWN_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
