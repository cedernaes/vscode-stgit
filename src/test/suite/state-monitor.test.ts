import * as assert from "assert";
import { StGitStateMonitor, StateMonitorSources, readRepositoryState } from "../../state-monitor";

const firstRepo = { gitDir: "/first/.git", topLevelDir: "/first" };
const secondRepo = { gitDir: "/second/.git", topLevelDir: "/second" };

function setup(readState: StateMonitorSources["readState"]) {
    let reloads = 0;
    let workTreeReloads = 0;
    let watchedFile: ((file: string) => void) | undefined;
    let disposals = 0;
    const monitor = new StGitStateMonitor(firstRepo, {
        readState,
        watchFiles: (_repo, changed) => {
            watchedFile = changed;
            return {
                dispose: () => {
                    disposals++;
                },
            };
        },
        reload: () => {
            reloads++;
        },
        reloadWorkTree: () => {
            workTreeReloads++;
        },
    });
    monitor.start();
    return {
        monitor,
        changed: (file: string) => watchedFile?.(file),
        get reloads() {
            return reloads;
        },
        get workTreeReloads() {
            return workTreeReloads;
        },
        get disposals() {
            return disposals;
        },
    };
}

suite("StGit state monitor", () => {
    test("samples repository state without optional index locks", async () => {
        const calls: Array<{ command: string; cwd?: string; optionalLocks?: string; inhibitLogging?: boolean }> = [];
        const snapshot = await readRepositoryState(firstRepo, async (command, _args, opts) => {
            calls.push({ command, cwd: opts?.cwd, optionalLocks: opts?.env?.GIT_OPTIONAL_LOCKS, inhibitLogging: opts?.inhibitLogging });
            return { stdout: command, stderr: "", ecode: 0 };
        });
        assert.deepStrictEqual(calls, [
            { command: "stg", cwd: "/first", optionalLocks: "0", inhibitLogging: true },
            { command: "git", cwd: "/first", optionalLocks: "0", inhibitLogging: true },
        ]);
        assert.strictEqual(snapshot, JSON.stringify([firstRepo.gitDir, 0, "stg", 0, "git"]));
    });

    test("reloads only when the external state changes", async () => {
        let state = "initial";
        const subject = setup(async () => state);
        try {
            await subject.monitor.check();
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 0);
            state = "updated";
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 1);
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 1);
        } finally {
            subject.monitor.dispose();
        }
    });

    test("suspends checks and file notifications until resumed", async () => {
        let reads = 0;
        const subject = setup(async () => String(++reads));
        try {
            await subject.monitor.check();
            subject.changed("/first/file");
            subject.monitor.pause();
            assert.strictEqual(subject.disposals, 1);
            await subject.monitor.check();
            await new Promise((resolve) => setTimeout(resolve, 320));
            assert.strictEqual(reads, 1);
            assert.strictEqual(subject.workTreeReloads, 0);
            subject.monitor.resume();
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 0);
            assert.strictEqual(reads, 2);
        } finally {
            subject.monitor.dispose();
        }
    });

    test("does not publish a probe that finishes after the monitor resumes", async () => {
        let finishRead!: (value: string) => void;
        const subject = setup(
            () =>
                new Promise<string>((resolve) => {
                    finishRead = resolve;
                }),
        );
        try {
            const check = subject.monitor.check();
            subject.monitor.pause();
            subject.monitor.resume();
            finishRead("partial state");
            await check;
            assert.strictEqual(subject.reloads, 0);
            const nextCheck = subject.monitor.check();
            finishRead("complete state");
            await nextCheck;
            assert.strictEqual(subject.reloads, 0);
        } finally {
            subject.monitor.dispose();
        }
    });

    test("switches watchers and starts a new baseline for each repo", async () => {
        const subject = setup(async (repo) => repo.gitDir);
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

    test("ignores an old probe after switching repositories", async () => {
        let finish: ((value: string) => void) | undefined;
        const subject = setup((repo) =>
            repo === firstRepo
                ? new Promise<string>((resolve) => {
                      finish = resolve;
                  })
                : Promise.resolve("new repo"),
        );
        try {
            const check = subject.monitor.check();
            subject.monitor.setRepository(secondRepo);
            finish!("old repo");
            await check;
            await subject.monitor.check();
            assert.strictEqual(subject.reloads, 0);
        } finally {
            subject.monitor.dispose();
        }
    });

    test("debounces worktree changes and ignores Git metadata", async () => {
        const subject = setup(async () => "initial");
        try {
            subject.changed("/first/.git/index");
            subject.changed("/first/file");
            subject.changed("/first/file");
            await new Promise((resolve) => setTimeout(resolve, 320));
            assert.strictEqual(subject.workTreeReloads, 1);
            subject.changed("/first/file");
            subject.monitor.setRepository(secondRepo);
            await new Promise((resolve) => setTimeout(resolve, 320));
            assert.strictEqual(subject.workTreeReloads, 1);
        } finally {
            subject.monitor.dispose();
        }
    });
});
