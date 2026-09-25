import * as assert from 'assert';
import { RepoDisplayLoads, RepoReader } from '../../repo-reader';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

suite('Repository display loads', () => {
    test('keeps old reads in their repo without publishing them', async () => {
        const oldSeries = deferred<string>();
        const oldIndex = deferred<string>();
        const calls: string[] = [];
        const commands = {
            run: async (_command: 'git' | 'stg', args: string[],
                opts?: { cwd?: string }) => {
                const key = `${opts?.cwd}:${args[0]}`;
                calls.push(key);
                if (key === '/old:branch')
                    return oldSeries.promise;
                if (key === '/old:index')
                    return oldIndex.promise;
                return key;
            },
            runCommand: async () => ({ stdout: '', stderr: '', ecode: 0 }),
        };
        const errors: unknown[] = [];
        const loads = new RepoDisplayLoads(
            { topLevelDir: '/old' }, commands,
            (_kind, error) => errors.push(error));
        const displayed: { series?: string[]; changes?: string[] } = {};
        const readSeries = (reader: RepoReader) => Promise.all([
            reader.run('git', ['branch']),
            reader.run('git', ['patch']),
            reader.run('git', ['history']),
        ]);
        const readChanges = (reader: RepoReader) => Promise.all([
            reader.run('git', ['index']),
            reader.run('git', ['worktree']),
        ]);
        const old = loads.loadSeries(readSeries,
            result => { displayed.series = result; });
        const oldChanges = loads.loadChanges(readChanges,
            result => { displayed.changes = result; });
        loads.switchRepository({ topLevelDir: '/new' });
        await Promise.all([
            loads.loadSeries(readSeries,
                result => { displayed.series = result; }),
            loads.loadChanges(readChanges,
                result => { displayed.changes = result; }),
        ]);
        oldSeries.resolve('/old:branch');
        oldIndex.resolve('/old:index');
        await Promise.all([old, oldChanges]);
        assert.deepStrictEqual(displayed, {
            series: ['/new:branch', '/new:patch', '/new:history'],
            changes: ['/new:index', '/new:worktree'],
        });
        assert.deepStrictEqual(errors, []);
        assert.strictEqual(calls.filter(call => call.startsWith('/old:'))
            .length, 5);
        assert.strictEqual(calls.filter(call => call.startsWith('/new:'))
            .length, 5);
        loads.dispose();
    });

    test('ignores older results from the same repository', async () => {
        const firstSeries = deferred<string>();
        const firstChanges = deferred<string>();
        const errors: unknown[] = [];
        const loads = new RepoDisplayLoads(
            { topLevelDir: '/repo' }, {
                run: async () => '',
                runCommand: async () => ({ stdout: '', stderr: '', ecode: 0 }),
            }, (_kind, error) => errors.push(error));
        const shown: string[] = [];
        const oldSeries = loads.loadSeries(() => firstSeries.promise,
            result => shown.push(result));
        const oldChanges = loads.loadChanges(() => firstChanges.promise,
            result => shown.push(result));
        await loads.loadSeries(async () => 'new series',
            result => shown.push(result));
        await loads.loadChanges(async () => 'new changes',
            result => shown.push(result));
        firstSeries.resolve('old series');
        firstChanges.resolve('old changes');
        await Promise.all([oldSeries, oldChanges]);
        assert.deepStrictEqual(shown, ['new series', 'new changes']);
        assert.deepStrictEqual(errors, []);
        loads.dispose();
    });

    test('reports current failures, ignores stale failures and recovers',
        async () => {
            const oldFailure = deferred<string>();
            const failures: string[] = [];
            const loads = new RepoDisplayLoads(
                { topLevelDir: '/old' }, {
                    run: async () => '',
                    runCommand: async () => ({
                        stdout: '', stderr: '', ecode: 0,
                    }),
                }, (kind, error) => failures.push(`${kind}: ${error}`));
            const shown: string[] = [];
            const old = loads.loadSeries(() => oldFailure.promise,
                result => shown.push(result));
            loads.switchRepository({ topLevelDir: '/new' });
            oldFailure.reject(new Error('old failure'));
            await old;
            await loads.loadChanges(async (): Promise<string> => {
                throw new Error('new failure');
            }, result => shown.push(result));
            assert.deepStrictEqual(failures, ['changes: Error: new failure']);
            assert.strictEqual(shown.length, 0);
            await loads.loadChanges(async () => 'recovered',
                result => shown.push(result));
            assert.deepStrictEqual(shown, ['recovered']);
            loads.dispose();
        });

    test('discards completed and failed reads after disposal', async () => {
        const series = deferred<string>();
        const changes = deferred<string>();
        const failures: unknown[] = [];
        const shown: string[] = [];
        const loads = new RepoDisplayLoads(
            { topLevelDir: '/repo' }, {
                run: async () => '',
                runCommand: async () => ({
                    stdout: '', stderr: '', ecode: 0,
                }),
            }, (_kind, error) => failures.push(error));
        const pendingSeries = loads.loadSeries(() => series.promise,
            result => shown.push(result));
        const pendingChanges = loads.loadChanges(() => changes.promise,
            result => shown.push(result));
        loads.dispose();
        series.resolve('late series');
        changes.reject(new Error('late failure'));
        await Promise.all([pendingSeries, pendingChanges]);
        assert.deepStrictEqual(shown, []);
        assert.deepStrictEqual(failures, []);
    });
});