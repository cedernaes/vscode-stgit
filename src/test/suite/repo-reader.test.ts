import * as assert from 'assert';
import { LatestLoad, RepoReader } from '../../repo-reader';

suite('Repo-bound display loads', () => {
    const unexpectedError = (error: unknown) => { assert.fail(String(error)); };
    test('uses the repository captured at construction', async () => {
        const calls: string[] = [];
        const repo = { topLevelDir: '/first' };
        const commands = {
            run: async (_command: 'git' | 'stg', _args: string[],
                opts?: { cwd?: string }) => {
                calls.push(opts?.cwd ?? '');
                return '';
            },
            runCommand: async (_command: 'git' | 'stg', _args: string[],
                opts?: { cwd?: string }) => {
                calls.push(opts?.cwd ?? '');
                return { stdout: '', stderr: '', ecode: 0 };
            },
        };
        const reader = new RepoReader(repo, commands);
        repo.topLevelDir = '/second';
        await reader.run('git', ['status'], { cwd: '/override' });
        await reader.runCommand('stg', ['series']);
        assert.deepStrictEqual(calls, ['/first', '/first']);
    });

    test('only publishes the most recent load', async () => {
        const gate = new LatestLoad();
        const shown: string[] = [];
        let finishOld: ((value: string) => void) | undefined;
        const old = gate.run(
            () => new Promise<string>(resolve => { finishOld = resolve; }),
            value => shown.push(value), unexpectedError);
        await gate.run(async () => 'new', value => shown.push(value),
            unexpectedError);
        finishOld!('old');
        await old;
        assert.deepStrictEqual(shown, ['new']);
        gate.invalidate();
        let finishCurrent: ((value: string) => void) | undefined;
        const current = gate.run(
            () => new Promise<string>(resolve => { finishCurrent = resolve; }),
            value => shown.push(value), unexpectedError);
        gate.invalidate();
        finishCurrent!('stale');
        await current;
        assert.deepStrictEqual(shown, ['new']);
    });

    test('ignores old repo results after switching', async () => {
        const directories: string[] = [];
        const shown: string[] = [];
        let finishOld: ((value: string) => void) | undefined;
        const commands = {
            run: async (_command: 'git' | 'stg', _args: string[],
                opts?: { cwd?: string }) => {
                directories.push(opts?.cwd ?? '');
                return opts?.cwd === '/old' ?
                    new Promise<string>(resolve => { finishOld = resolve; }) :
                    'new result';
            },
            runCommand: async () => ({ stdout: '', stderr: '', ecode: 0 }),
        };
        const gate = new LatestLoad();
        const oldReader = new RepoReader({ topLevelDir: '/old' }, commands);
        const old = gate.run(() => oldReader.run('git', ['status']),
            result => shown.push(result), unexpectedError);
        gate.invalidate();
        const newReader = new RepoReader({ topLevelDir: '/new' }, commands);
        await gate.run(() => newReader.run('git', ['status']),
            result => shown.push(result), unexpectedError);
        finishOld!('old result');
        await old;
        assert.deepStrictEqual(directories, ['/old', '/new']);
        assert.deepStrictEqual(shown, ['new result']);
    });
});