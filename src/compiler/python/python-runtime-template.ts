/** The content of promptlang_runtime.py, written alongside compiled Python files. */
export const PYTHON_RUNTIME_SOURCE = `"""
PromptLang runtime — Python
Minimal client interface + mock + provider adapters.

This file is auto-generated as part of \`promptlang compile --target python\`.
Do not edit manually — it will be overwritten on the next compile.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Literal, TYPE_CHECKING

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
    """Requires: pip install httpx"""

    def __init__(self, api_key: str, base_url: str = "https://api.anthropic.com/v1"):
        self.api_key = api_key
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
        if "temperature" in request:
            payload["temperature"] = request["temperature"]

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/messages",
                json=payload,
                headers=headers,
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()

        content = "".join(
            block["text"]
            for block in data.get("content", [])
            if block.get("type") == "text"
        )

        return {
            "content": content,
            "usage": {
                "input_tokens": data.get("usage", {}).get("input_tokens", 0),
                "output_tokens": data.get("usage", {}).get("output_tokens", 0),
            },
        }


# ---- OpenAI provider ----

class OpenAIClient(PromptClient):
    """Requires: pip install httpx"""

    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key
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
            response.raise_for_status()
            data = response.json()

        usage = data.get("usage", {})
        return {
            "content": data["choices"][0]["message"]["content"],
            "usage": {
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
            },
        }
`;

/** Returns the autonomous Python runtime source to be written alongside compiled files. */
export function getPythonRuntimeSource(): string {
  return PYTHON_RUNTIME_SOURCE;
}
