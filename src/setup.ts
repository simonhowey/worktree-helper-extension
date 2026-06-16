import * as vscode from 'vscode';

// Run-once bootstrap commands (e.g. `npm install`, copying untracked config) for a
// freshly-created worktree. Unlike `terminals`, these are expected to FINISH: we run
// each as a VS Code Task so we can await its exit code and only report success when
// every command exits 0 — a failed command then retries on the next open.

const TASK_TYPE = 'worktreeHelper.setup';

/**
 * Resolves a task's process exit code, or undefined if it ended without one (killed,
 * or never spawned a process). Listens to both events so the promise always settles:
 * `onDidEndTaskProcess` carries the exit code and fires first for a real process;
 * `onDidEndTask` is the fallback for a task that ends without ever producing one.
 */
function awaitExit(exec: vscode.TaskExecution): Promise<number | undefined> {
  return new Promise((resolve) => {
    const subs: vscode.Disposable[] = [];
    const done = (code: number | undefined) => {
      subs.forEach((s) => s.dispose());
      resolve(code);
    };
    subs.push(
      vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution === exec) {
          done(e.exitCode);
        }
      }),
      vscode.tasks.onDidEndTask((e) => {
        if (e.execution === exec) {
          done(undefined);
        }
      }),
    );
  });
}

/**
 * Runs `commands` sequentially in the worktree folder, seeded with `env`, stopping at
 * the first non-zero exit. Returns true only if every command succeeded. Blank entries
 * are skipped. Running as Tasks (not raw terminals) means output is visible and the
 * exit code is observable, so callers can gate later steps (terminals, dev servers) on
 * setup completing.
 */
export async function runSetupCommands(
  folder: vscode.WorkspaceFolder,
  commands: string[],
  env: Record<string, string>,
): Promise<boolean> {
  for (const command of commands) {
    if (!command.trim()) {
      continue;
    }
    const task = new vscode.Task(
      { type: TASK_TYPE },
      folder,
      command,
      'Worktree Helper',
      new vscode.ShellExecution(command, { cwd: folder.uri.fsPath, env }),
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Shared,
    };
    const exec = await vscode.tasks.executeTask(task);
    if ((await awaitExit(exec)) !== 0) {
      return false;
    }
  }
  return true;
}
