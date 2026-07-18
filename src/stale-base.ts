import * as vscode from 'vscode';
import { countCommits, fastForwardTo, fetchBranchTip, isAncestor } from './git';
import { WorktreeConfig } from './config';
import { log } from './log';

// Cap on the fetch so an offline / slow remote can't stall window activation
// (the check runs before the dev-container handoff, so it gates the reopen).
const FETCH_TIMEOUT_MS = 8000;

/**
 * Warns when a freshly-created worktree was branched off a stale base — the
 * classic "forgot to pull main before making the worktree" mistake. Fetches the
 * base branch, and if this worktree is strictly behind it AND has no commits of
 * its own (so a fast-forward is safe and lossless), offers a one-click update.
 *
 * Deliberately silent for branches that have diverged (real work of their own):
 * being behind main is normal there and re-nagging on every open would be noise.
 *
 * Never throws — a failure here must not break window setup. Returns true only
 * when the fetch+comparison actually completed, so the caller can mark it done
 * and an offline open retries next time instead of being skipped forever.
 */
export async function warnIfStaleBase(
  gitPath: string,
  cwd: string,
  branch: string,
  config: WorktreeConfig,
): Promise<boolean> {
  const remote = config.baseRemote;
  const base = config.baseBranch;
  const ref = `${remote}/${base}`;

  const tip = await fetchBranchTip(gitPath, cwd, remote, base, FETCH_TIMEOUT_MS);
  if (!tip) {
    log(`Stale-base check: could not fetch ${ref} (offline or missing) — skipping, will retry next open.`);
    return false;
  }

  // Up to date: base tip is already contained in this worktree's history.
  if ((await isAncestor(gitPath, cwd, tip, 'HEAD')) !== false) {
    log(`Stale-base check: worktree is up to date with ${ref}.`);
    return true;
  }

  // Behind. Only offer the fix when it's a clean fast-forward (this branch has
  // no unique commits) — otherwise it's an established, diverged branch: leave it.
  if ((await isAncestor(gitPath, cwd, 'HEAD', tip)) !== true) {
    log(`Stale-base check: "${branch}" has diverged from ${ref} (own commits) — not warning.`);
    return true;
  }

  const behind = await countCommits(gitPath, cwd, 'HEAD', tip);
  log(`Stale-base check: "${branch}" is ${behind} commit(s) behind ${ref} and fast-forwardable.`);

  const update = `Update to ${ref}`;
  const choice = await vscode.window.showWarningMessage(
    `Worktree "${branch}" was branched from a ${base} that is ${behind} commit(s) behind ${ref}.`,
    {
      modal: true,
      detail:
        `Starting work here means building on stale code. This branch has no commits of its own yet, ` +
        `so it can be safely fast-forwarded to ${ref} — the same as if you had pulled ${base} first.`,
    },
    update,
    'Keep anyway',
  );

  if (choice === update) {
    if (await fastForwardTo(gitPath, cwd, tip)) {
      vscode.window.showInformationMessage(`Worktree Helper: updated "${branch}" to ${ref}.`);
      log(`Stale-base check: fast-forwarded "${branch}" to ${ref}.`);
    } else {
      vscode.window.showWarningMessage(
        `Worktree Helper: could not fast-forward "${branch}" to ${ref}. Update it manually.`,
      );
      log(`Stale-base check: fast-forward of "${branch}" to ${ref} failed.`);
    }
  }
  return true;
}
