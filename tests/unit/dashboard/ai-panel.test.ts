// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAiPanel, presetPrompts } from '../../../src/dashboard/ai/ai-panel';
import type { AgentTurnResult } from '../../../src/background/ai/agent';
import type { EntityId } from '../../../src/core/types';

/**
 * T-031 AI panel UI (FR-AI-04/07): presets, bounded conversation,
 * per-tool-call status chips, the approval flow (approve re-invokes with
 * the approved id; deny cancels without execution) and the honest
 * disabled state.
 */

let root: HTMLElement;
let closedCount = 0;

beforeEach(() => {
  closedCount = 0;
});

const NOTE_ID = 'note-0001' as EntityId;

function turn(overrides: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    reply: '',
    toolCalls: [],
    error: null,
    model: 'fake-model',
    ...overrides,
  };
}

interface ChatInput {
  messages: { role: 'user' | 'assistant'; content: string }[];
  approvedToolCallIds?: string[];
}

interface Harness {
  /** Replace the chat implementation the panel calls. */
  setChat(impl: (input: ChatInput) => Promise<AgentTurnResult>): void;
  calls: { messages: unknown; approvedToolCallIds?: string[] }[];
  enabled: boolean;
  announced: string[];
  panel: ReturnType<typeof createAiPanel>;
}

function mountPanel(enabled = true, noteId: EntityId | null = null): Harness {
  const calls: { messages: unknown; approvedToolCallIds?: string[] }[] = [];
  const announced: string[] = [];
  let isEnabled = enabled;
  let impl: (_input: ChatInput) => Promise<AgentTurnResult> = async () => turn();
  const panel = createAiPanel(
    {
      chat: (input) => {
        calls.push({ messages: input.messages, approvedToolCallIds: input.approvedToolCallIds });
        return impl(input);
      },
      isEnabled: async () => isEnabled,
      announce: (message) => announced.push(message),
      onClose: () => closedCount++,
    },
    noteId,
  );
  root.append(panel.element);
  return {
    setChat: (replacement) => {
      impl = replacement;
    },
    calls,
    get enabled() { return isEnabled; },
    set enabled(value: boolean) { isEnabled = value; },
    announced,
    panel,
  };
}

async function flush(millis = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await flush(10);
  }
}

function send(panel: ReturnType<typeof createAiPanel>, text: string): void {
  const input = panel.element.querySelector('.ai-panel__input') as HTMLTextAreaElement;
  input.value = text;
  const sendButton = Array.from(panel.element.querySelectorAll('button')).find(
    (button) => button.textContent === 'Send',
  ) as HTMLButtonElement;
  sendButton.click();
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  root.remove();
});

describe('AI panel', () => {
  it('carries an in-surface Close control that invokes onClose (UX-04)', () => {
    const harness = mountPanel();
    const close = harness.panel.element.querySelector('.panel-header__close') as HTMLButtonElement;
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label')).toBe('Close the AI assistant');
    close.click();
    expect(closedCount).toBe(1);
  });

  it('shows presets: search everywhere, note tasks only with a note id', () => {
    const generic = presetPrompts(null);
    expect(generic.length).toBe(1);
    expect(generic[0]?.label).toBe('Search notes');

    const editor = presetPrompts(NOTE_ID);
    expect(editor.map((preset) => preset.label)).toEqual([
      'Search notes',
      'Summarize this note',
      'Extract action items',
      'Propose tags',
    ]);
    expect(editor[1]?.prompt).toContain(String(NOTE_ID));
  });

  it('sends the conversation and renders the assistant reply', async () => {
    const harness = mountPanel(true);
    harness.setChat(async () => turn({ reply: 'Here is your summary.' }));
    send(harness.panel, 'Summarize my note');

    await waitFor(
      () => harness.panel.element.textContent?.includes('Here is your summary.') === true,
    );
    expect(harness.calls.length).toBe(1);
    expect(harness.calls[0]?.messages).toEqual([
      { role: 'user', content: 'Summarize my note' },
    ]);
  });

  it('renders tool-call status chips and approval actions', async () => {
    const harness = mountPanel(true);
    const pendingCall = {
      id: 'c1',
      name: 'create_note',
      risk: 'write' as const,
      argumentsPreview: '{"title":"AI draft"}',
      status: 'awaiting-approval' as const,
      result: null,
      error: null,
      approvalReason: 'ask-before-write mode — "create_note" needs your approval',
    };
    harness.setChat(async () => turn({ toolCalls: [pendingCall] }));
    send(harness.panel, 'Create a note called AI draft');

    await waitFor(
      () => harness.panel.element.querySelector('.ai-panel__toolcall--pending') !== null,
    );
    expect(harness.panel.element.textContent).toContain('needs your approval');
    expect(harness.panel.element.textContent).toContain('nothing is applied until you approve');
    expect(harness.panel.element.textContent).toContain('AI draft');
    // The disclosure paragraph renders the honest MCP limitation.
    expect(harness.panel.element.textContent).toContain('Model Context Protocol');
  });

  it('approving re-invokes the turn with exactly that tool-call id', async () => {
    const harness = mountPanel(true);
    let turnCount = 0;
    harness.setChat(async (_input) => {
      turnCount += 1;
      if (turnCount === 1) {
        return turn({
          toolCalls: [
            {
              id: 'c1',
              name: 'create_note',
              risk: 'write',
              argumentsPreview: '{"title":"x"}',
              status: 'awaiting-approval',
              result: null,
              error: null,
              approvalReason: 'needs approval',
            },
          ],
        });
      }
      return turn({
        toolCalls: [
          {
            id: 'c1',
            name: 'create_note',
            risk: 'write',
            argumentsPreview: '{"title":"x"}',
            status: 'succeeded',
            result: { id: 'note-9' },
            error: null,
            approvalReason: null,
          },
        ],
        reply: 'The note was created.',
      });
    });
    send(harness.panel, 'Create a note');

    await waitFor(() => harness.panel.element.querySelector('.ai-panel__toolcall--pending') !== null);
    const approve = Array.from(harness.panel.element.querySelectorAll('button')).find(
      (button) => button.textContent === 'Approve once',
    ) as HTMLButtonElement;
    approve.click();

    await waitFor(() => harness.calls.length === 2);
    expect(harness.calls[1]?.approvedToolCallIds).toEqual(['c1']);
    // The conversation history is preserved on the approval turn.
    expect(harness.calls[1]?.messages).toEqual([{ role: 'user', content: 'Create a note' }]);
    await waitFor(
      () => harness.panel.element.textContent?.includes('The note was created.') === true,
    );
    expect(harness.announced.join(' ')).toContain('Approved create_note');
  });

  it('denying cancels the proposal without executing it', async () => {
    const harness = mountPanel(true);
    harness.setChat(async () =>
      turn({
        toolCalls: [
          {
            id: 'c1',
            name: 'trash_note',
            risk: 'destructive',
            argumentsPreview: '{"noteId":"n"}',
            status: 'awaiting-approval',
            result: null,
            error: null,
            approvalReason: 'destructive — needs approval',
          },
        ],
      }));
    send(harness.panel, 'Trash my note');

    await waitFor(() => harness.panel.element.querySelector('.ai-panel__toolcall--pending') !== null);
    const deny = Array.from(harness.panel.element.querySelectorAll('button')).find(
      (button) => button.textContent === 'Deny',
    ) as HTMLButtonElement;
    deny.click();
    await flush();

    expect(harness.calls.length).toBe(1); // never re-invoked
    expect(harness.panel.element.textContent).toContain('canceled');
    expect(harness.announced.join(' ')).toContain('Denied the proposed trash_note');
  });

  it('surfaces model errors truthfully', async () => {
    const harness = mountPanel(true);
    harness.setChat(async () =>
      turn({ error: { code: 'limit', message: 'the conversation exceeded 6 tool rounds' } }));
    send(harness.panel, 'loop forever');
    await waitFor(
      () => harness.panel.element.textContent?.includes('exceeded 6 tool rounds') === true,
    );
  });

  it('surfaces chat failures truthfully', async () => {
    const harness = mountPanel(true);
    harness.setChat(async () => {
      throw new Error('LM Studio is unreachable (ECONNREFUSED)');
    });
    send(harness.panel, 'hello');
    await waitFor(
      () => harness.panel.element.textContent?.includes('AI request failed') === true,
    );
    expect(harness.panel.element.textContent).toContain('unreachable');
  });

  it('shows the honest disabled state without inputs (FR-AI-10)', async () => {
    const harness = mountPanel(false);
    await waitFor(() => harness.panel.element.textContent?.includes('turned off') === true);
    const input = harness.panel.element.querySelector('.ai-panel__input') as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    const sendButton = Array.from(harness.panel.element.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send',
    ) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    expect(harness.panel.element.textContent).toContain('keep working without AI');
    expect(harness.calls.length).toBe(0);
  });

  it('carries the disclosure text (internal tools, not MCP)', () => {
    const harness = mountPanel(true);
    const text = harness.panel.element.textContent ?? '';
    expect(text).toContain('LM Studio');
    expect(text).toContain('not the Model Context Protocol');
    expect(text).toContain('no server is bound');
    expect(text).toContain('external MCP clients cannot call these tools');
    expect(text).toContain('only after you approve');
    // FR-MCP-03: never a fake server-connection status.
    expect(text).not.toContain('MCP server connected');
  });
});
