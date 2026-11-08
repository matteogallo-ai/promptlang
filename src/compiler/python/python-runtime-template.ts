/** The content of promptlang_runtime.py, written alongside compiled Python files. */
const PYTHON_RUNTIME_SOURCE = `"""
PromptLang runtime — Python
Minimal client interface + mock + provider adapters.

This file is auto-generated as part of \`promptlang compile --target python\`.
Do not edit manually — it will be overwritten on the next compile.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
import json
import math
import re
from datetime import date as _date
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
    """Base class for the errors a client raises about an HTTP response.

    Timeouts and connection failures are not wrapped: they raise httpx exceptions.
    """

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


class IncompleteResponseError(PromptClientError):
    """A well-formed 2xx body that is not a complete answer.

    reason is "max_tokens", "refusal", "unexpected_stop" or "empty". Not retried:
    a cut answer is cut again at the same limit, and a refusal must not be
    routed around.
    """

    def __init__(self, message: str, reason: str, provider: str | None = None,
                 usage: dict | None = None):
        super().__init__(message, provider)
        self.reason = reason
        # What the provider billed for the call: a cut answer is billed in full.
        self.usage = usage


# max_tokens sent when the prompt has no @max_tokens; the Messages API requires one.
DEFAULT_MAX_TOKENS = 1024


def _require_api_key(api_key: object, client: str, env_var: str) -> str:
    if not isinstance(api_key, str) or api_key.strip() == "":
        raise ValueError(f"{client}: api_key is empty. Pass a key, e.g. from os.environ['{env_var}'].")
    return api_key


def _raise_for_status(response: Any, provider: str, api_key: str) -> None:
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
    # The message quotes the provider's body, which reaches logs; a provider or a
    # proxy that echoes the key must not leak it there.
    if isinstance(message, str):
        message = message.replace(api_key, "[redacted]")
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


def _require_complete_answer(provider: str, stop: str, decided_by: str, text: str,
                             max_tokens: int | None, usage: dict) -> None:
    # stop is "complete", "max_tokens", "refusal" or "unexpected_stop". decided_by
    # comes from the provider, so it is capped; the model's text never enters the
    # message: it is untrusted and may be long.
    quoted = f"\`{decided_by[:64]}\`"
    if stop == "max_tokens":
        limit = "the provider default" if max_tokens is None else f"max_tokens {max_tokens}"
        raise IncompleteResponseError(
            f"{provider} stopped at the output limit ({limit}) before finishing the answer; raise @max_tokens on the prompt",
            "max_tokens", provider, usage)
    if stop == "refusal":
        raise IncompleteResponseError(f"{provider} refused to answer ({quoted})", "refusal", provider, usage)
    if stop == "unexpected_stop":
        raise IncompleteResponseError(
            f"{provider} stopped with {quoted} before giving a final answer", "unexpected_stop", provider, usage)
    if text.strip() == "":
        raise IncompleteResponseError(f"{provider} returned no text", "empty", provider, usage)


def _anthropic_stop(raw: str) -> str:
    # A body with no stop_reason (some proxies drop it) is judged by its text alone.
    if raw in ("", "end_turn", "stop_sequence"):
        return "complete"
    if raw == "max_tokens":
        return "max_tokens"
    if raw == "refusal":
        return "refusal"
    return "unexpected_stop"


def _openai_stop(raw: str) -> str:
    if raw in ("", "stop"):
        return "complete"
    if raw == "length":
        return "max_tokens"
    if raw == "content_filter":
        return "refusal"
    return "unexpected_stop"


def _invalid_field(provider: str, field: str) -> NoReturn:
    raise InvalidResponseError(
        f"{provider} response has an unexpected shape: \`{field}\` is missing or has the wrong type",
        provider,
    )


def _is_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# ---- Output checking (same rules and messages as the TypeScript runtime) ----

class InvalidOutputError(ValueError):
    """The model's answer does not match the prompt's declared output type.

    A ValueError, which generated code raised for a bad answer before this class
    existed. The message names the mismatches and never quotes the answer: model
    output is untrusted, may hold user data, and messages reach logs. The answer
    is on \`output\`.
    """

    def __init__(self, prompt: str, errors: list[str], output: str):
        super().__init__(f"output of prompt '{prompt}' does not match its type: " + "; ".join(errors))
        self.prompt = prompt
        self.errors = errors
        self.output = output


_ISO_DATE = re.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}")
_DECIMAL = re.compile("[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?")
_FENCED = re.compile(chr(96) * 3 + "[A-Za-z0-9_-]*\\r?\\n(.*)\\r?\\n" + chr(96) * 3, re.DOTALL)
_MAX_ERRORS = 10
_MAX_ERROR_LENGTH = 500
_TOO_DEEP = "output: nested too deeply to check"


def _describe(value: object) -> str:
    """What a value is, never the value itself (see InvalidOutputError)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "a boolean"
    if isinstance(value, (int, float)):
        return "a number"
    if isinstance(value, str):
        return "a string"
    if isinstance(value, list):
        return "an array"
    if isinstance(value, dict):
        return "an object"
    return "a " + type(value).__name__


def _is_date(value: object) -> bool:
    if not isinstance(value, str) or not _ISO_DATE.fullmatch(value):
        return False
    try:
        _date.fromisoformat(value)
    except ValueError:
        return False
    return True


def output_errors(value: object, schema: dict, defs: dict, path: str = "output") -> list[str]:
    """Every way \`value\` fails to conform, as "path: problem" strings; empty when it does.

    Structs are closed: a field the type does not declare is a mismatch.
    """
    kind = schema["kind"]
    if kind == "date":
        return [] if _is_date(value) else [f"{path}: expected a YYYY-MM-DD date, got {_describe(value)}"]
    if kind == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return [f"{path}: expected number, got {_describe(value)}"]
        # TypeScript reads 1e400 or a 400-digit integer as Infinity; refuse both here too.
        try:
            finite = math.isfinite(float(value))
        except OverflowError:
            finite = False
        return [] if finite else [f"{path}: expected a finite number, got a non-finite number"]
    if kind in ("string", "boolean"):
        ok = isinstance(value, str if kind == "string" else bool)
        return [] if ok else [f"{path}: expected {kind}, got {_describe(value)}"]
    if kind == "enum":
        if isinstance(value, str) and value in schema["values"]:
            return []
        return [f"{path}: expected one of {', '.join(schema['values'])}, got {_describe(value)}"]
    if kind == "struct":
        if not isinstance(value, dict):
            return [f"{path}: expected an object, got {_describe(value)}"]
        fields = schema["fields"]
        errors: list[str] = []
        for name, field in fields.items():
            if name in value:
                errors.extend(output_errors(value[name], field["type"], defs, f"{path}.{name}"))
            elif not field["optional"]:
                errors.append(f"{path}.{name}: missing required field")
        # Counted, not named: a field name comes from the model and could forge or flood a log line.
        extra = sum(1 for key in value if key not in fields)
        if extra:
            errors.append(f"{path}: {extra} field{'' if extra == 1 else 's'} not in the declared type")
        return errors
    if kind == "ref":
        target = defs.get(schema["name"])
        if target is None:
            return [f"{path}: type '{schema['name']}' is not declared in this file, cannot check it"]
        return output_errors(value, target, defs, path)
    if kind == "unchecked":
        return []
    raise ValueError(f"unknown output schema kind {kind!r}")


def _resolve(schema: dict, defs: dict) -> dict:
    seen: set[str] = set()
    while schema["kind"] == "ref" and schema["name"] not in seen and schema["name"] in defs:
        seen.add(schema["name"])
        schema = defs[schema["name"]]
    return schema


def _read_int(text: str) -> int | float:
    # json.loads refuses integers over 4300 digits (int_max_str_digits); as a float
    # such an integer is infinite, which output_errors refuses as TypeScript does.
    return int(text) if len(text) <= 4000 else float(text)


def _no_constant(name: str) -> NoReturn:
    # JSON has no NaN or Infinity, but json.loads accepts them unless refused here.
    raise ValueError(f"{name} is not JSON")


def parse_output(prompt: str, raw: str, spec: dict) -> Any:
    """Reads the model's (stripped) text as the declared output type, then checks it.

    Text as is; numbers and booleans from their spelling; structs as JSON, one
    surrounding code fence allowed. Raises InvalidOutputError when the answer
    does not conform.
    """
    defs = spec["defs"]
    root = _resolve(spec["root"], defs)
    value: Any = raw
    if root["kind"] == "number":
        # An answer that is not a number stays text, so the error says what it got.
        if _DECIMAL.fullmatch(raw) and math.isfinite(float(raw)):
            value = float(raw)
    elif root["kind"] == "boolean":
        lower = raw.lower()
        value = True if lower == "true" else False if lower == "false" else raw
    elif root["kind"] == "struct":
        fenced = _FENCED.fullmatch(raw)
        try:
            value = json.loads(fenced.group(1) if fenced else raw, parse_constant=_no_constant, parse_int=_read_int)
        except ValueError:
            raise InvalidOutputError(prompt, ["output: not valid JSON"], raw) from None
        except RecursionError:
            raise InvalidOutputError(prompt, [_TOO_DEEP], raw) from None
    try:
        errors = output_errors(value, root, defs)
    except RecursionError:
        # A recursive type lets a hostile answer nest deeper than the call stack;
        # that answer is rejected like any other, not surfaced as a crash.
        errors = [_TOO_DEEP]
    if errors:
        raise InvalidOutputError(prompt, _bounded(errors), raw)
    return value


def _bounded(errors: list[str]) -> list[str]:
    """At most _MAX_ERRORS errors of at most _MAX_ERROR_LENGTH characters, as in TypeScript."""
    shown = [e if len(e) <= _MAX_ERROR_LENGTH else e[:250] + "\u2026" + e[-249:] for e in errors[:_MAX_ERRORS]]
    rest = len(errors) - len(shown)
    return shown + [f"output: {rest} more mismatches"] if rest > 0 else shown


# ---- Client interface ----

_TICK = chr(96)
_FENCE_RUN = re.compile(_TICK + "{3,}")
_FENCE_START = re.compile(r"\\A" + _TICK + "+")
_TAG_WS = r"[ \\t\\n\\v\\f\\r]"
_EOL = re.compile(r"(\\r\\n|[\\n\\r\\u2028\\u2029])")
_DASH_LINE = re.compile(r"[ \\t]*(?:-[ \\t]*){3,}")
_DASH_EDGE = re.compile(r"[ \\t]*(?:-[ \\t]*)+")


def _spaced(m: "re.Match[str]") -> str:
    return " ".join(m.group(0))


def _neutralize_tag(value: str, name: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.:-]*", name, flags=re.ASCII):
        raise ValueError("neutralizeDelimiters: invalid tag name " + json.dumps(name, ensure_ascii=False))
    prefixes = ""
    for ch in reversed(name):
        prefixes = "(?:" + re.escape(ch) + prefixes + ")?"
    pattern = (
        "<(?=" + _TAG_WS + "*(?:/" + _TAG_WS + "*)?(?:" + re.escape(name)
        + r"(?![A-Za-z0-9_.:-])|" + prefixes + r"\\Z))"
    )
    return re.sub(pattern, "&lt;", value, flags=re.IGNORECASE | re.ASCII)


def _neutralize_dashes(value: str) -> str:
    parts = _EOL.split(value)
    last = len(parts) - 1
    for i in range(0, last + 1, 2):
        line = parts[i]
        edge = i == 0 or i == last
        if _DASH_LINE.fullmatch(line) or (edge and _DASH_EDGE.fullmatch(line)):
            parts[i] = line.replace("-", chr(92) + "-", 1)
    return "".join(parts)


def neutralize_delimiters(value: str, delimiters: tuple[str, ...]) -> str:
    """The rewrite of neutralizeDelimiters in the TypeScript runtime, byte for byte.

    A value inserted between delimiters cannot close or reopen them, alone or next
    to another value; the README gives the exact rewrite. The patterns are ASCII
    only (re.ASCII): whitespace classes and Unicode case folding differ between
    Python and JavaScript.
    """
    out = value
    for d in delimiters:
        if d.startswith("tag:"):
            out = _neutralize_tag(out, d[4:])
        elif d == "brackets":
            out = re.sub(r"\\[(?=\\[)", "[ ", out)
            out = re.sub(r"\\](?=\\])", "] ", out)
            out = re.sub(r"\\A[\\[\\]]", lambda m: " " + m.group(0), out)
            out = re.sub(r"[\\[\\]]\\Z", lambda m: m.group(0) + " ", out)
        elif d == "fence":
            out = _FENCE_RUN.sub(_spaced, out)
            out = _FENCE_START.sub(lambda m: " " + _spaced(m), out)
            end = len(out.rstrip(_TICK))
            if end < len(out):
                out = out[:end] + " ".join(out[end:]) + " "
        elif d == "dashes":
            out = _neutralize_dashes(out)
        else:
            raise ValueError("neutralizeDelimiters: unknown delimiter " + json.dumps(d, ensure_ascii=False))
    return out


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
            "max_tokens": request.get("max_tokens", DEFAULT_MAX_TOKENS),
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
        _raise_for_status(response, "anthropic", self.api_key)
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
        counts = {"input_tokens": usage["input_tokens"], "output_tokens": usage["output_tokens"]}
        raw = data.get("stop_reason") if isinstance(data.get("stop_reason"), str) else ""
        _require_complete_answer("anthropic", _anthropic_stop(raw), raw, content,
                                 request.get("max_tokens", DEFAULT_MAX_TOKENS), counts)
        return {"content": content, "usage": counts}


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
            # GPT-5 and the o-series refuse max_tokens; OpenAI marks it deprecated for this one.
            payload["max_completion_tokens"] = request["max_tokens"]

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
        _raise_for_status(response, "openai", self.api_key)
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
        content = content or ""
        counts = {"input_tokens": usage["prompt_tokens"], "output_tokens": usage["completion_tokens"]}
        refusal = choice["message"].get("refusal")
        if isinstance(refusal, str) and refusal:
            # A refusal can arrive in its own field with finish_reason "stop".
            _require_complete_answer("openai", "refusal", "message.refusal", content, request.get("max_tokens"), counts)
        finish = choice.get("finish_reason")
        raw = finish if isinstance(finish, str) else ""
        _require_complete_answer("openai", _openai_stop(raw), raw, content, request.get("max_tokens"), counts)
        return {"content": content, "usage": counts}
`;

/** Returns the autonomous Python runtime source to be written alongside compiled files. */
export function getPythonRuntimeSource(): string {
  return PYTHON_RUNTIME_SOURCE;
}
