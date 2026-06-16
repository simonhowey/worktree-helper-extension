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
