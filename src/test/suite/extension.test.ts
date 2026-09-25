import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { findHunkTargetLine, HunkTarget } from '../../diff-mode';
import { RepoReader } from '../../repo-reader';
import {
    correspondingLine, formatCommitDescription, WorkTree,
} from '../../stgit';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    test('Formats multiline commit descriptions', () => {
        assert.strictEqual(
            formatCommitDescription('Title', 'Title\n\nBody\n'),
            'Title […]');
        assert.strictEqual(
            formatCommitDescription('Title', 'Title\n\n   \n'),
            'Title');
    });

    test('Shows the work-tree expansion state in its header', async () => {
        const reader = new RepoReader({ topLevelDir: '/repo' }, {
            run: async () => '',
            runCommand: async () => ({ stdout: '', stderr: '', ecode: 0 }),
        });
        const workTree = new WorkTree(reader, false);
        assert.deepStrictEqual(workTree.getLines(), ['   ▾ Work Tree',
            '    <no files>']);
        await workTree.toggleExpanded();
        assert.deepStrictEqual(workTree.getLines(), ['   ▸ Work Tree']);
        await workTree.toggleExpanded();
        assert.deepStrictEqual(workTree.getLines(), ['   ▾ Work Tree',
            '    <no files>']);
    });

    test('Shows when untracked files are included, even when collapsed',
        async () => {
            const reader = new RepoReader({ topLevelDir: '/repo' }, {
                run: async () => '',
                runCommand: async () => ({ stdout: '', stderr: '', ecode: 0 }),
            });
            const workTree = new WorkTree(reader, true);
            assert.deepStrictEqual(workTree.getLines(), [
                '   ▾ Work Tree [+untracked]',
                '    <no files>']);
            await workTree.toggleExpanded();
            assert.deepStrictEqual(workTree.getLines(), [
                '   ▸ Work Tree [+untracked]']);
        });

    test('Disables native folding in the StGit document', async () => {
        const extension = vscode.extensions.getExtension('samuelrydh.stgit');
        assert.ok(extension);
        await extension.activate();
        const uri = vscode.Uri.from({ scheme: 'stgit', path: '/StGit' });
        const doc = await vscode.workspace.openTextDocument(uri);
        assert.strictEqual(doc.languageId, 'stgit.buffer');
        const ranges = await vscode.commands.executeCommand<
            vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', uri);
        assert.deepStrictEqual(ranges, []);
    });

    test('Keeps the cursor on its file when a redraw changes line counts',
        () => {
            const before = 'Branch\nIndex\n    Modified  file-a\nWork Tree';
            const after = 'Branch\nIndex\n    Modified  file-b\n' +
                '    Modified  file-a\nWork Tree';
            assert.strictEqual(correspondingLine(before, after, 2), 3);
            assert.strictEqual(correspondingLine(after, before, 3), 2);
            assert.strictEqual(correspondingLine(before, before, 2), 2);
            assert.strictEqual(correspondingLine(before, 'Branch\nIndex', 2),
                1);
            const repeated = 'Branch\nPatch A\n    file-a\n' +
                'Patch B\n    file-a\nEnd';
            const expanded = 'Branch\nPatch A\n    file-a\n' +
                'Patch B\n    file-b\n    file-a\nEnd';
            assert.strictEqual(correspondingLine(repeated, expanded, 4), 5);
        });

    test('Finds the next split after hunks are recombined', () => {
        const lines = [
            'diff --git a/file.txt b/file.txt',
            '--- a/file.txt',
            '+++ b/file.txt',
            '@@ -1,5 +1,5 @@',
            ' one',
            ' TWO',
            ' three',
            '-four',
            '+FOUR',
            ' five',
        ];
        const target: HunkTarget = {
            path: 'file.txt',
            fromLine: 2,
            toLine: 2,
            firstLine: ' three',
            split: true,
        };

        assert.strictEqual(findHunkTargetLine(lines, target, true), 6);
    });

    test('Disambiguates repeated destination coordinates', () => {
        const lines = [
            'diff --git a/file.txt b/file.txt',
            '--- a/file.txt',
            '+++ b/file.txt',
            '@@ -10,4 +10,2 @@',
            ' context',
            '-first',
            '-second',
            ' next',
        ];
        const target: HunkTarget = {
            path: 'file.txt',
            fromLine: 11,
            toLine: 10,
            firstLine: '-second',
            split: true,
        };

        assert.strictEqual(findHunkTargetLine(lines, target, true), 6);
    });

    test('Finds the next full hunk when the previous file disappears', () => {
        const lines = [
            'diff --git a/next.txt b/next.txt',
            '--- a/next.txt',
            '+++ b/next.txt',
            '@@ -20,2 +20,2 @@',
            '-old',
            '+new',
        ];
        const target: HunkTarget = {
            path: 'next.txt',
            fromLine: 19,
            toLine: 19,
            firstLine: '-old',
            split: false,
        };

        assert.strictEqual(findHunkTargetLine(lines, target, true), 3);
    });
});
