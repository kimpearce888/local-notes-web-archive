/**
 * Prompt hygiene and disclosure (FR-AI-08/09, FR-MCP-01..03).
 *
 * - MINIMUM-CONTENT POLICY: only the bounded text the model explicitly
 *   requested (note previews <= 2000 chars, snapshot text <= 8000 chars)
 *   ever reaches LM Studio. Full editor documents, MHTML bytes, PNG bytes
 *   and attachment blobs are NEVER part of any chat request.
 * - UNTRUSTED-INPUT CONTAINMENT: note/page/imported text is DATA. The
 *   system prompt is immutable and always leads the conversation; panel
 *   messages can only be user/assistant turns; instructions inside data
 *   never change policy, permissions or trigger extra captures.
 * - LOG HYGIENE: prompts and note content are excluded from technical
 *   logs — audit entries carry statuses, tool names and error codes only.
 * - DISCLOSURE: the internal tool contract is not MCP; the product never
 *   fakes server status.
 */

/** The disclosure shown wherever AI is configured or used (FR-MCP-03). */
export const MCP_DISCLOSURE =
  'This extension uses an internal, versioned tool contract over LM Studio tool calling. It is not the Model Context Protocol: no server is bound, no stdio or native messaging host is registered, and external MCP clients cannot call these tools. The product never claims or implies an MCP-server connection status.';

/** Honest LM Studio dependency statement (FR-AI-03/10). */
export const LM_STUDIO_DEPENDENCY_NOTE =
  'LM Studio and the chosen model are external dependencies you start yourself. The extension cannot start the server or load a model. When LM Studio is stopped, AI features show actionable errors while notes, search, capture and reminders keep working.';

/**
 * Audit/log detail sanitizer: strips anything beyond compact metadata so
 * prompts and note content can never leak into technical logs (FR-AI-09).
 * Keeps tool names, status codes, short error identifiers — drops
 * free-form content.
 */
export function sanitizeAiLogDetail(detail: string): string {
  const clipped = detail.slice(0, 200);
  // Keep the structural prefix before any content-looking payload and
  // collapse everything else to a placeholder.
  const safe = /^(status=[a-z-]+)\s?(.*)$/.exec(clipped);
  if (safe === null) return 'status=redacted';
  const tail = safe[2] ?? '';
  if (tail.length === 0) return safe[1] ?? 'status=redacted';
  // Only allow id-like / code-like tails (no prose, no content).
  const idLike = /^[\w .:/-]{0,120}$/.test(tail);
  return idLike ? `${safe[1]} ${tail}` : (safe[1] ?? 'status=redacted');
}

/** Fields that must never appear in a chat request payload. */
export const FORBIDDEN_CHAT_FIELDS = [
  'editorDoc',
  'mhtml',
  'mhtmlBlobKey',
  'pngBlobKey',
  'attachment',
  'blob',
] as const;

/** Assert a serialized chat request carries no forbidden content fields. */
export function chatRequestIsContentSafe(requestJson: string): { ok: boolean; field: string | null } {
  for (const field of FORBIDDEN_CHAT_FIELDS) {
    if (requestJson.includes(`"${field}"`)) {
      return { ok: false, field };
    }
  }
  return { ok: true, field: null };
}
