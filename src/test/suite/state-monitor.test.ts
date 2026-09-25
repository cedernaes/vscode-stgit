import * as assert from 'assert';
import { StGitStateMonitor } from '../../state-monitor';

suite('StGit state monitor', () => {
    test('reloads only when the external state changes', async () => {
        let state = 'initial';
        let reloads = 0;
        const monitor = new StGitStateMonitor(
            { gitDir: '/repo/.git', topLevelDir: '/repo' }, {
                readState: async () => state,
                watchFiles: () => ({ dispose: () => { /* no resources */ } }),
                reload: () => { reloads++; },
                reloadWorkTree: () => { /* no file changes */ },
            });
        monitor.start();
        try {
            await monitor.check();
            await monitor.check();
            assert.strictEqual(reloads, 0);
            state = 'updated';
            await monitor.check();
            assert.strictEqual(reloads, 1);
            await monitor.check();
            assert.strictEqual(reloads, 1);
        } finally {
            monitor.dispose();
        }
    });

    test('debounces file changes and ignores Git metadata', async () => {
        let changed: ((file: string) => void) | undefined;
        let reloads = 0;
        let disposed = false;
        const monitor = new StGitStateMonitor(
            { gitDir: '/repo/.git', topLevelDir: '/repo' }, {
                readState: async () => 'initial',
                watchFiles: (_repo, callback) => {
                    changed = callback;
                    return { dispose: () => { disposed = true; } };
                },
                reload: () => { /* no series changes */ },
                reloadWorkTree: () => { reloads++; },
            });
        monitor.start();
        try {
            changed!('/repo/.git/index');
            changed!('/repo/file');
            changed!('/repo/file');
            await new Promise(resolve => setTimeout(resolve, 320));
            assert.strictEqual(reloads, 1);
        } finally {
            monitor.dispose();
        }
        assert.strictEqual(disposed, true);
    });
});