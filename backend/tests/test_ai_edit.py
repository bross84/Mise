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
        res, _ = self.ai_edit(model_json, instruction="weigh the oil instead", draft=True)
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
        res, _ = self.ai_edit(model_json, instruction="weigh the oil instead", draft=True)
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

    def _grams_recipe(self):
        res = self.client.patch(f"/api/recipes/{self.recipe_id}", json={
            "ingredients": [
                {"id": "a", "name": "Olive oil", "amount": 1, "unit": "tbsp"},
                {"id": "b", "name": "Flour", "amount": 250, "unit": "g"},
                {"id": "c", "name": "Cayenne", "amount": 0.5, "unit": "tsp"},
                {"id": "d", "name": "Chicken", "amount": 1, "unit": "lb"},
                {"id": "e", "name": "Garlic", "amount": 2, "unit": "clove"},
                {"id": "f", "name": "Cumin", "amount": 1, "unit": "tsp"},
            ],
        })
        self.assertEqual(res.status_code, 200, res.text)
        return {i["name"]: i["id"] for i in res.json()["ingredients"]}

    def test_grams_request_converts_every_non_metric_ingredient(self):
        ids = self._grams_recipe()
        model_json = json.dumps({"items": [
            {"id": ids["Olive oil"], "grams": 13.5},
            {"id": ids["Cayenne"], "grams": 1.2},
            {"id": ids["Chicken"], "grams": 453.6},
            {"id": ids["Cumin"], "grams": 2.1},
        ]})
        res, calls = self.ai_edit(model_json, instruction="Change all non-metric units to grams", draft=True)
        self.assertEqual(res.status_code, 200, res.text)
        changes = res.json()["changes"]
        self.assertEqual({c["target_id"] for c in changes},
                         {ids["Olive oil"], ids["Cayenne"], ids["Chicken"], ids["Cumin"]})
        by_target = {c["target_id"]: c["after"] for c in changes}
        self.assertEqual(by_target[ids["Olive oil"]], {"amount": 14.0, "unit": "g"})
        self.assertEqual(by_target[ids["Chicken"]], {"amount": 454.0, "unit": "g"})
        self.assertEqual(by_target[ids["Cayenne"]], {"amount": 1.2, "unit": "g"})
        # Only the non-metric ones are sent to the model; grams and count units are left alone.
        sent = json.loads(calls[0]["messages"][1]["content"])
        self.assertEqual({i["name"] for i in sent}, {"Olive oil", "Cayenne", "Chicken", "Cumin"})
        self.assertIn("Converted 4 of 4", res.json()["reply"])

    def test_grams_request_names_ingredients_the_model_did_not_weigh(self):
        ids = self._grams_recipe()
        model_json = json.dumps({"items": [
            {"id": ids["Olive oil"], "grams": 14},
            {"id": ids["Cayenne"], "grams": None},
        ]})
        res, _ = self.ai_edit(model_json, instruction="convert everything to grams", draft=True)
        data = res.json()
        self.assertEqual(len(data["changes"]), 1)
        self.assertIn("Converted 1 of 4", data["reply"])
        self.assertIn("Cayenne", data["reply"])
        self.assertIn("Chicken", data["reply"])

    def test_grams_request_with_nothing_to_convert_skips_the_model(self):
        res, calls = self.ai_edit("unused", instruction="convert everything to grams", draft=True)
        self.assertEqual(res.json()["changes"], [])
        self.assertIn("Nothing to convert", res.json()["reply"])
        self.assertEqual(calls, [])

    def test_unrelated_draft_does_not_use_the_grams_path(self):
        self._grams_recipe()
        res, calls = self.ai_edit(EAGER_MODEL_JSON, instruction="rename it", draft=True)
        self.assertEqual(len(res.json()["changes"]), 1)
        self.assertIn("Draft change", calls[0]["messages"][0]["content"])

    def _rounding_recipe(self):
        res = self.client.patch(f"/api/recipes/{self.recipe_id}", json={
            "ingredients": [
                {"id": "a", "name": "Oil", "amount": 4.6, "unit": "g"},
                {"id": "b", "name": "Paprika", "amount": 7.5, "unit": "g"},
                {"id": "c", "name": "Salt", "amount": 6, "unit": "g"},
                {"id": "d", "name": "Pepper", "amount": 0.6, "unit": "g"},
                {"id": "e", "name": "Milk", "amount": 120.4, "unit": "ml"},
                {"id": "f", "name": "Cumin", "amount": 1.5, "unit": "tsp"},
            ],
        })
        self.assertEqual(res.status_code, 200, res.text)

    def test_round_up_request_rounds_every_gram_and_ml_amount_without_the_model(self):
        self._rounding_recipe()
        res, calls = self.ai_edit("unused", instruction="round up all ingredients to x.0 grams example 4.6 goes to 5g", draft=True)
        self.assertEqual(res.status_code, 200, res.text)
        by_target = {c["target_id"]: c["after"]["amount"] for c in res.json()["changes"]}
        self.assertEqual(by_target, {"a": 5.0, "b": 8.0, "d": 1.0, "e": 121.0})
        self.assertEqual(calls, [])
        self.assertIn("Rounded 4 amounts up", res.json()["reply"])

    def test_round_down_and_nearest(self):
        self._rounding_recipe()
        res, _ = self.ai_edit("unused", instruction="round all grams down to whole numbers", draft=True)
        self.assertEqual({c["target_id"]: c["after"]["amount"] for c in res.json()["changes"]},
                         {"a": 4.0, "b": 7.0, "e": 120.0})
        res, _ = self.ai_edit("unused", instruction="round all grams to the nearest whole number", draft=True)
        self.assertEqual({c["target_id"]: c["after"]["amount"] for c in res.json()["changes"]},
                         {"a": 5.0, "b": 8.0, "d": 1.0, "e": 120.0})

    def test_rounding_with_nothing_to_round(self):
        res, calls = self.ai_edit("unused", instruction="round up all grams to whole numbers", draft=True)
        self.assertEqual(res.json()["changes"], [])
        self.assertIn("Nothing to round", res.json()["reply"])
        self.assertEqual(calls, [])

    def test_round_plus_convert_still_goes_to_the_model_path(self):
        self._rounding_recipe()
        res, calls = self.ai_edit(json.dumps({"items": [{"id": "f", "grams": 3}]}),
                                  instruction="convert tsp to grams and round them", draft=True)
        self.assertEqual(len(calls), 1)


    def _mixed_unit_recipe(self):
        res = self.client.patch(f"/api/recipes/{self.recipe_id}", json={
            "ingredients": [
                {"id": "a", "name": "Salt", "amount": 1.5, "unit": "Tsp"},
                {"id": "b", "name": "Lime juice", "amount": 1, "unit": "ea"},
                {"id": "c", "name": "Almond milk", "amount": 120, "unit": "ml"},
                {"id": "d", "name": "Beef", "amount": 800, "unit": "g"},
                {"id": "e", "name": "Parsley", "amount": 1.5, "unit": "tsp"},
            ],
        })
        self.assertEqual(res.status_code, 200, res.text)

    def test_typo_covert_still_uses_the_grams_path_and_rounds_when_asked(self):
        self._mixed_unit_recipe()
        model_json = json.dumps({"items": [
            {"id": "a", "grams": 8.5}, {"id": "e", "grams": 0.9},
        ]})
        res, calls = self.ai_edit(
            model_json, draft=True,
            instruction="covert all non-metric ingredients to grams. Round them up to the nearest 1",
        )
        self.assertEqual(res.status_code, 200, res.text)
        by_target = {c["target_id"]: c["after"] for c in res.json()["changes"]}
        self.assertEqual(by_target["a"], {"amount": 9.0, "unit": "g"})
        self.assertEqual(by_target["e"], {"amount": 1.0, "unit": "g"})
        self.assertIn("rounded up", res.json()["reply"])
        self.assertEqual(len(calls), 1)

    def test_non_gram_request_also_converts_ml_and_count_units(self):
        self._mixed_unit_recipe()
        model_json = json.dumps({"items": [
            {"id": "a", "grams": 8.5}, {"id": "b", "grams": 30}, {"id": "c", "grams": 124}, {"id": "e", "grams": 0.9},
        ]})
        res, calls = self.ai_edit(model_json, draft=True,
                                  instruction="convert all non-gram ingredients to grams taking density into account")
        sent = json.loads(calls[0]["messages"][1]["content"])
        self.assertEqual({i["name"] for i in sent}, {"Salt", "Lime juice", "Almond milk", "Parsley"})
        self.assertEqual({c["target_id"] for c in res.json()["changes"]}, {"a", "b", "c", "e"})
        self.assertIn("Converted 4 of 4", res.json()["reply"])

    def test_plain_non_metric_request_leaves_ml_and_counts_alone(self):
        self._mixed_unit_recipe()
        res, calls = self.ai_edit(json.dumps({"items": [{"id": "a", "grams": 8.5}, {"id": "e", "grams": 0.9}]}),
                                  instruction="change all non-metric units to grams", draft=True)
        sent = json.loads(calls[0]["messages"][1]["content"])
        self.assertEqual({i["name"] for i in sent}, {"Salt", "Parsley"})


    def test_intent_detection_survives_typos_and_ignores_near_misses(self):
        from app.routers.recipes import _is_grams_conversion_request as conv, _is_rounding_request as rnd
        for text in ("covert all non-gram ingredients to grams", "convrt everything to gramz",
                     "chnge all to gramz please", "turn everything into grams"):
            self.assertTrue(conv(text), text)
        for text in ("round the oil to 5g", "add a pinch around the edge", "halve the salt", "rename it",
                     "use 14 g of oil"):
            self.assertFalse(conv(text), text)
            self.assertFalse(rnd(text), text)
        self.assertTrue(rnd("rond up all grams to the nearest 1"))


if __name__ == "__main__":
    unittest.main()
