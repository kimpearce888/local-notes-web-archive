/**
 * AI permission modes (FR-AI-07): the gate between model proposals and the
 * tool dispatcher. The model NEVER executes directly — every proposal is
 * evaluated here first.
 *
 * Modes:
 * - read-only: read tools only; everything else is denied outright.
 * - ask-per-write (DEFAULT): read tools run; every write and destructive
 *   operation requires explicit user approval first.
 * - safe-writes: read + non-destructive write tools run; destructive
 *   operations (trash) still require approval.
 *
 * Permanent deletion is not reachable through the tool surface at all, so
 * "always requires confirmation" holds structurally.
 */

import type { AiPermissionMode } from '../../core/types';
import type { ToolSpec } from './tools';

export interface ToolPermissionDecision {
  /** May the dispatcher execute this proposal at all? */
  readonly allowed: boolean;
  /** True when execution additionally needs explicit user approval. */
  readonly requiresApproval: boolean;
  readonly reason: string;
}

const READ_REASON = 'read-only tool — allowed in every mode';

export function evaluateToolPermission(
  mode: AiPermissionMode,
  tool: ToolSpec,
): ToolPermissionDecision {
  if (tool.risk === 'read') {
    return { allowed: true, requiresApproval: false, reason: READ_REASON };
  }
  switch (mode) {
    case 'read-only':
      return {
        allowed: false,
        requiresApproval: false,
        reason: `AI permission mode is read-only — "${tool.name}" is a ${tool.risk} operation`,
      };
    case 'ask-per-write':
      return {
        allowed: true,
        requiresApproval: true,
        reason: `ask-before-write mode — "${tool.name}" needs your approval`,
      };
    case 'safe-writes':
      if (tool.risk === 'destructive') {
        return {
          allowed: true,
          requiresApproval: true,
          reason: `safe-writes mode — destructive operation "${tool.name}" needs your approval`,
        };
      }
      return {
        allowed: true,
        requiresApproval: false,
        reason: `safe-writes mode — non-destructive write "${tool.name}" runs directly`,
      };
    default: {
      // Unknown modes fail closed (never silently permissive).
      const exhaustive: never = mode;
      void exhaustive;
      return {
        allowed: false,
        requiresApproval: false,
        reason: 'unknown permission mode — failing closed',
      };
    }
  }
}
