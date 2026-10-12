/**
 * AiApi factory (T-031): the RPC-backed assistant operations shared by the
 * dashboard controller and the editor-session test stacks.
 */

import type { ApiClient } from './client';
import type { AgentTurnResult } from '../../background/ai/agent';

export interface AiApi {
  chat(input: {
    messages: { role: 'user' | 'assistant'; content: string }[];
    approvedToolCallIds?: string[];
  }): Promise<AgentTurnResult>;
  isEnabled(): Promise<boolean>;
}

export function createAiApi(client: ApiClient): AiApi {
  return {
    async chat(input) {
      return (await client.request('ai/chat', input)).result;
    },
    async isEnabled() {
      const { settings } = await client.request('settings/get', {});
      return settings.ai.enabled;
    },
  };
}
