import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { findHunkTargetLine, HunkTarget } from '../../diff-mode';
import { formatCommitDescription } from '../../stgit';

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
