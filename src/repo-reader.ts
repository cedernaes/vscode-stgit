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

    async run<T>(read: () => Promise<T>, publish: (value: T) => void) {
        const version = ++this.version;
        const value = await read();
        if (version === this.version)
            publish(value);
    }
}