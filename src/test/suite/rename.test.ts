import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';
import { Delta, WorkTree } from '../../stgit';
import { DiffProvider } from '../../diff-provider';
import { RepositoryInfo } from '../../repo';
import { RepoReader } from '../../repo-reader';
import { run, runCommand } from '../../util';

suite('Rename Test Suite', () => {
    test('Displays renames with Git similarity scores', () => {
        const changes = Delta.fromDiff(
            ':100644 100644 abc123 def456 R091\0old.txt\0new.txt\0');
        assert.strictEqual(changes.length, 1);
        assert.strictEqual(changes[0].docLine.trim(),
            'Rename 91%       old.txt -> new.txt');
    });

    test('Lists moves separately until staged or committed', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stgit-rename-'));
        const previousRepo = await RepositoryInfo.getSelectedRepo();
        const git = (...args: string[]) => execFileSync('git', args, {
            cwd: dir, encoding: 'utf8',
        });
        try {
            git('init', '-q');
            git('config', 'user.name', 'Test');
            git('config', 'user.email', 'test@example.org');
            await fs.writeFile(path.join(dir, 'old.txt'), 'line\n'.repeat(30));
            git('add', '.');
            git('commit', '-qm', 'initial');
            await fs.rename(
                path.join(dir, 'old.txt'), path.join(dir, 'new.txt'));
            await fs.writeFile(path.join(dir, 'other.txt'), 'untracked\n');
            const repo = await RepositoryInfo.createForPath(dir);
            assert.ok(repo);
            RepositoryInfo.setSelectedRepo(repo);

            const reader = new RepoReader(repo, { run, runCommand });
            const workTree = new WorkTree(reader, true);
            await workTree.fetchDetails();
            assert.strictEqual(workTree.deltas.length, 3);
            assert.ok(workTree.deltas[0].docLine.includes('Deleted'));
            assert.ok(workTree.deltas[0].docLine.includes('old.txt'));
            assert.ok(workTree.deltas[1].docLine.includes('new.txt'));
            assert.ok(workTree.deltas[2].docLine.includes('other.txt'));
            assert.ok(workTree.deltas.every(
                delta => !delta.docLine.includes('Rename')));
            const hiddenWorkTree = new WorkTree(reader, false);
            await hiddenWorkTree.fetchDetails();
            assert.strictEqual(hiddenWorkTree.deltas.length, 1);
            assert.strictEqual(git('diff', '--cached', '--name-only'), '');

            git('add', '-A', '--', 'old.txt', 'new.txt');
            const staged = Delta.fromDiff(git('diff-index',
                '--find-renames', '-z', '--cached', 'HEAD'));
            assert.strictEqual(staged.length, 1);
            assert.ok(staged[0].docLine.includes('Rename 100%'));
            assert.strictEqual(staged[0].destPath, 'new.txt');
            const provider = Object.create(
                DiffProvider.prototype) as DiffProvider;
            const stagedDiff = await provider.provideDiff(vscode.Uri.parse(
                'stgit-diff:///diff-index-old.txt' +
                '#index,file=old.txt,dest=new.txt'));
            assert.ok(stagedDiff.includes('rename from old.txt'));
            assert.ok(stagedDiff.includes('rename to new.txt'));

            git('commit', '-qm', 'rename');
            const committed = Delta.fromDiff(git('diff-tree',
                '--find-renames', '-z', '--no-commit-id', '-r', 'HEAD'));
            assert.strictEqual(committed.length, 1);
            assert.ok(committed[0].docLine.includes('Rename 100%'));
            const sha = git('rev-parse', 'HEAD').trim();
            const committedDiff = await provider.provideDiff(vscode.Uri.parse(
                `stgit-diff:///diff-${sha.slice(0, 5)}-old.txt` +
                `#sha=${sha},file=old.txt,dest=new.txt`));
            assert.ok(committedDiff.includes('rename from old.txt'));
            assert.ok(committedDiff.includes('rename to new.txt'));
        } finally {
            RepositoryInfo.setSelectedRepo(previousRepo);
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});