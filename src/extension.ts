import * as vscode from 'vscode';
import { getConfig, getGitPath, WorktreeConfig } from './config';
import { getRepoContext, listWorktrees, RepoContext } from './git';
import { buildTitlebarColors, pickDistinctColor } from './color';
import {
  applyTitlebar,
  removeTitlebar,
  ensureTitleBarStyleCustom,
  ensureGitExclude,
  getCurrentBackground,
  readSiblingBackgrounds,
} from './titlebar';
import { applyEnv, clearEnv } from './env';
import { warnIfStaleBase } from './stale-base';
import { openTerminals, hasOurTerminals } from './terminals';
import { runSetupCommands } from './setup';
import { applySettingsTemplate, watchSettingsTemplate } from './settings-template';
import {
  markerExists,
  createMarker,
  deleteMarker,
  reopenInContainer,
  initPauseIndicator,
  refreshPauseIndicator,
  watchMarker,
} from './container-pause';
import {
  isApplied,
  setApplied,
  clearApplied,
  isSetupDone,
  setSetupDone,
  clearSetupDone,
  isStaleChecked,
  setStaleChecked,
  getCachedColor,
  setCachedColor,
} from './state';
import { initLog, log } from './log';

// Sentinel in place of commonDir for the applied marker when git is unavailable.
const NO_GIT = 'remote-no-git';

export function activate(context: vscode.ExtensionContext): void {
  initLog();
  context.subscriptions.push(
    vscode.commands.registerCommand('worktreeHelper.reapply', () => reapply(context)),
    vscode.commands.registerCommand('worktreeHelper.clean', () => clean(context)),
    vscode.commands.registerCommand('worktreeHelper.pickColor', () => pickColor(context)),
    vscode.commands.registerCommand('worktreeHelper.runSetup', () => runSetup(context)),
    vscode.commands.registerCommand('worktreeHelper.stayInWsl', () => stayInWsl()),
    vscode.commands.registerCommand('worktreeHelper.resumeAutoContainer', () => resumeAutoContainer()),
  );
  initPauseIndicator(context);
  const folder = activeFolder();
  const templateRel = getConfig(folder?.uri).settingsTemplate;
  if (folder && templateRel) {
    context.subscriptions.push(watchSettingsTemplate(folder, templateRel));
  }
  if (folder) {
    context.subscriptions.push(watchMarker(folder));
  }
  void refreshPauseIndicator(folder);
  void applyWorktreeConfig(context, false);
}

export function deactivate(): void {
  // EnvironmentVariableCollection is auto-cleared by VS Code on uninstall.
}

function activeFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Resolve the repo context, gating on trust, a folder, and worktree status.
 * `repo` is null when host-side git can't see the folder (not a repo, or a remote
 * window whose path isn't mirrored on the host) — callers decide how to degrade.
 */
async function resolveContext(
  config: WorktreeConfig,
): Promise<{ folder: vscode.WorkspaceFolder; repo: RepoContext | null; gitPath: string } | undefined> {
  if (!vscode.workspace.isTrusted) {
    log('Workspace not trusted — skipping.');
    return undefined;
  }
  const folder = activeFolder();
  if (!folder) {
    return undefined;
  }
  const gitPath = getGitPath();
  const repo = await getRepoContext(gitPath, folder.uri.fsPath);
  if (!repo) {
    log(`Not a git repository (on the host): ${folder.uri.fsPath}`);
  } else if (!repo.isLinkedWorktree && !config.applyToMainWorktree) {
    log('Main working tree (applyToMainWorktree is off) — skipping.');
    return undefined;
  }
  return { folder, repo, gitPath };
}

/** Choose the background: override > existing > cache > most-distinct palette pick. */
async function resolveColor(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  repo: RepoContext,
  config: WorktreeConfig,
  gitPath: string,
): Promise<string> {
  if (config.colorOverride) {
    return config.colorOverride;
  }
  const existing = getCurrentBackground(folder) ?? getCachedColor(context, folder.uri.fsPath);
  if (existing) {
    return existing;
  }
  const worktrees = await listWorktrees(gitPath, folder.uri.fsPath);
  const siblings = worktrees.map((w) => w.path).filter((p) => p !== folder.uri.fsPath);
  const used = [
    ...(await readSiblingBackgrounds(siblings)),
    ...siblings.map((p) => getCachedColor(context, p)).filter((c): c is string => !!c),
  ];
  return pickDistinctColor(config.palette, used, repo.branch);
}

async function applyWorktreeConfig(context: vscode.ExtensionContext, force: boolean): Promise<void> {
  // Settings template first, and BEFORE reading config — on a fresh worktree the
  // worktreeHelper.* settings themselves come from the generated settings.json.
  // Not worktree-gated: settings.json is untracked in template repos, so every
  // window (main checkout included) must materialize it.
  const templateFolder = activeFolder();
  if (templateFolder && vscode.workspace.isTrusted) {
    const templateRel = getConfig(templateFolder.uri).settingsTemplate;
    if (templateRel && (await applySettingsTemplate(templateFolder, templateRel))) {
      await configRefreshed(2000);
    }
  }
  const config = getConfig(activeFolder()?.uri);
  if (!config.autoApply && !force) {
    return;
  }
  const resolved = await resolveContext(config);
  if (!resolved) {
    return;
  }
  const { folder, repo, gitPath } = resolved;
  const firstApply = force || !isApplied(context, repo?.commonDir ?? NO_GIT, folder.uri.fsPath);

  // Apply the host-inheritable artifacts (titlebar color + owned .env file) BEFORE
  // any container handoff. The reopened dev-container window does NOT run this
  // extension (it lives in the local/WSL extension host, not the container's), so
  // it can't apply them itself — but it inherits both: .vscode/settings.json is read
  // by the client-side workbench for the titlebar, and .env.worktree is bind-mounted
  // into the container where the dev server reads it. Terminals and terminal
  // env-injection can't be inherited across the reload, so they stay after the
  // handoff (they only take effect when we don't reopen). Awaited, so both writes
  // are flushed to disk before maybeReopenInContainer reloads the window.
  let background = '';
  if (repo) {
    background = await resolveColor(context, folder, repo, config, gitPath);
    await applyTitlebar(folder, buildTitlebarColors(background));
    await setCachedColor(context, folder.uri.fsPath, background);
    if (firstApply) {
      await ensureTitleBarStyleCustom();
    }
    const envFile = await applyEnv(context, folder, config, { branch: repo.branch, color: background });
    if (config.gitExcludeWrites) {
      const patterns = ['/.vscode/settings.json'];
      if (envFile) {
        patterns.push(`/${envFile}`);
      }
      await ensureGitExclude(repo.commonDir, patterns);
    }
  }

  // Stale-base guard — catch a worktree branched off an out-of-date base (the
  // "forgot to pull main" mistake). Run BEFORE any container handoff so the modal
  // isn't killed by the reload and the fix lands before the container builds;
  // once per worktree (marked only when a fetch actually completed). Linked
  // worktrees only — the main checkout isn't where new work is started.
  if (
    repo &&
    repo.isLinkedWorktree &&
    config.checkStaleBase &&
    !isStaleChecked(context, repo.commonDir, folder.uri.fsPath)
  ) {
    if (await warnIfStaleBase(gitPath, folder.uri.fsPath, repo.branch, config)) {
      await setStaleChecked(context, repo.commonDir, folder.uri.fsPath);
    }
  }

  // Hand off to the dev container now that color + .env.worktree are on disk and
  // will be inherited by the reopened window.
  if (repo && (await maybeReopenInContainer(folder, config))) {
    return;
  }
  if (!repo) {
    // Remote window whose path isn't mirrored on the host (non-path-preserving
    // mount): git is unusable there, but color + terminals still work.
    if (vscode.env.remoteName) {
      await applyDegradedRemote(context, folder, config, force);
    }
    return;
  }

  const envRecord = { [config.branchEnvVar]: repo.branch, [config.colorEnvVar]: background };

  // Setup commands — run once per worktree, awaited so terminals (e.g. dev servers)
  // start only after setup (e.g. install) finishes. Marked done only on success, so
  // a failed command retries on the next open instead of being silently skipped.
  if (config.setupCommands.length && !isSetupDone(context, repo.commonDir, folder.uri.fsPath)) {
    // In dev-container windows the container's postCreateCommand owns bootstrap, so
    // don't run (or mark done) — the explicit Run Setup Commands command still works.
    if (vscode.env.remoteName === 'dev-container' && !config.runSetupInDevContainer) {
      log('Skipping setup commands in dev-container window (postCreateCommand owns bootstrap; set worktreeHelper.runSetupInDevContainer to override).');
    } else {
      log(`Running ${config.setupCommands.length} setup command(s) for ${repo.branch}…`);
      if (await runSetupCommands(folder, config.setupCommands, envRecord)) {
        await setSetupDone(context, repo.commonDir, folder.uri.fsPath);
        log('Setup commands completed.');
      } else {
        log('Setup commands failed — will retry on next open.');
        vscode.window.showWarningMessage(
          'Worktree Helper: setup commands failed. See the Worktree Helper output for details.',
        );
      }
    }
  }

  // Terminals — open once per worktree (guarded so reloads don't duplicate).
  // cwd as Uri so it resolves remote-side in dev-container windows.
  if (config.openTerminals && firstApply && !hasOurTerminals()) {
    const opened = openTerminals(folder.uri, config.terminals, envRecord);
    log(`Opened ${opened} terminal(s) for ${repo.branch}.`);
  }

  await setApplied(context, repo.commonDir, folder.uri.fsPath);
  log(`Applied worktree config: branch=${repo.branch}, color=${background}.`);
}

/**
 * Resolve when VS Code's configuration model has caught up with an on-disk
 * settings.json write (it refreshes via file watcher, asynchronously), or after
 * the timeout — whichever comes first.
 */
function configRefreshed(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      listener.dispose();
      clearTimeout(timer);
      resolve();
    };
    const listener = vscode.workspace.onDidChangeConfiguration(done);
    const timer = setTimeout(done, timeoutMs);
  });
}

/**
 * If enabled and this window is not already inside a container, hand the folder
 * to the Dev Containers extension. Local and WSL/SSH windows all qualify —
 * `remoteName` is only a stop signal when it's already a container. Returns
 * true when a reopen was triggered (the window is about to reload).
 */
async function maybeReopenInContainer(
  folder: vscode.WorkspaceFolder,
  config: WorktreeConfig,
): Promise<boolean> {
  if (!config.autoReopenInContainer) {
    return false;
  }
  if (vscode.env.remoteName === 'dev-container' || vscode.env.remoteName === 'attached-container') {
    return false;
  }
  if (!(await hasDevcontainerConfig(folder.uri))) {
    return false;
  }
  // Escape hatch: a sticky marker file lets the user deliberately stay in WSL.
  // Checked on every activation/reapply, never auto-removed — a mid-session
  // reload must not bounce back into the container. The paused indicator is
  // shown by refreshPauseIndicator (run at activation and by the marker watcher).
  if (await markerExists(folder)) {
    log('.vscode/wsl-only present — staying in WSL, skipping auto-reopen.');
    return false;
  }
  log(`Dev container config found in ${folder.name} — reopening in container.`);
  return reopenInContainer();
}

/** Create the marker so this WSL window (and future opens) stay out of the container. */
async function stayInWsl(): Promise<void> {
  const folder = activeFolder();
  if (!folder) {
    return;
  }
  await createMarker(folder);
  await refreshPauseIndicator(folder);
  vscode.window.showInformationMessage(
    'Worktree Helper: staying in WSL — auto-reopen paused (.vscode/wsl-only). Resume from the status bar.',
  );
}

/** Remove the marker and hand the folder back to the dev container. */
async function resumeAutoContainer(): Promise<void> {
  const folder = activeFolder();
  if (!folder) {
    return;
  }
  await deleteMarker(folder);
  await refreshPauseIndicator(folder);
  if (!(await reopenInContainer())) {
    vscode.window.showWarningMessage(
      'Worktree Helper: could not reopen in container — is the Dev Containers extension installed?',
    );
  }
}

async function hasDevcontainerConfig(root: vscode.Uri): Promise<boolean> {
  for (const rel of ['.devcontainer/devcontainer.json', '.devcontainer.json']) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, rel));
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/**
 * Remote window whose path host-side git can't see (non-path-preserving mount):
 * apply what still works — a cached/derivable titlebar color and remote-resolved
 * terminals. No git-derived env, no env file, no setup, no popups.
 */
async function applyDegradedRemote(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  config: WorktreeConfig,
  force: boolean,
): Promise<void> {
  log(`Degraded remote mode for ${folder.uri.toString()}: color + terminals only (no host-side git).`);
  const background =
    config.colorOverride || getCurrentBackground(folder) || getCachedColor(context, folder.uri.fsPath);
  if (background) {
    await applyTitlebar(folder, buildTitlebarColors(background));
  }
  const firstApply = force || !isApplied(context, NO_GIT, folder.uri.fsPath);
  if (config.openTerminals && firstApply && !hasOurTerminals()) {
    const env = background ? { [config.colorEnvVar]: background } : {};
    const opened = openTerminals(folder.uri, config.terminals, env);
    log(`Opened ${opened} terminal(s).`);
  }
  await setApplied(context, NO_GIT, folder.uri.fsPath);
}

async function reapply(context: vscode.ExtensionContext): Promise<void> {
  const folder = activeFolder();
  const config = getConfig(folder?.uri);
  const resolved = await resolveContext(config);
  if (resolved) {
    await clearApplied(context, resolved.repo?.commonDir ?? NO_GIT, resolved.folder.uri.fsPath);
  }
  await applyWorktreeConfig(context, true);
}

/** Force-runs setup commands now, regardless of the once-per-worktree marker. */
async function runSetup(context: vscode.ExtensionContext): Promise<void> {
  const config = getConfig(activeFolder()?.uri);
  const resolved = await resolveContext(config);
  if (!resolved?.repo) {
    return;
  }
  const { folder, repo } = resolved; // repo non-null per the guard above
  if (!config.setupCommands.length) {
    vscode.window.showInformationMessage('Worktree Helper: no setupCommands configured.');
    return;
  }
  const background = getCurrentBackground(folder) ?? getCachedColor(context, folder.uri.fsPath) ?? '';
  const envRecord = { [config.branchEnvVar]: repo.branch, [config.colorEnvVar]: background };
  await clearSetupDone(context, repo.commonDir, folder.uri.fsPath);
  if (await runSetupCommands(folder, config.setupCommands, envRecord)) {
    await setSetupDone(context, repo.commonDir, folder.uri.fsPath);
    vscode.window.showInformationMessage('Worktree Helper: setup commands completed.');
  }
}

async function clean(context: vscode.ExtensionContext): Promise<void> {
  const folder = activeFolder();
  if (!folder) {
    return;
  }
  await removeTitlebar(folder);
  await clearEnv(context, folder);
  const repo = await getRepoContext(getGitPath(), folder.uri.fsPath);
  if (repo) {
    await clearApplied(context, repo.commonDir, folder.uri.fsPath);
  }
  vscode.window.showInformationMessage('Worktree Helper: cleaned up this window.');
}

async function pickColor(context: vscode.ExtensionContext): Promise<void> {
  const folder = activeFolder();
  if (!folder) {
    return;
  }
  const config = getConfig(folder.uri);
  const items: vscode.QuickPickItem[] = [
    { label: 'Auto (most distinct)', description: 'Pick automatically, avoiding sibling colors' },
    ...config.palette.map((hex) => ({ label: hex })),
  ];
  const choice = await vscode.window.showQuickPick(items, { title: 'Worktree titlebar color' });
  if (!choice) {
    return;
  }

  let background = choice.label;
  if (choice.label.startsWith('Auto')) {
    const repo = await getRepoContext(getGitPath(), folder.uri.fsPath);
    const seed = repo?.branch ?? folder.name;
    const worktrees = repo ? await listWorktrees(getGitPath(), folder.uri.fsPath) : [];
    const siblings = worktrees.map((w) => w.path).filter((p) => p !== folder.uri.fsPath);
    const used = [
      ...(await readSiblingBackgrounds(siblings)),
      getCurrentBackground(folder) ?? '',
    ].filter(Boolean);
    background = pickDistinctColor(config.palette, used, seed);
  }

  await applyTitlebar(folder, buildTitlebarColors(background));
  await setCachedColor(context, folder.uri.fsPath, background);
  await ensureTitleBarStyleCustom();
}
