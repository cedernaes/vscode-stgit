# StGit VSCode Support

> A maintained fork of [srydh/vscode-stgit](https://github.com/srydh/vscode-stgit). This fork is a drop-in replacement.

The main purpose of this extension is making it easy to modify, amend, reorder, squash or split commits during development with VSCode.

This extension provides a frontend to StGit, which is an external command line tool for managing patch series in the form of Git commits. Refer to the [StGit homepage](https://stacked-git.github.io/) for more details about StGit.

The functionality of this extension is heavily inspired by a corresponding Emacs mode for StGit, originally written by David Kågedal.

Install [StGit Revived](https://marketplace.visualstudio.com/items?itemName=cedernaes.stgit-revived) from the VS Code Marketplace.

## Features

The StGit patch series is displayed as a table in a webview. Status symbols distinguish applied and popped patches as well as modified, added, deleted, and conflicted files. A loading indicator appears while StGit commands or status reads are running. StGit and Git operations are available through the existing keyboard shortcuts when the webview is focused.

Use the arrow keys to select patches and files, Enter to expand a patch or open a file, and `m`/`u` to mark or unmark patches. Commit messages open in the webview; use `Ctrl-C Ctrl-C` or the Commit button to submit. Press Escape to cancel; you are asked to confirm only if the message has unsaved changes.

The extension also provides an Emacs-like diff mode, which among other things allows individual hunks to be applied, staged or split into smaller hunks.

While the StGit window is open, it follows the repository of the active file, including files in submodules.

> [!TIP]
>
> To enter StGit, press `Ctrl-C Ctrl-I` or run the "`StGit: Open...`"
> command. In the `StGit` window, press `h` to list all available StGit
> operations.

## Requirements

This extension requires StGit to be installed (the executable is called `stg`). The tool is available in most distributions (e.g. through "`brew install stgit`" on macOS). It can also be downloaded from GitHub [here](https://stacked-git.github.io).

> [!IMPORTANT]
>
> **You must uninstall the original `samuelrydh.stgit` extension before installing this one.** Both contribute the same command and language identifiers, and VSCode has no way to resolve the conflict.

## Configuration

### Git History Format

Git history entries use the effective `format.pretty` Git configuration. Custom `format:` and `tformat:` values and named `pretty.<name>` aliases are supported. Multiline output is flattened to one line, and terminal colors are omitted. If no reusable one-line format is configured, the extension uses `%h   %s`.

## Development

Starting any Extension Development Host debug configuration builds both the extension and the React webview before starting the background watch task. Subsequent webview JS/CSS rebuilds automatically reload the open StGit panel in the development host, preserving its selection, draft, and scroll position. For extension-host code changes, reload the Extension Development Host window to load the newly compiled code. Run `npm run compile` for a one-off build or `npm run watch` outside debugging; restart an older watch process after changing the build scripts. `npm run test:unit` includes a DOM test of the compiled webview; `npm test` runs the VS Code extension-host suite when its test executable is available.

## Known Issues

Vim extensions may intercept some StGit keyboard shortcuts in the webview. Closing the StGit tab while editing a commit message discards the draft; cancel the editor before closing to get a confirmation.

## Release Notes

The latest release notes are available [here](https://github.com/cedernaes/vscode-stgit/blob/main/CHANGELOG.md).
