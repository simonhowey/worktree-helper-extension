import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TitlebarColors } from "./color";
import { log } from "./log";

// The exact set of colorCustomizations keys we own. We merge only these and,
// on cleanup, remove only these — never touching the user's other customizations.
const OUR_KEYS: (keyof TitlebarColors)[] = [
  "activeBackground",
  "activeForeground",
  "border",
];

function customizationKey(k: keyof TitlebarColors): string {
  return `titleBar.${k}`;
}

type Customizations = Record<string, unknown>;

/** Current `titleBar.activeBackground` in this workspace, if we (or the user) set one. */
export function getCurrentBackground(
  folder: vscode.WorkspaceFolder,
): string | undefined {
  const current = vscode.workspace
    .getConfiguration("workbench", folder.uri)
    .get<Customizations>("colorCustomizations");
  const bg = current?.["titleBar.activeBackground"];
  return typeof bg === "string" ? bg : undefined;
}

/** Shallow-merge our five titleBar.* keys into workspace colorCustomizations, preserving the rest. */
export async function applyTitlebar(
  folder: vscode.WorkspaceFolder,
  colors: TitlebarColors,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("workbench", folder.uri);
  const current = cfg.get<Customizations>("colorCustomizations") ?? {};
  const merged: Customizations = { ...current };
  for (const k of OUR_KEYS) {
    merged[customizationKey(k)] = colors[k];
  }
  // Skip the write when nothing changed, so reloads don't churn settings.json.
  const unchanged = OUR_KEYS.every(
    (k) => current[customizationKey(k)] === colors[k],
  );
  if (unchanged) {
    return;
  }
  await cfg.update(
    "colorCustomizations",
    merged,
    vscode.ConfigurationTarget.Workspace,
  );
}

/** Remove only our keys from workspace colorCustomizations. */
export async function removeTitlebar(
  folder: vscode.WorkspaceFolder,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("workbench", folder.uri);
  const current = cfg.get<Customizations>("colorCustomizations");
  if (!current) {
    return;
  }
  const next: Customizations = { ...current };
  for (const k of OUR_KEYS) {
    delete next[customizationKey(k)];
  }
  const value = Object.keys(next).length > 0 ? next : undefined;
  await cfg.update(
    "colorCustomizations",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
}

/**
 * Titlebar colors are ignored on the native title bar (Windows/Linux). If the user
 * is on native, offer a one-click switch to custom (a global setting; needs reload).
 */
export async function ensureTitleBarStyleCustom(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("window");
  if (cfg.get<string>("titleBarStyle") === "custom") {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Worktree Helper: titlebar colors require the custom title bar style. Switch now? (a window reload is needed)",
    "Switch & Reload",
    "Not now",
  );
  if (choice === "Switch & Reload") {
    await cfg.update(
      "titleBarStyle",
      "custom",
      vscode.ConfigurationTarget.Global,
    );
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

/** Strip // and /* *\/ comments and trailing commas so JSON.parse accepts settings.json. */
function parseJsonc(text: string): unknown {
  const noComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailingCommas);
}

/**
 * Best-effort read of `titleBar.activeBackground` from each worktree's
 * `.vscode/settings.json`. Unreadable/unparseable files are skipped.
 */
export async function readSiblingBackgrounds(
  worktreePaths: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const wt of worktreePaths) {
    try {
      const text = await fs.readFile(
        path.join(wt, ".vscode", "settings.json"),
        "utf8",
      );
      const json = parseJsonc(text) as Record<string, unknown> | null;
      const custom = json?.["workbench.colorCustomizations"] as
        | Customizations
        | undefined;
      const bg = custom?.["titleBar.activeBackground"];
      if (typeof bg === "string") {
        out.push(bg);
      }
    } catch {
      // missing or invalid — ignore
    }
  }
  return out;
}

/**
 * Ensure the given anchored patterns exist in the repo's shared `.git/info/exclude`,
 * so files we write don't show up as untracked. (Tracked files are unaffected by
 * exclude, so this is always safe.)
 */
export async function ensureGitExclude(
  commonDir: string,
  patterns: string[],
): Promise<void> {
  const excludePath = path.join(commonDir, "info", "exclude");
  let existing = "";
  try {
    existing = await fs.readFile(excludePath, "utf8");
  } catch {
    // info/exclude may not exist yet; we'll create it
  }
  const present = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = patterns.filter((p) => !present.has(p));
  if (missing.length === 0) {
    return;
  }
  const header = existing.includes("# Worktree Helper")
    ? ""
    : "\n# Worktree Helper\n";
  const addition = header + missing.join("\n") + "\n";
  try {
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.appendFile(excludePath, addition, "utf8");
    log(`Added to git exclude: ${missing.join(", ")}`);
  } catch (e) {
    log(`Failed to update git exclude: ${String(e)}`);
  }
}
