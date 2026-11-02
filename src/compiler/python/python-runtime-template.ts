/** The content of promptlang_runtime.py, written alongside compiled Python files. */
const PYTHON_RUNTIME_SOURCE = `"""
PromptLang runtime — Python
Minimal client interface + mock + provider adapters.

This file is auto-generated as part of \`promptlang compile --target python\`.
Do not edit manually — it will be overwritten on the next compile.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Literal, NoReturn, TYPE_CHECKING

if TYPE_CHECKING:
    pass

try:
    from typing import TypedDict, NotRequired
except ImportError:
    from typing_extensions import TypedDict, NotRequired  # type: ignore[assignment]


# ---- Types ----

class Message(TypedDict):
    role: Literal["system", "user", "assistant"]
    content: str


class PromptRequest(TypedDict):
    model: str
    messages: list[Message]
    temperature: NotRequired[float]
    max_tokens: NotRequired[int]


class Usage(TypedDict):
    input_tokens: int
    output_tokens: int


class PromptResponse(TypedDict):
    content: str
    usage: NotRequired[Usage]


# ---- Errors (same names and meaning as the TypeScript runtime) ----

class PromptClientError(Exception):
    """Base class for every error a client raises about a call."""

    def __init__(self, message: str, provider: str | None = None):
        super().__init__(message)
        self.provider = provider


class AuthenticationError(PromptClientError):
    """HTTP 401: the key is invalid."""


class RateLimitError(PromptClientError):
    """HTTP 429."""


class InvalidRequestError(PromptClientError):
    """HTTP 400 or 404: the provider refused the request (model, parameters)."""


class ServerError(PromptClientError):
    """Any other non-2xx status."""

    def __init__(self, status_code: int, message: str, provider: str | None = None):
        super().__init__(message, provider)
        self.status_code = status_code


class InvalidResponseError(PromptClientError):
    """A 2xx body that is not JSON or lacks a documented field."""


def _require_api_key(api_key: object, client: str, env_var: str) -> str:
    if not isinstance(api_key, str) or api_key.strip() == "":
        raise ValueError(f"{client}: api_key is empty. Pass a key, e.g. from os.environ['{env_var}'].")
    return api_key


def _raise_for_status(response: Any, provider: str) -> None:
    status = response.status_code
    if 200 <= status < 300:
        return
    message = None
    try:
        body = response.json()
        if isinstance(body, dict) and isinstance(body.get("error"), dict):
            message = body["error"].get("message")
    except ValueError:
        # An error body that is not JSON still gets classified by its status below.
        pass
    if status == 401:
        raise AuthenticationError(message or "Authentication failed. Check that your API key is valid.", provider)
    if status == 429:
        raise RateLimitError(message or "Rate limit exceeded.", provider)
    if status in (400, 404):
        raise InvalidRequestError(message or "Invalid request. Check the model name and request parameters.", provider)
    raise ServerError(status, message or f"Server error ({status}). The provider may be temporarily unavailable.", provider)


def _read_json_object(response: Any, provider: str) -> dict:
    try:
        data = response.json()
    except ValueError:
        raise InvalidResponseError(f"{provider} returned a non-JSON response body", provider) from None
    if not isinstance(data, dict):
        raise InvalidResponseError(f"{provider} returned a JSON body that is not an object", provider)
    return data


def _invalid_field(provider: str, field: str) -> NoReturn:
    raise InvalidResponseError(
        f"{provider} response has an unexpected shape: \`{field}\` is missing or has the wrong type",
        provider,
    )


def _is_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# ---- Client interface ----

class PromptClient(ABC):
    @abstractmethod
    async def complete(self, request: PromptRequest) -> PromptResponse: ...


# ---- Mock client for testing ----

class MockClient(PromptClient):
    def __init__(self, responses):
        self._responses = list(responses) if isinstance(responses, (list, tuple)) else responses

    async def complete(self, request: PromptRequest) -> PromptResponse:
        if callable(self._responses):
            return self._responses(request)
        if not self._responses:
            raise RuntimeError("MockClient: no more responses queued")
        return self._responses.pop(0)


# ---- Anthropic provider ----

class AnthropicClient(PromptClient):
    """Requires: pip install httpx

    Sends API version 2026-10-21 and never sends temperature, which that
    version rejects on every model.
    """

    def __init__(self, api_key: str, base_url: str = "https://api.anthropic.com/v1"):
        self.api_key = _require_api_key(api_key, "AnthropicClient", "ANTHROPIC_API_KEY")
        self.base_url = base_url

    async def complete(self, request: PromptRequest) -> PromptResponse:
        try:
            import httpx
        except ImportError:
            raise ImportError("AnthropicClient requires httpx: pip install httpx")

        system_msgs = [m for m in request["messages"] if m["role"] == "system"]
        user_msgs = [m for m in request["messages"] if m["role"] != "system"]

        payload: dict = {
            "model": request["model"],
            "max_tokens": request.get("max_tokens", 1024),
            "messages": user_msgs,
        }
        if system_msgs:
            payload["system"] = "\\n\\n".join(m["content"] for m in system_msgs)

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2026-10-21",
            "content-type": "application/json",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/messages",
                json=payload,
                headers=headers,
                timeout=60.0,
            )
        _raise_for_status(response, "anthropic")
        data = _read_json_object(response, "anthropic")
        blocks = data.get("content")
        if not isinstance(blocks, list):
            _invalid_field("anthropic", "content")
        usage = data.get("usage")
        if not isinstance(usage, dict) or not _is_count(usage.get("input_tokens")) or not _is_count(usage.get("output_tokens")):
            _invalid_field("anthropic", "usage")

        content = "".join(
            block["text"]
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)
        )

        return {
            "content": content,
            "usage": {
                "input_tokens": usage["input_tokens"],
                "output_tokens": usage["output_tokens"],
            },
        }


# ---- OpenAI provider ----

class OpenAIClient(PromptClient):
    """Requires: pip install httpx"""

    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1"):
        self.api_key = _require_api_key(api_key, "OpenAIClient", "OPENAI_API_KEY")
        self.base_url = base_url

    async def complete(self, request: PromptRequest) -> PromptResponse:
        try:
            import httpx
        except ImportError:
            raise ImportError("OpenAIClient requires httpx: pip install httpx")

        payload: dict = {
            "model": request["model"],
            "messages": request["messages"],
        }
        if "temperature" in request:
            payload["temperature"] = request["temperature"]
        if "max_tokens" in request:
            payload["max_tokens"] = request["max_tokens"]

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=60.0,
            )
        _raise_for_status(response, "openai")
        data = _read_json_object(response, "openai")
        choices = data.get("choices")
        choice = choices[0] if isinstance(choices, list) and choices else None
        if not isinstance(choice, dict) or not isinstance(choice.get("message"), dict):
            _invalid_field("openai", "choices[0].message")
        content = choice["message"].get("content")
        # content is null when the model answers with a refusal or tool call only.
        if content is not None and not isinstance(content, str):
            _invalid_field("openai", "choices[0].message.content")
        usage = data.get("usage")
        if not isinstance(usage, dict) or not _is_count(usage.get("prompt_tokens")) or not _is_count(usage.get("completion_tokens")):
            _invalid_field("openai", "usage")
        return {
            "content": content or "",
            "usage": {
                "input_tokens": usage["prompt_tokens"],
                "output_tokens": usage["completion_tokens"],
            },
        }
`;

/** Returns the autonomous Python runtime source to be written alongside compiled files. */
export function getPythonRuntimeSource(): string {
  return PYTHON_RUNTIME_SOURCE;
}
