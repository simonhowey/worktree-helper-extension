import * as vscode from 'vscode';

// Idempotency marker (workspaceState, per-window) so terminals open once per
// worktree, not on every reload. Color cache (globalState, shared across windows)
// records which color a worktree was assigned for stability and quick reuse.

function markerKey(commonDir: string, worktreePath: string): string {
  return `applied:${commonDir}:${worktreePath}`;
}

export function isApplied(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): boolean {
  return ctx.workspaceState.get<boolean>(markerKey(commonDir, worktreePath)) === true;
}

export function setApplied(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): Thenable<void> {
  return ctx.workspaceState.update(markerKey(commonDir, worktreePath), true);
}

export function clearApplied(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): Thenable<void> {
  return ctx.workspaceState.update(markerKey(commonDir, worktreePath), undefined);
}

// Separate, durable marker for run-once setup commands. Deliberately NOT cleared
// by `reapply`/`clean` (those refresh visuals/env, not the worktree's bootstrap),
// so setup like `npm install` runs once per worktree and not on every re-apply.
function setupKey(commonDir: string, worktreePath: string): string {
  return `setup:${commonDir}:${worktreePath}`;
}

export function isSetupDone(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): boolean {
  return ctx.workspaceState.get<boolean>(setupKey(commonDir, worktreePath)) === true;
}

export function setSetupDone(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): Thenable<void> {
  return ctx.workspaceState.update(setupKey(commonDir, worktreePath), true);
}

export function clearSetupDone(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): Thenable<void> {
  return ctx.workspaceState.update(setupKey(commonDir, worktreePath), undefined);
}

// Durable per-worktree marker so the stale-base check runs once (not on every
// reload / container reopen). Set only after a fetch actually completed, so an
// offline first open retries rather than being skipped forever.
function staleKey(commonDir: string, worktreePath: string): string {
  return `staleChecked:${commonDir}:${worktreePath}`;
}

export function isStaleChecked(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): boolean {
  return ctx.workspaceState.get<boolean>(staleKey(commonDir, worktreePath)) === true;
}

export function setStaleChecked(ctx: vscode.ExtensionContext, commonDir: string, worktreePath: string): Thenable<void> {
  return ctx.workspaceState.update(staleKey(commonDir, worktreePath), true);
}

const COLOR_CACHE = 'colorCache';

type ColorCache = Record<string, string>;

export function getCachedColor(ctx: vscode.ExtensionContext, worktreePath: string): string | undefined {
  return ctx.globalState.get<ColorCache>(COLOR_CACHE, {})[worktreePath];
}

export function setCachedColor(ctx: vscode.ExtensionContext, worktreePath: string, color: string): Thenable<void> {
  const cache = { ...ctx.globalState.get<ColorCache>(COLOR_CACHE, {}) };
  cache[worktreePath] = color;
  return ctx.globalState.update(COLOR_CACHE, cache);
}
