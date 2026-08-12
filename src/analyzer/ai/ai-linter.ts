import type { PromptClient, PromptRequest } from "../../runtime";
import { AnthropicClient } from "../../runtime/providers/anthropic-client";
import type { PromptDeclaration } from "../../ast/nodes";
import type { AnalysisContext, Issue } from "../analyzer";
import { AI_LINTER_SYSTEM_PROMPT, buildAnalysisUserMessage } from "./prompts/analysis-prompt";
import { parseAiResponse } from "./issue-parser";

/** Options for configuring the AiLinter. */
export interface AiLinterOptions {
  /** Inject a custom PromptClient (e.g. MockClient in tests). Skips ANTHROPIC_API_KEY check. */
  client?: PromptClient;
  /** Claude model to use. Defaults to "claude-haiku-4-5". */
  model?: string;
  /** Number of prompts to analyze concurrently. Defaults to 3. */
  concurrency?: number;
  /** Called after each batch completes. */
  onProgress?: (current: number, total: number) => void;
}

/**
 * AI-powered linter that sends each PromptDeclaration to Claude Haiku
 * for semantic analysis beyond what static rules can detect.
 */
export class AiLinter {
  private client: PromptClient;
  private model: string;
  private concurrency: number;
  private onProgress?: (current: number, total: number) => void;

  constructor(options: AiLinterOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "AI linter requires ANTHROPIC_API_KEY environment variable. " +
            "Set it or pass a custom PromptClient via options."
        );
      }
      this.client = new AnthropicClient({ apiKey });
    }
    this.model = options.model ?? "claude-haiku-4-5";
    this.concurrency = options.concurrency ?? 3;
    this.onProgress = options.onProgress;
  }

  /** Analyzes all PromptDeclarations found across the given contexts. */
  async analyze(contexts: AnalysisContext[]): Promise<Issue[]> {
    const prompts: Array<{ prompt: PromptDeclaration; file: string }> = [];
    for (const ctx of contexts) {
      for (const decl of ctx.ast.declarations) {
        if (decl.kind === "PromptDeclaration") {
          prompts.push({ prompt: decl, file: ctx.file });
        }
      }
    }

    if (prompts.length === 0) return [];

    const issues: Issue[] = [];
    for (let i = 0; i < prompts.length; i += this.concurrency) {
      const batch = prompts.slice(i, i + this.concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(({ prompt, file }) => this.analyzePrompt(prompt, file))
      );
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          issues.push(...result.value);
        }
      }
      if (this.onProgress) {
        this.onProgress(Math.min(i + batch.length, prompts.length), prompts.length);
      }
    }

    return issues;
  }

  private async analyzePrompt(prompt: PromptDeclaration, file: string): Promise<Issue[]> {
    const request: PromptRequest = {
      model: this.model,
      max_tokens: 1024,
      temperature: 0.1,
      messages: [
        { role: "system", content: AI_LINTER_SYSTEM_PROMPT },
        { role: "user", content: buildAnalysisUserMessage(prompt) },
      ],
    };

    const response = await this.client.complete(request);
    return parseAiResponse(response.content, prompt, file);
  }
}
