import * as vscode from 'vscode';
import { TerminalSpec } from './config';

// Visible marker on every terminal we create, so we can detect (and avoid
// duplicating) them across reloads when persistent terminal sessions restore.
const PREFIX = '🌿 ';

/** True if any of our terminals already exist in this window. */
export function hasOurTerminals(): boolean {
  return vscode.window.terminals.some((t) => t.name.startsWith(PREFIX));
}

/**
 * Opens one terminal per spec in the worktree folder, seeded with `env`, then runs
 * each spec's command. Returns the number of terminals opened.
 */
export function openTerminals(
  cwd: string,
  specs: TerminalSpec[],
  env: Record<string, string>,
): number {
  let opened = 0;
  for (const spec of specs) {
    if (!spec?.name || typeof spec.command !== 'string') {
      continue;
    }
    const terminal = vscode.window.createTerminal({
      name: `${PREFIX}${spec.name}`,
      cwd,
      env,
    });
    if (spec.command.trim()) {
      // sendText queues until the shell is ready, so this is safe at open time.
      terminal.sendText(spec.command);
    }
    if (opened === 0) {
      terminal.show();
    }
    opened++;
  }
  return opened;
}
