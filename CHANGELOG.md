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
- Add support for navigating into/out of submodules with "Enter" and "-" keys.
- Add a command for copying the commit SHA of the selected patch
- Honour the effective `format.pretty` Git configuration in history entries
- Show ellipses after commit titles that have a non-empty message body

### Changed
- Let the user switch branch when only submodules are changed.
- Rename "StGit: Undo recent undo" command to "StGit: Redo Operation" to align with the stgit CLI
