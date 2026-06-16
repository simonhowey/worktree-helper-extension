// Git interrogation via execFile (never a shell — branch names with `/` or
// special chars are passed as argv, so there is nothing to escape).
// This module has no `vscode` dependency so it can be unit-tested standalone.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  /** Absolute path to the worktree's working directory. */
  path: string;
  /** Branch name (e.g. `feature/foo`), or undefined when detached. */
  branch?: string;
}

export interface RepoContext {
  /** True when the cwd is a linked worktree (not the main working tree). */
  isLinkedWorktree: boolean;
  /** Branch name, or a short SHA when HEAD is detached. */
  branch: string;
  /** True when HEAD is detached (branch holds a short SHA). */
  detached: boolean;
  /** Absolute path to the shared `.git` common dir (identifies the repo). */
  commonDir: string;
}

/** Runs git with the given args in `cwd`. Returns trimmed stdout, or null on any failure. */
async function git(gitPath: string, cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(gitPath, args, { cwd, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** True when `cwd` is inside a git work tree. */
export async function isGitRepo(gitPath: string, cwd: string): Promise<boolean> {
  return (await git(gitPath, cwd, ['rev-parse', '--is-inside-work-tree'])) === 'true';
}

/**
 * Gathers the worktree/branch context for `cwd`, or null if `cwd` is not a git repo.
 * A linked worktree is detected by `--git-dir` differing from `--git-common-dir`.
 */
export async function getRepoContext(gitPath: string, cwd: string): Promise<RepoContext | null> {
  if (!(await isGitRepo(gitPath, cwd))) {
    return null;
  }

  const gitDir = await git(gitPath, cwd, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const commonDir = await git(gitPath, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!gitDir || !commonDir) {
    return null;
  }

  const isLinkedWorktree = path.resolve(gitDir) !== path.resolve(commonDir);

  // `--show-current` is empty on detached HEAD; fall back to a short SHA.
  const current = await git(gitPath, cwd, ['branch', '--show-current']);
  let branch = current ?? '';
  let detached = false;
  if (!branch) {
    detached = true;
    branch = (await git(gitPath, cwd, ['rev-parse', '--short', 'HEAD'])) ?? 'unknown';
  }

  return { isLinkedWorktree, branch, detached, commonDir: path.resolve(commonDir) };
}

/**
 * Lists all worktrees of the repo containing `cwd` (including the main tree).
 * Parses `git worktree list --porcelain`. Returns [] on failure.
 */
export async function listWorktrees(gitPath: string, cwd: string): Promise<WorktreeInfo[]> {
  const out = await git(gitPath, cwd, ['worktree', 'list', '--porcelain']);
  if (!out) {
    return [];
  }

  const trees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: path.resolve(line.slice('worktree '.length)) };
      trees.push(current);
    } else if (line.startsWith('branch ') && current) {
      // e.g. "branch refs/heads/feature/foo" -> "feature/foo"
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  return trees;
}
