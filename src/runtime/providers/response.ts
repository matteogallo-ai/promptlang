import { InvalidResponseError } from "../errors";

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
