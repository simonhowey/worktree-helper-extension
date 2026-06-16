import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function initLog(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('Worktree Helper');
  return channel;
}

export function log(message: string): void {
  channel?.appendLine(message);
}
