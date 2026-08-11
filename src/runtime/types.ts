export interface PromptRequest {
  model: string;
  temperature?: number;
  max_tokens?: number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export interface PromptResponse {
  content: string;
  usage?: { input_tokens: number; output_tokens: number };
}
