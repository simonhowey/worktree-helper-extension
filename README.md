# Worktree Helper

Makes each git **worktree** window visually distinct and context-aware. When you open a
worktree (via VS Code's built-in _Git: Create Worktree_ → _Open Worktree in New Window_, or any
other way), this extension automatically:

- **a) Colors the titlebar** with a color picked from a palette, chosen to be the most distinct
  from the colors already used by the repo's other worktrees — so each window is recognizable at
  a glance, with a readable (auto-contrasting) foreground.
- **b) Injects environment variables** — the branch name (`GIT_BRANCH`) and the titlebar color
  (`WORKTREE_COLOR`) — into integrated terminals and, via a generated file, into debug/task
  processes.
- **c) Runs one-time setup commands** (e.g. `npm install`, copying untracked config) when a
  worktree is first set up — run as tasks, awaited, and re-tried until they succeed.
- **d) Opens configured terminals** in the worktree folder, each running a program you specify.

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
6. Runs `setupCommands` sequentially — **once per worktree**, awaited so terminals start only
   after setup finishes. Marked done only when every command exits 0, so a failure re-runs next open.
7. Opens the configured terminals — **once per worktree** (guarded so reloads don't duplicate them).

Color and env reconcile on every activation; setup commands and terminals run only on first setup.
The setup marker is independent of the apply marker, so _Re-apply Config_ refreshes visuals/env
**without** re-running setup. Re-run setup explicitly with _Run Setup Commands_.

## Environment variables for debug & tasks

VS Code's terminal env API reaches integrated terminals only — **not** debuggers or tasks. So the
extension also writes a git-excluded **`.env.worktree`** at the worktree root:

```
GIT_BRANCH=feature/login
WORKTREE_COLOR=#446b9a
```

It writes a **dedicated** file (not your `.env`) so it never clobbers an existing, possibly secret-
bearing `.env`. Point your tooling at it:

- **Node debug** (`launch.json`): `"envFile": "${workspaceFolder}/.env.worktree"`
- **Python**: set `"python.envFile": "${workspaceFolder}/.env.worktree"` in settings
- **Tasks** (`tasks.json`): reference the values via `options.env`, or rely on the terminal env
- Any tool that loads dotenv files can read it directly

## Dev containers

The extension declares `"extensionKind": ["workspace", "ui"]`: it prefers running next
to the workspace, and falls back to the UI (local) extension host in windows whose
remote doesn't have it installed — which is how a local install activates in
dev-container windows and drives the remote through the VS Code API. Don't install it
inside the container via `devcontainer.json` `customizations.vscode.extensions` unless
you've published it to a registry the container can reach.

**On WSL**, note that the "UI" host is the *Windows* VS Code, not the WSL server: a copy
installed only in WSL never activates in dev-container windows. Install the `.vsix` on
**both** sides (`code --install-extension` from WSL *and* from Windows). WSL windows
keep using the WSL copy (workspace-kind preferred, full functionality); dev-container
windows use the Windows copy, which cannot reach WSL paths and therefore runs degraded:
titlebar color (from the worktree's existing settings) and terminals, but no git-derived
env and no `.env.worktree` write. Open the worktree once as a plain WSL window first and
those files get created for the container to use.

It works best when the container mounts the worktree at the **identical absolute path**,
e.g. in `devcontainer.json`:

```json
"workspaceMount": "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind"
```

(plus a matching mount for the main checkout's `.git`). Git runs on the host, so the
host and container must see the same paths.

In a container window you get:

- the titlebar color (settings service — works the same as locally);
- the auto-opened `🌿` terminals, running **in the container**, with
  `GIT_BRANCH`/`WORKTREE_COLOR` in their env (passed at terminal creation);
- `.env.worktree`, written host-side and visible through the bind mount.

Limitations there:

- `injectEnv` (the terminal env API) is applied by the **local** extension host and does
  not reach container terminals. Terminals you open manually in a container window get
  the vars by sourcing `.env.worktree` from the shell profile instead.
- `setupCommands` are **skipped** in dev-container windows — the container's
  `postCreateCommand` owns bootstrap there. Set
  `worktreeHelper.runSetupInDevContainer: true` to override; the explicit
  _Run Setup Commands_ command always works.
- Without identical-path mounts the extension degrades gracefully: cached titlebar color
  and terminals still work; git-derived env, `.env.worktree`, and setup are skipped.

## Titlebar style requirement

Titlebar colors only render with the **custom** title bar (`titleBar.*` keys are ignored on the
native title bar on Windows/Linux). If you're on native, the extension offers a one-click switch to
`window.titleBarStyle: "custom"` (a global setting; needs a window reload). It never changes this
silently.

## Settings

All under `worktreeHelper.*`:

| Setting               | Default          | Description                                                                                         |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `autoApply`           | `true`           | Apply automatically when a linked worktree is opened                                                |
| `applyToMainWorktree` | `false`          | Also configure the primary working tree                                                             |
| `setupCommands`       | `[]`             | `["npm install", ...]` — commands run **once** on first setup (sequential, stop on first failure)   |
| `runSetupInDevContainer` | `false`       | Run `setupCommands` in dev-container windows too (normally `postCreateCommand` owns bootstrap)      |
| `terminals`           | `[]`             | `[{ "name": "...", "command": "..." }]` — terminals to open (omit/empty `command` → plain terminal) |
| `palette`             | 8 colors         | Candidate titlebar background colors (hex)                                                          |
| `colorOverride`       | `""`             | Force a specific color for this workspace                                                           |
| `injectEnv`           | `true`           | Inject env vars into terminals                                                                      |
| `writeEnvFile`        | `true`           | Write `.env.worktree` for debug/tasks                                                               |
| `branchEnvVar`        | `GIT_BRANCH`     | Branch env var name                                                                                 |
| `colorEnvVar`         | `WORKTREE_COLOR` | Color env var name                                                                                  |
| `openTerminals`       | `true`           | Open the configured terminals                                                                       |
| `gitExcludeWrites`    | `true`           | Add our files to `.git/info/exclude`                                                                |

Example — open a dev server and a shell in every worktree:

```json
"worktreeHelper.terminals": [
  { "name": "dev",   "command": "npm run dev" },
  { "name": "shell" }
]
```

A terminal with no `command` (omitted, or `"command": ""`) opens as a plain terminal — nothing
is run, just a shell in the worktree folder.

Example — install deps and seed local config once per worktree:

```json
"worktreeHelper.setupCommands": [
  "npm install",
  "cp ../main/.env.local .env.local"
]
```

`setupCommands` vs `terminals`: setup commands are run **once** and expected to _finish_ (the
window waits for them before opening terminals); terminals are for long-running processes like
dev servers. Put `npm install` in `setupCommands`, `npm run dev` in `terminals`.

## Commands

- **Worktree Helper: Re-apply Config** — clear the marker and run the pipeline again (re-opens terminals; does **not** re-run setup).
- **Worktree Helper: Run Setup Commands** — re-run `setupCommands` now, ignoring the once-per-worktree marker.
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
- There is no VS Code API to inject env into _all_ debug sessions automatically; `.env.worktree` is
  the portable artifact for that.
