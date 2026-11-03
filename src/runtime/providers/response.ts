import { IncompleteResponseError, InvalidResponseError } from "../errors";

/** How a provider says generation ended, mapped onto the cases a caller must not treat as an answer. */
export type StopKind = "complete" | "max_tokens" | "refusal" | "unexpected_stop";

/**
 * Throws IncompleteResponseError unless generation ended normally with some
 * non-blank text. `decidedBy` is the provider's stop value, or the field that
 * carried a refusal, quoted so it can be looked up; it comes from the provider,
 * so it is capped. The model's text never enters the message: it is untrusted
 * and may be long.
 */
export function requireCompleteAnswer(
  provider: string,
  stop: StopKind,
  decidedBy: string,
  text: string,
  maxTokens: number | undefined,
  usage: { input_tokens: number; output_tokens: number } | undefined
): void {
  const fail = (message: string, reason: IncompleteResponseError["reason"]): never => {
    throw new IncompleteResponseError(message, reason, provider, usage);
  };
  const quoted = `\`${decidedBy.slice(0, 64)}\``;
  if (stop === "max_tokens") {
    const limit = maxTokens === undefined ? "the provider default" : `max_tokens ${maxTokens}`;
    fail(
      `${provider} stopped at the output limit (${limit}) before finishing the answer; raise @max_tokens on the prompt`,
      "max_tokens"
    );
  }
  if (stop === "refusal") fail(`${provider} refused to answer (${quoted})`, "refusal");
  if (stop === "unexpected_stop")
    fail(`${provider} stopped with ${quoted} before giving a final answer`, "unexpected_stop");
  if (text.trim() === "") fail(`${provider} returned no text`, "empty");
}

/** Rejects missing, empty or whitespace API keys before any request is sent. */
export function requireApiKey(apiKey: unknown, client: string, envVar: string): string {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new TypeError(`${client}: apiKey is empty. Pass a key, e.g. from process.env.${envVar}.`);
  }
  return apiKey;
}

/** Parses a 2xx body as a JSON object, or throws InvalidResponseError. */
export async function readJsonObject(
  response: Response,
  provider: string
): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new InvalidResponseError(`${provider} returned a non-JSON response body`, provider);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new InvalidResponseError(
      `${provider} returned a JSON body that is not an object`,
      provider
    );
  }
  return data as Record<string, unknown>;
}

/** Throws InvalidResponseError naming the field whose shape was unexpected. */
export function invalidField(provider: string, field: string): never {
  throw new InvalidResponseError(
    `${provider} response has an unexpected shape: \`${field}\` is missing or has the wrong type`,
    provider
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Seconds to wait from a `Retry-After` header (delta-seconds or an HTTP-date,
 * RFC 9110 §10.2.3), or undefined when the header is absent or unreadable.
 */
export function parseRetryAfter(
  header: string | null,
  now: number = Date.now()
): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  if (Number.isNaN(date) || /^-/.test(value)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}
