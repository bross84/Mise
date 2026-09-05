import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.ai import DEFAULT_BASE_URL, DEFAULT_MODEL

router = APIRouter(prefix='/api/settings', tags=['settings'])

ENV_FILE = Path(__file__).resolve().parents[1] / '.env'


def _upsert_env_vars(values: dict[str, str]) -> None:
    """Write or replace the given KEY=value lines in the app .env file, leaving others intact."""
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)

    existing_lines: list[str] = []
    if ENV_FILE.exists():
        existing_lines = ENV_FILE.read_text(encoding='utf-8').splitlines()

    remaining = dict(values)
    updated_lines: list[str] = []

    for line in existing_lines:
        key = line.split('=', 1)[0] if '=' in line else None
        if key in remaining:
            updated_lines.append(f'{key}={remaining.pop(key)}')
        else:
            updated_lines.append(line)

    for key, value in remaining.items():
        updated_lines.append(f'{key}={value}')

    ENV_FILE.write_text('\n'.join(updated_lines) + '\n', encoding='utf-8')


class OpenRouterKeyRequest(BaseModel):
    key: str


class AISettingsRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


class AISettingsResponse(BaseModel):
    model: str
    base_url: str
    has_key: bool


@router.get('/ai', response_model=AISettingsResponse)
def get_ai_settings() -> AISettingsResponse:
    return AISettingsResponse(
        model=os.getenv('AI_MODEL') or DEFAULT_MODEL,
        base_url=os.getenv('AI_BASE_URL') or DEFAULT_BASE_URL,
        has_key=bool(os.getenv('AI_API_KEY') or os.getenv('OPENROUTER_API_KEY')),
    )


@router.post('/ai', response_model=AISettingsResponse)
def save_ai_settings(payload: AISettingsRequest) -> AISettingsResponse:
    to_write: dict[str, str] = {}

    if payload.api_key is not None:
        key = payload.api_key.strip()
        if key:
            to_write['AI_API_KEY'] = key
    if payload.model is not None:
        to_write['AI_MODEL'] = payload.model.strip()
    if payload.base_url is not None:
        to_write['AI_BASE_URL'] = payload.base_url.strip().rstrip('/')

    if not to_write:
        raise HTTPException(status_code=400, detail='Nothing to save.')

    try:
        _upsert_env_vars(to_write)
    except OSError as error:
        raise HTTPException(status_code=500, detail=f'Failed to persist AI settings: {error}') from error

    # Reflect changes in the running process immediately.
    for key, value in to_write.items():
        os.environ[key] = value

    return get_ai_settings()


@router.post('/openrouter-key')
def save_openrouter_key(payload: OpenRouterKeyRequest):
    """Back-compat alias — writes the shared AI_API_KEY."""
    key = payload.key.strip()
    if not key:
        raise HTTPException(status_code=400, detail='API key cannot be empty.')

    try:
        _upsert_env_vars({'AI_API_KEY': key})
    except OSError as error:
        raise HTTPException(status_code=500, detail=f'Failed to persist API key: {error}') from error

    os.environ['AI_API_KEY'] = key

    return {'saved': True}
