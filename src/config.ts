import * as vscode from 'vscode';

export interface TerminalSpec {
  name: string;
  /** Command to run on open. Omitted/empty → a plain terminal with no command. */
  command?: string;
}

export interface WorktreeConfig {
  autoApply: boolean;
  applyToMainWorktree: boolean;
  setupCommands: string[];
  terminals: TerminalSpec[];
  palette: string[];
  colorOverride: string;
  injectEnv: boolean;
  writeEnvFile: boolean;
  branchEnvVar: string;
  colorEnvVar: string;
  openTerminals: boolean;
  gitExcludeWrites: boolean;
}

/** Reads `worktreeHelper.*` settings for the given folder scope, with defaults from the manifest. */
export function getConfig(scope?: vscode.ConfigurationScope): WorktreeConfig {
  const c = vscode.workspace.getConfiguration('worktreeHelper', scope);
  const get = <T>(key: string, fallback: T): T => c.get<T>(key) ?? fallback;
  return {
    autoApply: get('autoApply', true),
    applyToMainWorktree: get('applyToMainWorktree', false),
    setupCommands: get<string[]>('setupCommands', []),
    terminals: get<TerminalSpec[]>('terminals', []),
    palette: get<string[]>('palette', []),
    colorOverride: get('colorOverride', '').trim(),
    injectEnv: get('injectEnv', true),
    writeEnvFile: get('writeEnvFile', true),
    branchEnvVar: get('branchEnvVar', 'GIT_BRANCH').trim() || 'GIT_BRANCH',
    colorEnvVar: get('colorEnvVar', 'WORKTREE_COLOR').trim() || 'WORKTREE_COLOR',
    openTerminals: get('openTerminals', true),
    gitExcludeWrites: get('gitExcludeWrites', true),
  };
}

/**
 * Resolves the git executable path from the built-in Git extension's `git.path`
 * setting when available, otherwise falls back to `git` on PATH.
 */
export function getGitPath(): string {
  const configured = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
  if (typeof configured === 'string' && configured) {
    return configured;
  }
  if (Array.isArray(configured) && configured.length > 0) {
    return configured[0];
  }
  return 'git';
}
