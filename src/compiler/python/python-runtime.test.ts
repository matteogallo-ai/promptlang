import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPythonRuntimeSource } from "./python-runtime-template";

/**
 * Runs promptlang_runtime.py under python3 against a fake `httpx` module (the
 * runtime imports httpx lazily), so no network and no pip install are needed.
 */
const FAKE_HTTPX = `
import json as _json
NEXT = []
SENT = []

class Response:
    def __init__(self, status_code, text):
        self.status_code = status_code
        self.text = text
    def json(self):
        return _json.loads(self.text)

class AsyncClient:
    async def __aenter__(self):
        return self
    async def __aexit__(self, *exc):
        return False
    async def post(self, url, json=None, headers=None, timeout=None):
        SENT.append({"url": url, "json": json, "headers": headers})
        status, text = NEXT.pop(0)
        return Response(status, text)
`;

const SCENARIOS = `
import asyncio, json, sys
import httpx
import promptlang_runtime as rt

REQ = {"model": "m", "temperature": 0.2, "max_tokens": 64,
       "messages": [{"role": "system", "content": "S"}, {"role": "user", "content": "Hi"}]}
ANTHROPIC_OK = json.dumps({"content": [{"type": "text", "text": "ok"}],
                           "usage": {"input_tokens": 3, "output_tokens": 1}})
OPENAI_OK = json.dumps({"choices": [{"message": {"content": "ok"}}],
                        "usage": {"prompt_tokens": 3, "completion_tokens": 1}})

def outcome(make, status, text):
    httpx.NEXT[:] = [(status, text)]
    try:
        res = asyncio.run(make().complete(REQ))
        return {"ok": res}
    except rt.PromptClientError as e:
        return {"error": type(e).__name__, "message": str(e)}

def key_error(cls, key):
    try:
        cls(key)
        return None
    except ValueError as e:
        return str(e)

anthropic = lambda: rt.AnthropicClient("sk-test")
openai = lambda: rt.OpenAIClient("sk-test")
out = {
    "empty_keys": [key_error(rt.AnthropicClient, ""), key_error(rt.AnthropicClient, "  "),
                   key_error(rt.OpenAIClient, "")],
    "anthropic_ok": outcome(anthropic, 200, ANTHROPIC_OK),
    "anthropic_sent": httpx.SENT[-1],
    "anthropic_not_json": outcome(anthropic, 200, "<html>"),
    "anthropic_no_content": outcome(anthropic, 200, json.dumps({"usage": {"input_tokens": 1, "output_tokens": 1}})),
    "anthropic_no_usage": outcome(anthropic, 200, json.dumps({"content": []})),
    "anthropic_401": outcome(anthropic, 401, json.dumps({"error": {"message": "bad key"}})),
    "anthropic_429": outcome(anthropic, 429, "rate limited"),
    "anthropic_400": outcome(anthropic, 400, json.dumps({"error": {"message": "bad request"}})),
    "anthropic_529": outcome(anthropic, 529, "{}"),
    "openai_ok": outcome(openai, 200, OPENAI_OK),
    "openai_no_choices": outcome(openai, 200, json.dumps({"usage": {"prompt_tokens": 1, "completion_tokens": 1}})),
    "openai_null_content": outcome(openai, 200, json.dumps({"choices": [{"message": {"content": None}}],
                                                            "usage": {"prompt_tokens": 1, "completion_tokens": 1}})),
}
json.dump(out, sys.stdout)
`;

let dir: string;
let results: Record<string, unknown>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "promptlang-pyrt-"));
  await writeFile(join(dir, "promptlang_runtime.py"), getPythonRuntimeSource());
  await writeFile(join(dir, "httpx.py"), FAKE_HTTPX);
  await writeFile(join(dir, "scenarios.py"), SCENARIOS);
  const r = Bun.spawnSync(["python3", "scenarios.py"], { cwd: dir });
  if (r.exitCode !== 0) throw new Error(`python3 failed:\n${r.stderr.toString()}`);
  results = JSON.parse(r.stdout.toString());
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Python runtime guards", () => {
  test("an empty or blank API key is refused before any request", () => {
    expect(results.empty_keys).toEqual([
      "AnthropicClient: api_key is empty. Pass a key, e.g. from os.environ['ANTHROPIC_API_KEY'].",
      "AnthropicClient: api_key is empty. Pass a key, e.g. from os.environ['ANTHROPIC_API_KEY'].",
      "OpenAIClient: api_key is empty. Pass a key, e.g. from os.environ['OPENAI_API_KEY'].",
    ]);
  });

  test("Anthropic: sends version 2026-10-21 and no temperature", () => {
    expect(results.anthropic_ok).toEqual({
      ok: { content: "ok", usage: { input_tokens: 3, output_tokens: 1 } },
    });
    expect(results.anthropic_sent).toEqual({
      url: "https://api.anthropic.com/v1/messages",
      json: {
        model: "m",
        max_tokens: 64,
        system: "S",
        messages: [{ role: "user", content: "Hi" }],
      },
      headers: {
        "x-api-key": "sk-test",
        "anthropic-version": "2026-10-21",
        "content-type": "application/json",
      },
    });
  });

  test("Anthropic: a malformed 2xx body raises InvalidResponseError naming the field", () => {
    expect(results.anthropic_not_json).toEqual({
      error: "InvalidResponseError",
      message: "anthropic returned a non-JSON response body",
    });
    expect(results.anthropic_no_content).toMatchObject({
      error: "InvalidResponseError",
      message:
        "anthropic response has an unexpected shape: `content` is missing or has the wrong type",
    });
    expect(results.anthropic_no_usage).toMatchObject({
      error: "InvalidResponseError",
      message:
        "anthropic response has an unexpected shape: `usage` is missing or has the wrong type",
    });
  });

  test("Anthropic: HTTP errors map to the same typed errors as TypeScript", () => {
    expect(results.anthropic_401).toEqual({ error: "AuthenticationError", message: "bad key" });
    expect(results.anthropic_429).toMatchObject({ error: "RateLimitError" });
    expect(results.anthropic_400).toEqual({ error: "InvalidRequestError", message: "bad request" });
    expect(results.anthropic_529).toMatchObject({ error: "ServerError" });
  });

  test("OpenAI: missing choices is InvalidResponseError; null content reads as empty", () => {
    expect(results.openai_ok).toEqual({
      ok: { content: "ok", usage: { input_tokens: 3, output_tokens: 1 } },
    });
    expect(results.openai_no_choices).toMatchObject({
      error: "InvalidResponseError",
      message:
        "openai response has an unexpected shape: `choices[0].message` is missing or has the wrong type",
    });
    expect(results.openai_null_content).toEqual({
      ok: { content: "", usage: { input_tokens: 1, output_tokens: 1 } },
    });
  });
});
