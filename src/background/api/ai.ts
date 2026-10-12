/**
 * AI API (T-029, FR-AI-01/02/03/10): LM Studio connection test and model
 * listing, executed ONLY in the service worker over loopback. The optional
 * baseUrl override lets the settings screen probe a candidate URL before
 * saving it; every URL passes the loopback gate regardless of origin.
 *
 * Graceful degradation (FR-AI-10): these RPCs fail with truthful coded
 * errors when LM Studio is down; nothing else in the app is affected.
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
import { asObject, asOptionalString } from './validate';

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
}
