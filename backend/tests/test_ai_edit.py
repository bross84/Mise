"""The recipe assistant only proposes changes when the cook presses "Draft change"."""
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.services.ai import AIService

# What a model that ignores its instructions would send back for "I only used 15 ml of water".
EAGER_MODEL_JSON = json.dumps({
    "reply": "Let's update the water.",
    "proposed": {},
    "changes": [{
        "op": "update", "field": "title", "target_id": None, "label": "Rename",
        "before": "Pizza dough", "after": "Renamed", "why": "eager",
    }],
    "suggestions": [],
})


class AiEditModeTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)

        def override_get_db():
            db = Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        created = self.client.post("/api/recipes", json={
            "title": "Pizza dough", "servings": 1, "ingredients": [], "instructions": "Mix.",
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.recipe_id = created.json()["id"]

    def tearDown(self):
        app.dependency_overrides.clear()

    def ai_edit(self, model_output, **body):
        calls = []

        async def fake_call(_self, messages, *, response_format=None):
            calls.append({"messages": messages, "response_format": response_format})
            return model_output

        with patch.object(AIService, "_call", fake_call):
            res = self.client.post(f"/api/recipes/{self.recipe_id}/ai-edit", json=body)
        return res, calls

    def test_plain_message_is_chat_only(self):
        res, calls = self.ai_edit("You used half the water, so the dough came out stiffer.",
                                  instruction="I only used 15 ml of water")
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["reply"], "You used half the water, so the dough came out stiffer.")
        self.assertEqual(data["changes"], [])
        self.assertEqual(data["suggestions"], [])
        self.assertIsNone(calls[0]["response_format"])
        self.assertNotIn("Draft change", calls[0]["messages"][0]["content"])

    def test_plain_message_cannot_produce_changes_even_if_the_model_tries(self):
        res, _ = self.ai_edit(EAGER_MODEL_JSON, instruction="I only used 15 ml of water")
        data = res.json()
        self.assertEqual(data["changes"], [])
        self.assertEqual(data["suggestions"], [])

    def test_draft_returns_changes(self):
        res, calls = self.ai_edit(EAGER_MODEL_JSON, instruction="rename it", draft=True)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(len(res.json()["changes"]), 1)
        self.assertEqual(calls[0]["response_format"], {"type": "json_object"})
        self.assertIn("Draft change", calls[0]["messages"][0]["content"])

    def _recipe_with_ingredients(self):
        res = self.client.patch(f"/api/recipes/{self.recipe_id}", json={
            "ingredients": [
                {"id": "ing-1", "name": "Olive oil", "amount": 1, "unit": "tbsp"},
                {"id": "ing-2", "name": "Flour", "amount": 250, "unit": "g"},
            ],
        })
        self.assertEqual(res.status_code, 200, res.text)
        return [i["id"] for i in res.json()["ingredients"]]

    def test_draft_derives_changes_from_proposed_when_changes_is_empty(self):
        oil_id, flour_id = self._recipe_with_ingredients()
        model_json = json.dumps({
            "reply": "Converted tbsp to grams.",
            "proposed": {"ingredients": [
                {"id": oil_id, "name": "Olive oil", "amount": 14, "unit": "g"},
                {"id": flour_id, "name": "Flour", "amount": 250, "unit": "g"},
            ]},
            "changes": [],
            "suggestions": [],
        })
        res, _ = self.ai_edit(model_json, instruction="convert to grams", draft=True)
        self.assertEqual(res.status_code, 200, res.text)
        changes = res.json()["changes"]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["op"], "update")
        self.assertEqual(changes[0]["target_id"], oil_id)
        self.assertEqual(changes[0]["after"], {"amount": 14, "unit": "g"})

    def test_derived_changes_never_remove_ingredients_missing_from_proposed(self):
        oil_id, _ = self._recipe_with_ingredients()
        model_json = json.dumps({
            "reply": "Converted.",
            "proposed": {"ingredients": [{"id": oil_id, "name": "Olive oil", "amount": 14, "unit": "g"}]},
            "changes": [],
            "suggestions": [],
        })
        res, _ = self.ai_edit(model_json, instruction="convert to grams", draft=True)
        self.assertEqual([c["op"] for c in res.json()["changes"]], ["update"])

    def test_listed_changes_win_over_proposed(self):
        model_json = json.dumps({
            "reply": "Renamed.",
            "proposed": {"title": "From proposed"},
            "changes": [{"op": "update", "field": "title", "target_id": None, "label": "Rename",
                         "before": "Pizza dough", "after": "From changes", "why": ""}],
            "suggestions": [],
        })
        res, _ = self.ai_edit(model_json, instruction="rename it", draft=True)
        changes = res.json()["changes"]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["after"], "From changes")


if __name__ == "__main__":
    unittest.main()
