import type { PromptClient } from "../runtime/client";
import { AnthropicClient } from "../runtime/providers/anthropic-client";
import { UsageError } from "./usage-error";

/**
 * The client for a paid run (`test --live`, `analyze --ai`). No retries: the
 * approved estimate counts each call once. `flag` names the option in errors.
 */
export function createLiveClient(
  flag: string,
  env: Record<string, string | undefined> = process.env
): PromptClient {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new UsageError(`${flag} needs ANTHROPIC_API_KEY in the environment`);
  return new AnthropicClient({ apiKey, maxRetries: 0 });
}

/** Asks on the terminal whether to spend; true to proceed. */
export function confirmInTerminal(flag: string, question: string): boolean {
  // Without a terminal there is nobody to answer; --yes is the explicit approval.
  if (!process.stdin.isTTY)
    throw new UsageError(`${flag} without a terminal needs --yes to approve the cost`);
  return (prompt(question) ?? "").trim().toLowerCase() === "y";
}
