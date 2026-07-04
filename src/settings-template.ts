import * as vscode from 'vscode';
import { mergeSettingsText, parseJsoncStrict } from './settings-merge';
import { log } from './log';

// vscode.workspace.fs (not node fs) so this works from either extension host —
// in dev-container windows the UI-host copy reaches the files through the remote.
async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Materialize the repo's tracked settings template into (untracked)
 * `.vscode/settings.json`. Deliberately NOT worktree-gated: settings.json only
 * exists because we write it, so every window — main checkout included — must
 * run this or VS Code sees no workspace settings at all. No-op when the
 * template file doesn't exist. Returns true when settings.json was (re)written.
 */
export async function applySettingsTemplate(folder: vscode.WorkspaceFolder, templateRel: string): Promise<boolean> {
  const templateUri = vscode.Uri.joinPath(folder.uri, templateRel);
  const templateText = await readText(templateUri);
  if (templateText === undefined) {
    return false;
  }
  const template = parseJsoncStrict(templateText);
  if (!template) {
    log(`Settings template ${templateRel} is not valid JSONC — skipping merge.`);
    return false;
  }
  const settingsUri = vscode.Uri.joinPath(folder.uri, '.vscode', 'settings.json');
  const settingsText = await readText(settingsUri);
  if (settingsText !== undefined && settingsText.trim() !== '' && !parseJsoncStrict(settingsText)) {
    log('.vscode/settings.json is not valid JSONC — refusing to merge over it.');
    return false;
  }
  const merged = mergeSettingsText(settingsText ?? '', template);
  if (merged === undefined) {
    return false;
  }
  await vscode.workspace.fs.writeFile(settingsUri, new TextEncoder().encode(merged));
  log(`Merged ${templateRel} into .vscode/settings.json.`);
  return true;
}

/** Re-merge live when the template changes, so edits apply without a reload. */
export function watchSettingsTemplate(folder: vscode.WorkspaceFolder, templateRel: string): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, templateRel));
  const remerge = () => void applySettingsTemplate(folder, templateRel);
  watcher.onDidChange(remerge);
  watcher.onDidCreate(remerge);
  return watcher;
}
