import type { run, runCommand } from "./util";

export class RepoReader {
    readonly cwd: string;

    constructor(
        repo: { topLevelDir: string },
        private readonly commands: {
            run: typeof run;
            runCommand: typeof runCommand;
        },
    ) {
        this.cwd = repo.topLevelDir;
    }

    run(command: Parameters<typeof run>[0], args: string[], opts?: Parameters<typeof run>[2]) {
        return this.commands.run(command, args, { ...opts, env: { GIT_OPTIONAL_LOCKS: "0", ...opts?.env }, cwd: this.cwd });
    }

    runCommand(command: Parameters<typeof runCommand>[0], args: string[], opts?: Parameters<typeof runCommand>[2]) {
        return this.commands.runCommand(command, args, { ...opts, env: { GIT_OPTIONAL_LOCKS: "0", ...opts?.env }, cwd: this.cwd });
    }
}

export class LatestLoad {
    private version = 0;
    private loading = false;

    constructor(private readonly onLoadingChange: (loading: boolean) => void = () => undefined) {}

    private setLoading(loading: boolean) {
        if (this.loading !== loading) {
            this.loading = loading;
            this.onLoadingChange(loading);
        }
    }

    invalidate() {
        this.version++;
        this.setLoading(false);
    }

    async run<T>(read: () => Promise<T>, publish: (value: T) => void, onError: (error: unknown) => void) {
        const version = ++this.version;
        this.setLoading(true);
        try {
            const value = await read();
            if (version === this.version) {
                publish(value);
            }
        } catch (error) {
            if (version === this.version) {
                onError(error);
            }
        } finally {
            if (version === this.version) {
                this.setLoading(false);
            }
        }
    }
}

export class RepoDisplayLoads {
    private reader: RepoReader;
    private readonly series = new LatestLoad((loading) => this.updateLoading("series", loading));
    private readonly changes = new LatestLoad((loading) => this.updateLoading("changes", loading));
    private paused = false;
    private disposed = false;
    private seriesLoading = false;
    private changesLoading = false;

    constructor(
        repo: { topLevelDir: string },
        private readonly commands: {
            run: typeof run;
            runCommand: typeof runCommand;
        },
        private readonly onError: (kind: "series" | "changes", error: unknown) => void,
        private readonly onLoadingChange: (loading: boolean) => void = () => undefined,
    ) {
        this.reader = new RepoReader(repo, commands);
    }

    private updateLoading(kind: "series" | "changes", loading: boolean) {
        const wasLoading = this.seriesLoading || this.changesLoading;
        if (kind === "series") {
            this.seriesLoading = loading;
        } else {
            this.changesLoading = loading;
        }
        const isLoading = this.seriesLoading || this.changesLoading;
        if (wasLoading !== isLoading) {
            this.onLoadingChange(isLoading);
        }
    }

    get currentReader() {
        return this.reader;
    }

    pause() {
        this.paused = true;
        this.series.invalidate();
        this.changes.invalidate();
    }

    resume() {
        if (this.disposed) {
            return;
        }
        this.paused = false;
    }

    switchRepository(repo: { topLevelDir: string }) {
        this.series.invalidate();
        this.changes.invalidate();
        this.reader = new RepoReader(repo, this.commands);
    }

    loadSeries<T>(read: (reader: RepoReader) => Promise<T>, publish: (value: T) => void) {
        if (this.paused || this.disposed) {
            return Promise.resolve();
        }
        const reader = this.reader;
        return this.series.run(
            () => read(reader),
            publish,
            (error) => this.onError("series", error),
        );
    }

    loadChanges<T>(read: (reader: RepoReader) => Promise<T>, publish: (value: T) => void) {
        if (this.paused || this.disposed) {
            return Promise.resolve();
        }
        const reader = this.reader;
        return this.changes.run(
            () => read(reader),
            publish,
            (error) => this.onError("changes", error),
        );
    }

    dispose() {
        this.disposed = true;
        this.series.invalidate();
        this.changes.invalidate();
    }
}
