"""AI settings saved from the Settings page must survive restarts, whatever .env says."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.main import load_environment


class LoadEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.project_env = self.dir / ".env"
        self.settings_env = self.dir / "ai_settings.env"
        self.settings_env.write_text("AI_MODEL=gpt-4o-mini\nAI_BASE_URL=https://api.openai.com/v1\n")

    def load(self, container_env):
        """container_env is what docker compose's env_file hands the process before Python starts."""
        with patch.dict(os.environ, container_env, clear=True):
            load_environment(self.project_env, self.settings_env)
            return os.getenv("AI_MODEL"), os.getenv("AI_BASE_URL")

    def test_saved_model_wins_over_a_blank_line_in_env(self):
        # .env copied from .env.example has a blank AI_MODEL= line
        self.assertEqual(self.load({"AI_MODEL": ""})[0], "gpt-4o-mini")

    def test_saved_model_wins_over_deepseek_in_env(self):
        self.assertEqual(self.load({"AI_MODEL": "deepseek/deepseek-chat"})[0], "gpt-4o-mini")

    def test_saved_settings_apply_when_env_has_nothing(self):
        self.assertEqual(self.load({}), ("gpt-4o-mini", "https://api.openai.com/v1"))

    def test_env_values_not_in_the_settings_file_are_kept(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "k"}, clear=True):
            load_environment(self.project_env, self.settings_env)
            self.assertEqual(os.getenv("OPENROUTER_API_KEY"), "k")

    def test_missing_settings_file_leaves_env_alone(self):
        self.settings_env.unlink()
        self.assertEqual(self.load({"AI_MODEL": "from-env"})[0], "from-env")


if __name__ == "__main__":
    unittest.main()
