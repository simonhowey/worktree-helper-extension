# Worktree Helper

Makes each git **worktree** window visually distinct and context-aware. When you open a
worktree (via VS Code's built-in *Git: Create Worktree* → *Open Worktree in New Window*, or any
other way), this extension automatically:

- **a) Colors the titlebar** with a color picked from a palette, chosen to be the most distinct
  from the colors already used by the repo's other worktrees — so each window is recognisable at
  a glance, with a readable (auto-contrasting) foreground.
- **b) Injects environment variables** — the branch name (`GIT_BRANCH`) and the titlebar color
  (`WORKTREE_COLOR`) — into integrated terminals and, via a generated file, into debug/task
  processes.
- **c) Opens configured terminals** in the worktree folder, each running a program you specify.

It does **not** create worktrees — VS Code 1.103+ already does that. This extension reacts to a
worktree being opened and configures the window.

## How it works

On activation (`onStartupFinished`, in every window) the extension:

1. Requires Workspace Trust (it runs `git` and spawns terminals).
2. Detects whether the folder is a **linked worktree** — `git rev-parse --git-dir` differs from
   `--git-common-dir`. Main working trees are skipped unless `applyToMainWorktree` is enabled.
3. Resolves the branch (`git branch --show-current`, falling back to a short SHA on detached HEAD).
4. Picks/reuses a color, writes the `titleBar.*` keys into the workspace `.vscode/settings.json`.
5. Injects the env vars and writes `.env.worktree`.
6. Opens the configured terminals — **once per worktree** (guarded so reloads don't duplicate them).

Color and env reconcile on every activation; terminals are opened only on first setup.

## Environment variables for debug & tasks

VS Code's terminal env API reaches integrated terminals only — **not** debuggers or tasks. So the
extension also writes a git-excluded **`.env.worktree`** at the worktree root:

```
GIT_BRANCH=feature/login
WORKTREE_COLOR=#1565c0
```

It writes a **dedicated** file (not your `.env`) so it never clobbers an existing, possibly secret-
bearing `.env`. Point your tooling at it:

- **Node debug** (`launch.json`): `"envFile": "${workspaceFolder}/.env.worktree"`
- **Python**: set `"python.envFile": "${workspaceFolder}/.env.worktree"` in settings
- **Tasks** (`tasks.json`): reference the values via `options.env`, or rely on the terminal env
- Any tool that loads dotenv files can read it directly

## Titlebar style requirement

Titlebar colors only render with the **custom** title bar (`titleBar.*` keys are ignored on the
native title bar on Windows/Linux). If you're on native, the extension offers a one-click switch to
`window.titleBarStyle: "custom"` (a global setting; needs a window reload). It never changes this
silently.

## Settings

All under `worktreeHelper.*`:

| Setting | Default | Description |
|---|---|---|
| `autoApply` | `true` | Apply automatically when a linked worktree is opened |
| `applyToMainWorktree` | `false` | Also configure the primary working tree |
| `terminals` | `[]` | `[{ "name": "...", "command": "..." }]` — terminals to open (omit/empty `command` → plain terminal) |
| `palette` | 16 colors | Candidate titlebar background colors (hex) |
| `colorOverride` | `""` | Force a specific color for this workspace |
| `injectEnv` | `true` | Inject env vars into terminals |
| `writeEnvFile` | `true` | Write `.env.worktree` for debug/tasks |
| `branchEnvVar` | `GIT_BRANCH` | Branch env var name |
| `colorEnvVar` | `WORKTREE_COLOR` | Color env var name |
| `openTerminals` | `true` | Open the configured terminals |
| `gitExcludeWrites` | `true` | Add our files to `.git/info/exclude` |

Example — open a dev server and a shell in every worktree:

```json
"worktreeHelper.terminals": [
  { "name": "dev",   "command": "npm run dev" },
  { "name": "shell" }
]
```

A terminal with no `command` (omitted, or `"command": ""`) opens as a plain terminal — nothing
is run, just a shell in the worktree folder.

## Commands

- **Worktree Helper: Re-apply Config** — clear the marker and run the pipeline again (re-opens terminals).
- **Worktree Helper: Clean Up This Window** — remove our titlebar colors, clear env vars, delete `.env.worktree`.
- **Worktree Helper: Pick Titlebar Color** — choose a palette color manually, or auto-pick the most distinct.

## Development

```bash
npm install
npm run watch      # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
npm run typecheck  # tsc --noEmit
npm run package    # produce a .vsix
```

## Notes & limitations

- **Multi-root workspaces**: the first folder is treated as the active worktree (the titlebar is
  per-window, so one color).
- **`.vscode/settings.json`**: coloring must be written here (there's no in-memory API for
  `colorCustomizations`). It's added to `.git/info/exclude` by default. Already-tracked files are
  unaffected by exclude and will still show in `git status`.
- There is no VS Code API to inject env into *all* debug sessions automatically; `.env.worktree` is
  the portable artifact for that.
