import os

import httpx

DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
DEFAULT_MODEL = 'deepseek/deepseek-chat'


class AIService:
    """Thin client for any OpenAI-compatible chat-completions endpoint.

    Configured from the environment so the same code works against OpenRouter,
    OpenAI, Groq, Together, or a local Ollama / LM Studio server:

    | Variable      | Purpose                                    |
    | ------------- | ------------------------------------------ |
    | AI_API_KEY    | API key (falls back to OPENROUTER_API_KEY) |
    | AI_MODEL      | Model id (default deepseek/deepseek-chat)  |
    | AI_BASE_URL   | API base (default OpenRouter)              |
    """

    def __init__(self) -> None:
        self.base_url = (os.getenv('AI_BASE_URL') or DEFAULT_BASE_URL).rstrip('/')
        self.model = os.getenv('AI_MODEL') or DEFAULT_MODEL
        self.api_key = os.getenv('AI_API_KEY') or os.getenv('OPENROUTER_API_KEY')

    async def _call(self, messages: list[dict], *, response_format: dict | None = None) -> str:
        if not self.api_key:
            raise ValueError('AI API key is missing. Save it in Settings or set AI_API_KEY in the environment.')

        payload: dict = {'model': self.model, 'messages': messages}
        if response_format is not None:
            payload['response_format'] = response_format
        headers = {'Authorization': f'Bearer {self.api_key}', 'Content-Type': 'application/json'}

        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(f'{self.base_url}/chat/completions', headers=headers, json=payload)
                response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail = ''
            try:
                detail = error.response.json().get('error', {}).get('message') or error.response.text
            except Exception:
                detail = error.response.text
            raise RuntimeError(f'AI request failed ({error.response.status_code}): {detail}') from error
        except httpx.HTTPError as error:
            raise RuntimeError(f'AI request failed: {error}') from error

        data = response.json()
        try:
            return data['choices'][0]['message']['content'].strip()
        except (KeyError, IndexError, AttributeError) as error:
            raise RuntimeError('AI response did not include completion text.') from error

    async def complete(self, prompt: str) -> str:
        return await self._call([{'role': 'user', 'content': prompt}])

    async def complete_with_system(self, system: str, prompt: str) -> str:
        return await self._call([
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': prompt},
        ])
