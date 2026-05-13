// Copyright (C) 2022-2023, Samuel Rydh <samuelrydh@gmail.com>
// This code is licensed under the BSD 2-Clause license.

import * as vscode from 'vscode';
import { workspace } from 'vscode';
import { run } from "./util";

export class RepositoryInfo {
    private static selectedRepo: Promise<RepositoryInfo | null> | null = null;

    private constructor(
        public readonly gitDir: string,
        public readonly topLevelDir: string,
    ) { }

    getPathUri(path: string): vscode.Uri {
        return vscode.Uri.joinPath(vscode.Uri.file(this.topLevelDir), path);
    }

    private static async findTopLevelDir(path: string) {
        return await run('git', ['rev-parse', '--show-toplevel'], {
            cwd: path,
        });
    }

    private static async findSuperprojectDir(path: string) {
        return await run('git', [
            'rev-parse', '--show-superproject-working-tree',
        ], { cwd: path, inhibitLogging: true });
    }

    private static async findGitDir(path: string) {
        return await run('git', ['rev-parse', '--absolute-git-dir'], {
            cwd: path,
        });
    }

    private static async create(ws: string) {
        const [topDir, gitDir] = await Promise.all([
            this.findTopLevelDir(ws),
            this.findGitDir(ws),
        ]);
        if (topDir && gitDir)
            return new RepositoryInfo(gitDir, topDir);
        return null;
    }

    static async createForPath(path: string): Promise<RepositoryInfo | null> {
        return this.create(path);
    }

    /**
     * Build a parent stack for navigating out of submodules.
     * Each entry has the parent repo and the relativePath that
     * was active when that parent was the current repo.
     * Returns the stack and the relativePath for the given repo.
     */
    static async buildParentStack(repo: RepositoryInfo): Promise<{
        stack: { repo: RepositoryInfo; relativePath: string }[];
        relativePath: string;
    }> {
        // Walk up to collect parent repos (nearest parent first)
        const parents: RepositoryInfo[] = [];
        let current = repo;
        for (;;) {
            const superDir = await this.findSuperprojectDir(
                current.topLevelDir);
            if (!superDir)
                break;
            const parent = await this.create(superDir);
            if (!parent)
                break;
            parents.push(parent);
            current = parent;
        }
        if (parents.length === 0)
            return { stack: [], relativePath: '' };

        // parents = [immediate parent, ..., root]
        // root is parents[parents.length - 1]
        const path = require('path');
        const rootDir = parents[parents.length - 1].topLevelDir;
        const relativePath = path.relative(
            rootDir, repo.topLevelDir);

        // Build the stack from root to immediate parent
        const stack: { repo: RepositoryInfo; relativePath: string }[] = [];
        for (let i = parents.length - 1; i >= 0; i--) {
            const p = parents[i];
            const relPath = (p.topLevelDir === rootDir)
                ? ''
                : path.relative(rootDir, p.topLevelDir);
            stack.push({ repo: p, relativePath: relPath });
        }
        return { stack, relativePath };
    }

    static async getSelectedRepo(): Promise<RepositoryInfo | null> {
        return this.selectedRepo;
    }

    static setSelectedRepo(repo: RepositoryInfo | null) {
        this.selectedRepo = repo ? Promise.resolve(repo) : null;
    }

    static async lookup(): Promise<RepositoryInfo | null> {
        // Use the active file's directory so that files inside
        // submodules resolve to the submodule's repo
        const activeEditor = vscode.window.activeTextEditor;
        let lookupPath: string | undefined;
        if (activeEditor &&
            activeEditor.document.uri.scheme === 'file') {
            const path = require('path');
            lookupPath = path.dirname(
                activeEditor.document.uri.fsPath);
        }
        if (!lookupPath) {
            lookupPath = workspace.workspaceFolders?.[0]?.uri.path;
        }
        if (!lookupPath)
            return null;

        this.selectedRepo = this.create(lookupPath);
        return this.selectedRepo;
    }
}
