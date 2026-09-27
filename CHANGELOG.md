# Changelog

All notable changes to this extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This extension is a fork of `samuelrydh.stgit`, which was released up to version
0.9.10 from the now archived [srydh/vscode-stgit](https://github.com/srydh/vscode-stgit)
repository. Changes up to that version are documented in its
[changelog](https://github.com/srydh/vscode-stgit/blob/main/CHANGELOG.md).

## [Unreleased]

### Added

- Added support for navigating into and out of submodules with the "Enter" and "-" keys.
- Added a command for copying the commit SHA of the selected patch.
- History entries now honour the effective `format.pretty` Git configuration.
- Commit titles are now followed by an ellipsis when the commit message has a non-empty body.
- Renamed files are now recognized, and their similarity is shown in percent.
- The StGit buffer is now reloaded automatically on external changes.
- The StGit buffer now follows the active repository.
- The StGit buffer now shows whether untracked files are shown.
- Patches and history entries now show a caret (`▸`/`▾`) that make it clear whether they are expanded.

### Changed

- **BREAKING:** The language of the StGit document was renamed from `stgit.buffer` to `stgit-buffer`, since VS Code fails to apply defaults to language IDs containing dots. Settings under `[stgit.buffer]` must be moved to `[stgit-buffer]`.
- The "StGit: Undo Recent Undo" command was renamed to "StGit: Redo Operation" to align with the StGit CLI.
- The force-push command is now titled "StGit: Push Changes (force)" to distinguish it from the regular push.
- Worktree changes are now listed with a single `git diff --raw`, to improve performance.

### Fixed

- A stale diff is now refreshed after staging a hunk, which previously could make splitting hunks use the wrong offset.
- The cursor now stays on the current patch or file when the StGit buffer is redrawn, or near its previous position if the row is gone.
- The StGit buffer is no longer redrawn when a reload leaves its contents unchanged, which previously could disturb cursor movement.
- Native editor folding is now disabled in the StGit buffer, so patches can no longer be folded in a way that breaks expanding/collapsing them.

## [Previous releases]

See https://github.com/srydh/vscode-stgit for previous releases.
