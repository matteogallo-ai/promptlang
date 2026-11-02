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
