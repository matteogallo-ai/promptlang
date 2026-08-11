import type { PromptRequest, PromptResponse } from "./types";

export type { PromptRequest, PromptResponse };

export interface PromptClient {
  complete(request: PromptRequest): Promise<PromptResponse>;
}

export class MockClient implements PromptClient {
  private responses: PromptResponse[] | ((req: PromptRequest) => PromptResponse);

  constructor(responses: PromptResponse[] | ((req: PromptRequest) => PromptResponse)) {
    this.responses = responses;
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    if (typeof this.responses === "function") {
      return this.responses(request);
    }
    const response = this.responses.shift();
    if (!response) throw new Error("MockClient: no more responses queued");
    return response;
  }
}
