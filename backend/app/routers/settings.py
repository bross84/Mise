import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix='/api/settings', tags=['settings'])

ENV_FILE = Path(__file__).resolve().parents[1] / '.env'


class OpenRouterKeyRequest(BaseModel):
    key: str


def _write_key_to_env_file(key: str) -> None:
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)

    existing_lines: list[str] = []
    if ENV_FILE.exists():
        existing_lines = ENV_FILE.read_text(encoding='utf-8').splitlines()

    key_line = f'OPENROUTER_API_KEY={key}'
    updated_lines: list[str] = []
    replaced = False

    for line in existing_lines:
        if line.startswith('OPENROUTER_API_KEY='):
            updated_lines.append(key_line)
            replaced = True
        else:
            updated_lines.append(line)

    if not replaced:
        updated_lines.append(key_line)

    ENV_FILE.write_text('\n'.join(updated_lines) + '\n', encoding='utf-8')


@router.post('/openrouter-key')
def save_openrouter_key(payload: OpenRouterKeyRequest):
    key = payload.key.strip()
    if not key:
        raise HTTPException(status_code=400, detail='OpenRouter API key cannot be empty.')

    try:
        _write_key_to_env_file(key)
    except OSError as error:
        raise HTTPException(status_code=500, detail=f'Failed to persist OpenRouter API key: {error}') from error

    # Update process env so AI test endpoint can use the key immediately.
    os.environ['OPENROUTER_API_KEY'] = key

    return {'saved': True}