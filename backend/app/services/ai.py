import os

import httpx


class AIService:
    BASE_URL = 'https://openrouter.ai/api/v1'
    MODEL = 'deepseek/deepseek-v4-flash'

    async def complete(self, prompt: str) -> str:
        api_key = os.getenv('OPENROUTER_API_KEY')
        if not api_key:
            raise ValueError('OPENROUTER_API_KEY is missing. Save it in Settings or set it in the environment.')

        payload = {
            'model': self.MODEL,
            'messages': [
                {
                    'role': 'user',
                    'content': prompt,
                }
            ],
        }
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(f'{self.BASE_URL}/chat/completions', headers=headers, json=payload)
                response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail = ''
            try:
                detail = error.response.json().get('error', {}).get('message') or error.response.text
            except Exception:
                detail = error.response.text
            raise RuntimeError(f'OpenRouter request failed ({error.response.status_code}): {detail}') from error
        except httpx.HTTPError as error:
            raise RuntimeError(f'OpenRouter request failed: {error}') from error

        data = response.json()
        try:
            return data['choices'][0]['message']['content'].strip()
        except (KeyError, IndexError, AttributeError) as error:
            raise RuntimeError('OpenRouter response did not include completion text.') from error