import * as vscode from 'vscode';
import { log } from './log';

// Marker file that pauses auto-reopen-in-container. Lives in the workspace
// (bind-mounted into the container), so it can be created from a container
// terminal (`touch .vscode/wsl-only`) and read by this WSL-side extension the
// moment the WSL window activates — the extension isn't installed in the
// container, so a file is the only channel that works both directions.
const MARKER_REL = '.vscode/wsl-only';

function markerUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, '.vscode', 'wsl-only');
}

/** Existence-only semantics — contents (empty or arbitrary text) don't matter. */
export async function markerExists(folder: vscode.WorkspaceFolder): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(markerUri(folder));
    return true;
  } catch {
    return false;
  }
}

export async function createMarker(folder: vscode.WorkspaceFolder): Promise<void> {
  await vscode.workspace.fs.writeFile(markerUri(folder), new Uint8Array());
}

export async function deleteMarker(folder: vscode.WorkspaceFolder): Promise<void> {
  try {
    await vscode.workspace.fs.delete(markerUri(folder));
  } catch {
    // already gone — deleting a non-existent marker is a no-op
  }
}

/**
 * Hand the folder to the Dev Containers extension. Commands resolve across
 * extension hosts, so don't getExtension()-check first — Dev Containers lives in
 * the UI host, invisible from a WSL/SSH workspace host. Returns true on success.
 */
export async function reopenInContainer(): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('remote-containers.reopenInContainer');
    return true;
  } catch (e) {
    log(`Reopen in Container failed — is the Dev Containers extension installed? (${String(e)})`);
    return false;
  }
}

let pauseItem: vscode.StatusBarItem | undefined;

/** Create the (hidden) status-bar item once and tie its lifetime to the extension. */
export function initPauseIndicator(context: vscode.ExtensionContext): void {
  pauseItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  pauseItem.text = '$(debug-pause) auto-container paused';
  pauseItem.tooltip = new vscode.MarkdownString(
    'Auto-reopen in dev container is paused by `.vscode/wsl-only`.\n\n' +
      'Click to resume — deletes the marker and reopens in the container.',
  );
  pauseItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  pauseItem.command = 'worktreeHelper.resumeAutoContainer';
  context.subscriptions.push(pauseItem);
}

function inContainerWindow(): boolean {
  return vscode.env.remoteName === 'dev-container' || vscode.env.remoteName === 'attached-container';
}

/**
 * Show the paused indicator iff the marker is present and this window isn't
 * already in a container (where a "paused" badge would contradict reality).
 */
export async function refreshPauseIndicator(folder: vscode.WorkspaceFolder | undefined): Promise<void> {
  if (!pauseItem) {
    return;
  }
  if (folder && !inContainerWindow() && (await markerExists(folder))) {
    pauseItem.show();
  } else {
    pauseItem.hide();
  }
}

/** Clear the indicator live when the marker is created/deleted by hand (e.g. `rm`). */
export function watchMarker(folder: vscode.WorkspaceFolder): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, MARKER_REL));
  const refresh = (): void => void refreshPauseIndicator(folder);
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  return watcher;
}
