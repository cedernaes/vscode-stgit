import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
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
});
