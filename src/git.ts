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
async function git(gitPath: string, cwd: string, args: string[], timeoutMs?: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(gitPath, args, { cwd, windowsHide: true, timeout: timeoutMs });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Runs git for its exit status (not its output). Resolves the process exit code
 * (0 = success), or null when git couldn't be spawned or was killed (e.g. timeout).
 * Needed for commands like `merge-base --is-ancestor` where a non-zero exit is a
 * meaningful answer, not an error — `git()` would flatten both to null.
 */
async function gitExit(gitPath: string, cwd: string, args: string[], timeoutMs?: number): Promise<number | null> {
  try {
    await execFileAsync(gitPath, args, { cwd, windowsHide: true, timeout: timeoutMs });
    return 0;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'number' ? code : null;
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

/**
 * Fetches a single branch from a remote into FETCH_HEAD and returns its commit
 * SHA, or null on failure (offline, unknown remote/branch, or the timeout fires).
 * Uses only FETCH_HEAD so it never touches the local `refs/remotes/<remote>/…`
 * or the checked-out branch — safe to run in any worktree.
 */
export async function fetchBranchTip(
  gitPath: string,
  cwd: string,
  remote: string,
  branch: string,
  timeoutMs: number,
): Promise<string | null> {
  if ((await git(gitPath, cwd, ['fetch', '--no-tags', remote, branch], timeoutMs)) === null) {
    return null;
  }
  return git(gitPath, cwd, ['rev-parse', 'FETCH_HEAD']);
}

/**
 * True when `ancestor` is an ancestor of (or equal to) `descendant`; false when
 * it isn't; null when the comparison couldn't run (bad ref, etc.). Wraps
 * `git merge-base --is-ancestor`, whose exit code (0/1) is the answer.
 */
export async function isAncestor(
  gitPath: string,
  cwd: string,
  ancestor: string,
  descendant: string,
): Promise<boolean | null> {
  const code = await gitExit(gitPath, cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
  return code === 0 ? true : code === 1 ? false : null;
}

/** Counts commits reachable from `to` but not `from` (i.e. `git rev-list --count from..to`). */
export async function countCommits(gitPath: string, cwd: string, from: string, to: string): Promise<number> {
  const out = await git(gitPath, cwd, ['rev-list', '--count', `${from}..${to}`]);
  const n = out ? Number.parseInt(out, 10) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Fast-forwards the current branch to `ref` (`git merge --ff-only`). Returns success. */
export async function fastForwardTo(gitPath: string, cwd: string, ref: string): Promise<boolean> {
  return (await gitExit(gitPath, cwd, ['merge', '--ff-only', ref])) === 0;
}
