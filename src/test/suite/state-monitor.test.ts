import * as assert from 'assert';
import { StGitStateMonitor, StateMonitorSources } from '../../state-monitor';

const firstRepo = { gitDir: '/first/.git', topLevelDir: '/first' };
const secondRepo = { gitDir: '/second/.git', topLevelDir: '/second' };

function setup(readState: StateMonitorSources['readState']) {
    let reloads = 0;
    let workTreeReloads = 0;
    let watchedFile: ((file: string) => void) | undefined;
    let disposals = 0;
    const monitor = new StGitStateMonitor(firstRepo, {
        readState,
        watchFiles: (_repo, changed) => {
            watchedFile = changed;
            return { dispose: () => { disposals++; } };
        },
        reload: () => { reloads++; },
        reloadWorkTree: () => { workTreeReloads++; },
    });
    monitor.start();
    return {
        monitor,
        changed: (file: string) => watchedFile?.(file),
        get reloads() { return reloads; },
        get workTreeReloads() { return workTreeReloads; },
        get disposals() { return disposals; },
    };
}

suite('StGit state monitor', () => {
    test('reloads only when the external state changes', async () => {
        let state = 'initial';
        const subject = setup(async () => state);
        try {
            await subject.monitor.check();
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 0);
            state = 'updated';
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 1);
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 1);
        } finally {
            subject.monitor.dispose();
        }
    });

    test('switches watchers and starts a new baseline for each repo',
        async () => {
            const subject = setup(async repo => repo.gitDir);
            try {
                await subject.monitor.check();
                subject.monitor.setRepository(secondRepo);
                assert.strictEqual(subject.disposals, 1);
                await subject.monitor.check();
                assert.strictEqual(subject.reloads, 0);
                subject.monitor.dispose();
                assert.strictEqual(subject.disposals, 2);
            } finally {
                subject.monitor.dispose();
            }
        });

    test('ignores an old probe after switching repositories', async () => {
        let finish: ((value: string) => void) | undefined;
        const subject = setup(repo => repo === firstRepo ?
            new Promise<string>(resolve => { finish = resolve; }) :
            Promise.resolve('new repo'));
        try {
            const check = subject.monitor.check();
            subject.monitor.setRepository(secondRepo);
            finish!('old repo');
            await check;
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 0);
        } finally {
            subject.monitor.dispose();
        }
    });

    test('debounces worktree changes and ignores Git metadata', async () => {
        const subject = setup(async () => 'initial');
        try {
            subject.changed('/first/.git/index');
            subject.changed('/first/file');
            subject.changed('/first/file');
            await new Promise(resolve => setTimeout(resolve, 320));
            assert.strictEqual(subject.workTreeReloads, 1);
            subject.changed('/first/file');
            subject.monitor.setRepository(secondRepo);
            await new Promise(resolve => setTimeout(resolve, 320));
            assert.strictEqual(subject.workTreeReloads, 1);
        } finally {
            subject.monitor.dispose();
        }
    });
});