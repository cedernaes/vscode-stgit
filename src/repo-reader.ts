import type { run, runCommand } from './util';

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

    run(
        command: Parameters<typeof run>[0],
        args: string[],
        opts?: Parameters<typeof run>[2],
    ) {
        return this.commands.run(command, args, { ...opts, cwd: this.cwd });
    }

    runCommand(
        command: Parameters<typeof runCommand>[0],
        args: string[],
        opts?: Parameters<typeof runCommand>[2],
    ) {
        return this.commands.runCommand(command, args,
            { ...opts, cwd: this.cwd });
    }
}

export class LatestLoad {
    private version = 0;

    invalidate() {
        this.version++;
    }

    async run<T>(
        read: () => Promise<T>,
        publish: (value: T) => void,
        onError: (error: unknown) => void,
    ) {
        const version = ++this.version;
        let value: T;
        try {
            value = await read();
        } catch (error) {
            if (version === this.version)
                onError(error);
            return;
        }
        if (version === this.version)
            publish(value);
    }
}

export class RepoDisplayLoads {
    private reader: RepoReader;
    private readonly series = new LatestLoad();
    private readonly changes = new LatestLoad();

    constructor(
        repo: { topLevelDir: string },
        private readonly commands: {
            run: typeof run;
            runCommand: typeof runCommand;
        },
        private readonly onError: (
            kind: 'series' | 'changes', error: unknown,
        ) => void,
    ) {
        this.reader = new RepoReader(repo, commands);
    }

    get currentReader() {
        return this.reader;
    }

    switchRepository(repo: { topLevelDir: string }) {
        this.series.invalidate();
        this.changes.invalidate();
        this.reader = new RepoReader(repo, this.commands);
    }

    loadSeries<T>(
        read: (reader: RepoReader) => Promise<T>,
        publish: (value: T) => void,
    ) {
        const reader = this.reader;
        return this.series.run(() => read(reader), publish,
            error => this.onError('series', error));
    }

    loadChanges<T>(
        read: (reader: RepoReader) => Promise<T>,
        publish: (value: T) => void,
    ) {
        const reader = this.reader;
        return this.changes.run(() => read(reader), publish,
            error => this.onError('changes', error));
    }

    dispose() {
        this.series.invalidate();
        this.changes.invalidate();
    }
}