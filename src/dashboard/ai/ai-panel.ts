/**
 * AI panel (T-031, FR-AI-04/07): the assistant surface for the dashboard
 * and the note editor. Preset tasks, a bounded conversation, per-tool-call
 * status (proposed/awaiting-approval/running/succeeded/failed/canceled) and
 * the approval UI for permission-gated operations.
 *
 * Visible marking (FR-AI-04): AI proposals are labelled "AI-generated —
 * nothing is applied until you approve" — a proposal becomes data only
 * after the explicit approval executes it.
 */

import type { EntityId } from '../../core/types';
import type { AgentTurnResult } from '../../background/ai/agent';

export interface AiPanelCallbacks {
  /** One agent turn over ai/chat. Approved ids continue a pending turn. */
  chat(input: {
    messages: { role: 'user' | 'assistant'; content: string }[];
    approvedToolCallIds?: string[];
  }): Promise<AgentTurnResult>;
  /** Whether AI is enabled (honest off state, FR-AI-10). */
  isEnabled(): Promise<boolean>;
  announce(message: string): void;
}

export interface AiPanel {
  readonly element: HTMLElement;
  dispose(): void;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  proposed: 'proposed',
  'awaiting-approval': 'needs your approval',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  canceled: 'canceled',
};

/** Editor-context presets (FR-AI-04); generic search works everywhere. */
export function presetPrompts(noteId: EntityId | null): readonly { label: string; prompt: string }[] {
  const presets: { label: string; prompt: string }[] = [
    { label: 'Search notes', prompt: 'Search my notes for ' },
  ];
  if (noteId !== null) {
    presets.push(
      {
        label: 'Summarize this note',
        prompt: `Read note ${noteId} with get_note and summarize it in three sentences.`,
      },
      {
        label: 'Extract action items',
        prompt: `Read note ${noteId} with get_note and list any action items it contains.`,
      },
      {
        label: 'Propose tags',
        prompt: `Read note ${noteId} with get_note, then propose up to five short tags for it. Create them with manage_tags only if I approve.`,
      },
    );
  }
  return presets;
}

export function createAiPanel(callbacks: AiPanelCallbacks, noteId: EntityId | null): AiPanel {
  const element = document.createElement('section');
  element.className = 'ai-panel';
  element.setAttribute('aria-label', 'AI assistant');

  const heading = document.createElement('h2');
  heading.className = 'ai-panel__heading';
  heading.textContent = 'AI assistant (local LM Studio)';

  const disclosure = document.createElement('p');
  disclosure.className = 'ai-panel__disclosure';
  disclosure.textContent =
    'Runs entirely on your machine through LM Studio — nothing is sent to any cloud service. This is an internal tool contract, not an MCP server. AI proposals apply only after you approve them.';

  const status = document.createElement('p');
  status.className = 'ai-panel__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const conversation = document.createElement('div');
  conversation.className = 'ai-panel__conversation';

  const presets = document.createElement('div');
  presets.className = 'ai-panel__presets';
  for (const preset of presetPrompts(noteId)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      input.value = preset.prompt;
      input.focus();
    });
    presets.append(button);
  }

  const input = document.createElement('textarea');
  input.className = 'ai-panel__input';
  input.rows = 3;
  input.placeholder = 'Ask the local model… (Ctrl+Enter to send)';
  input.setAttribute('aria-label', 'Message to the local AI model');

  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.className = 'btn btn--primary';
  sendButton.textContent = 'Send';

  const setBusy = (value: boolean): void => {
    sendButton.disabled = value;
    sendButton.textContent = value ? 'Working…' : 'Send';
  };

  function setStatus(message: string, isError: boolean): void {
    status.textContent = message;
    status.hidden = message.length === 0;
    status.classList.toggle('ai-panel__status--error', isError);
  }

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let pendingApprovals = new Map<string, string>();
  let lastUserMessage = '';

  function bubble(role: 'user' | 'assistant', text: string): HTMLElement {
    const item = document.createElement('p');
    item.className = `ai-panel__bubble ai-panel__bubble--${role}`;
    item.textContent = text;
    conversation.append(item);
    conversation.scrollTop = conversation.scrollHeight;
    return item;
  }

  function toolCallRow(record: AgentTurnResult['toolCalls'][number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ai-panel__toolcall';
    const label = document.createElement('span');
    label.className = `ai-panel__toolcall-status ai-panel__toolcall-status--${record.status}`;
    label.textContent = STATUS_LABELS[record.status] ?? record.status;
    const name = document.createElement('code');
    name.textContent = record.name;
    const args = document.createElement('span');
    args.className = 'ai-panel__toolcall-args';
    args.textContent = record.argumentsPreview;
    row.append(label, name, args);

    if (record.status === 'awaiting-approval') {
      row.classList.add('ai-panel__toolcall--pending');
      const reason = document.createElement('p');
      reason.className = 'ai-panel__approval-reason';
      reason.textContent = `${record.approvalReason ?? 'This operation needs your approval.'} — AI-generated proposal; nothing is applied until you approve.`;
      const actions = document.createElement('div');
      actions.className = 'ai-panel__approval-actions';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'btn btn--primary';
      approve.textContent = 'Approve once';
      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'btn';
      deny.textContent = 'Deny';
      approve.addEventListener('click', () => {
        approve.disabled = true;
        deny.disabled = true;
        void sendTurn([record.id], `Approved ${record.name}.`);
      });
      deny.addEventListener('click', () => {
        approve.disabled = true;
        deny.disabled = true;
        label.textContent = 'canceled';
        row.classList.remove('ai-panel__toolcall--pending');
        callbacks.announce(`Denied the proposed ${record.name} operation.`);
        pendingApprovals.delete(record.id);
      });
      actions.append(approve, deny);
      row.append(reason, actions);
    }

    if (record.status === 'failed' && record.error !== null) {
      const error = document.createElement('p');
      error.className = 'ai-panel__toolcall-error';
      error.textContent = `${record.error.code}: ${record.error.message}`;
      row.append(error);
    }
    if (record.status === 'succeeded' && record.result !== null && record.result !== undefined) {
      const result = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Result';
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(record.result, null, 2).slice(0, 2000);
      result.append(summary, pre);
      row.append(result);
    }
    return row;
  }

  async function sendTurn(
    approvedToolCallIds: string[] | undefined,
    announceMessage?: string,
  ): Promise<void> {
    if (sendButton.disabled && approvedToolCallIds === undefined) return;
    const isFirstTurn = approvedToolCallIds === undefined;
    const userMessage = isFirstTurn ? input.value.trim() : lastUserMessage;
    if (isFirstTurn) {
      if (userMessage.length === 0) {
        setStatus('Type a message first.', true);
        return;
      }
      bubble('user', userMessage);
      input.value = '';
      lastUserMessage = userMessage;
      history.push({ role: 'user', content: userMessage });
    }
    setBusy(true);
    setStatus('', false);
    try {
      const result = await callbacks.chat(
        approvedToolCallIds === undefined
          ? { messages: [...history] }
          : { messages: [...history], approvedToolCallIds },
      );
      pendingApprovals = new Map(
        result.toolCalls
          .filter((record) => record.status === 'awaiting-approval')
          .map((record) => [record.id, record.approvalReason ?? '']),
      );
      for (const record of result.toolCalls) {
        conversation.append(toolCallRow(record));
      }
      if (result.reply.length > 0) {
        bubble('assistant', result.reply);
        history.push({ role: 'assistant', content: result.reply });
      }
      if (result.error !== null) {
        setStatus(`${result.error.code}: ${result.error.message}`, true);
      } else if (pendingApprovals.size > 0) {
        setStatus('The model proposed operations that need your approval above.', false);
      } else if (result.reply.length === 0) {
        setStatus('The model returned no text. Try rephrasing, or check the model in settings.', true);
      } else if (announceMessage !== undefined) {
        setStatus(announceMessage, false);
        callbacks.announce(announceMessage);
      } else {
        setStatus('', false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      setStatus(`The AI request failed: ${message}`, true);
    } finally {
      setBusy(false);
    }
  }

  sendButton.addEventListener('click', () => void sendTurn(undefined));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void sendTurn(undefined);
    }
  });

  const footer = document.createElement('p');
  footer.className = 'ai-panel__footer';
  footer.textContent =
    'Status per proposal: proposed → needs approval → running → done/failed. Denied proposals are canceled and never execute.';

  element.append(heading, disclosure, status, conversation, presets, input, sendButton, footer);

  // Honest off state (FR-AI-10): the panel renders but states the gate.
  void callbacks
    .isEnabled()
    .then((enabled) => {
      if (!enabled) {
        input.disabled = true;
        sendButton.disabled = true;
        setStatus(
          'AI features are turned off — enable them in settings. Notes, search, capture and reminders keep working without AI.',
          false,
        );
      }
    })
    .catch(() => undefined);

  return {
    element,
    dispose(): void {
      element.remove();
    },
  };
}
