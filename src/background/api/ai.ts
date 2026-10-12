/**
 * AI API (T-029/T-031, FR-AI-01/02/03/10): LM Studio connection test,
 * model listing and the agent chat turn, executed ONLY in the service
 * worker over loopback. The optional baseUrl override lets the settings
 * screen probe a candidate URL before saving it; every URL passes the
 * loopback gate regardless of origin.
 *
 * Graceful degradation (FR-AI-10): these RPCs fail with truthful coded
 * errors when LM Studio is down; nothing else in the app is affected.
 * ai/chat additionally enforces the enabled gate ('disabled') and only
 * accepts user/assistant conversation roles from the panel.
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
import { getSettings } from '../../core/repo/settings';
import {
  createLmStudioClient,
  testLmStudioConnection,
  type ConnectionTestResult,
  type LmStudioModel,
} from '../ai/client';
import { asObject, asOptionalString, asString, asEnum } from './validate';
import { runAgentTurn, agentDependencies, type AgentTurnResult } from '../ai/agent';
import { PayloadValidationError } from '../protocol';

async function aiOptions(baseUrlOverride?: string): Promise<{ baseUrl: string; timeoutMs: number }> {
  const settings = await getSettings(await repo());
  return {
    baseUrl: baseUrlOverride ?? settings.ai.baseUrl,
    timeoutMs: settings.ai.timeoutMs,
  };
}

export function registerAiApi(router: MessageRouter): void {
  /** Connection test (FR-AI-03 settings screen): one /models round trip. */
  router.register('ai/test-connection', async (payload) => {
    const p = asObject(payload, 'ai/test-connection');
    const baseUrl = asOptionalString(p['baseUrl'], 'baseUrl') ?? undefined;
    const result: ConnectionTestResult = await testLmStudioConnection(await aiOptions(baseUrl));
    return { result };
  });

  /** Model listing for the selection dropdown (FR-AI-03). */
  router.register('ai/list-models', async (payload) => {
    const p = asObject(payload, 'ai/list-models');
    const baseUrl = asOptionalString(p['baseUrl'], 'baseUrl') ?? undefined;
    const client = createLmStudioClient(await aiOptions(baseUrl));
    const models: LmStudioModel[] = await client.listModels();
    return { models };
  });

  /**
   * One agent turn (T-031, FR-AI-04/06/07): the panel sends the visible
   * conversation (user/assistant roles only); write tools gated by the
   * permission mode return awaiting-approval records for the approval UI.
   */
  router.register('ai/chat', async (payload) => {
    const p = asObject(payload, 'ai/chat');
    const settings = await getSettings(await repo());
    if (!settings.ai.enabled) {
      throw new PayloadValidationError(
        'AI features are turned off — enable them in settings (FR-AI-10: everything else keeps working)',
      );
    }

    const MAX_MESSAGES = 20;
    const MAX_CONTENT = 20_000;
    const rawMessages = p['messages'];
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      throw new PayloadValidationError('messages: expected a non-empty array');
    }
    if (rawMessages.length > MAX_MESSAGES) {
      throw new PayloadValidationError(`messages: exceeds ${MAX_MESSAGES} entries`);
    }
    const messages = rawMessages.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new PayloadValidationError(`messages[${index}]: expected an object`);
      }
      const record = entry as Record<string, unknown>;
      const role = asEnum(record['role'], `messages[${index}].role`, ['user', 'assistant']);
      const content = asString(record['content'], `messages[${index}].content`, {
        maxLength: MAX_CONTENT,
      });
      // The panel CANNOT inject system/tool roles or tool_call structures.
      return { role, content };
    });

    const rawApproved = p['approvedToolCallIds'];
    let approvedToolCallIds: string[] | undefined;
    if (rawApproved !== undefined) {
      if (!Array.isArray(rawApproved) || rawApproved.some((id) => typeof id !== 'string')) {
        throw new PayloadValidationError('approvedToolCallIds: expected an array of ids');
      }
      approvedToolCallIds = rawApproved as string[];
    }

    const result: AgentTurnResult = await runAgentTurn(
      { messages, approvedToolCallIds },
      await agentDependencies(),
    );
    return { result };
  });
}
