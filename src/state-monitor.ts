import * as path from "path";
import type { RepositoryInfo } from "./repo";
import type { runCommand } from "./util";

type Watcher = { dispose(): void };
type MonitoredRepository = Pick<RepositoryInfo, "gitDir" | "topLevelDir">;

export async function readRepositoryState(repo: MonitoredRepository, commandRunner: typeof runCommand): Promise<string> {
    const options = { cwd: repo.topLevelDir, env: { GIT_OPTIONAL_LOCKS: "0" }, inhibitLogging: true };
    const [series, status] = await Promise.all([
        commandRunner("stg", ["series", "-ae", "--commit-id=40", "--description"], options),
        commandRunner("git", ["status", "--porcelain=v2", "-b"], options),
    ]);
    return JSON.stringify([repo.gitDir, series.ecode, series.stdout, status.ecode, status.stdout]);
}

export interface StateMonitorSources {
    readState(repo: MonitoredRepository): Promise<string>;
    watchFiles(repo: MonitoredRepository, changed: (file: string) => void): Watcher;
    reload(): void;
    reloadWorkTree(): void;
}

export class StGitStateMonitor {
    private snapshot: string | null = null;
    private checking = false;
    private watcher: Watcher | null = null;
    private workTreeTimer: NodeJS.Timeout | null = null;
    private interval: NodeJS.Timeout | null = null;
    private disposed = false;

    constructor(
        private repo: MonitoredRepository,
        private readonly sources: StateMonitorSources,
    ) {}

    start() {
        this.watchFiles();
        this.interval = setInterval(() => {
            void this.check();
        }, 2500);
    }

    setRepository(repo: MonitoredRepository) {
        if (this.repo.gitDir === repo.gitDir) return;
        this.repo = repo;
        this.snapshot = null;
        this.watchFiles();
    }

    private watchFiles() {
        this.watcher?.dispose();
        if (this.workTreeTimer) clearTimeout(this.workTreeTimer);
        const repo = this.repo;
        this.watcher = this.sources.watchFiles(repo, (file) => {
            if (file === repo.gitDir || file.startsWith(repo.gitDir + path.sep)) return;
            if (this.workTreeTimer) clearTimeout(this.workTreeTimer);
            this.workTreeTimer = setTimeout(() => {
                if (!this.disposed && this.repo === repo) this.sources.reloadWorkTree();
            }, 250);
        });
    }

    async check() {
        if (this.checking || this.disposed) return;
        this.checking = true;
        const repo = this.repo;
        try {
            const snapshot = await this.sources.readState(repo);
            if (this.disposed || this.repo !== repo) return;
            if (this.snapshot !== null && this.snapshot !== snapshot) this.sources.reload();
            this.snapshot = snapshot;
        } finally {
            this.checking = false;
        }
    }

    dispose() {
        this.disposed = true;
        if (this.interval) clearInterval(this.interval);
        if (this.workTreeTimer) clearTimeout(this.workTreeTimer);
        this.watcher?.dispose();
    }
}
