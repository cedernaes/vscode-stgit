import * as path from 'path';

interface Repository { gitDir: string }

export interface RepositoryFollowerSources<Repo extends Repository, Context> {
    lookup(directory: string): Promise<Repo | null>;
    current(): Repo | null;
    loadContext(repo: Repo): Promise<Context>;
    switchTo(repo: Repo, context: Context): void;
}

export class RepositoryFollower<Repo extends Repository, Context> {
    private requestId = 0;

    constructor(
        private readonly sources: RepositoryFollowerSources<Repo, Context>,
    ) { }

    async followFile(file: string) {
        const requestId = ++this.requestId;
        const repo = await this.sources.lookup(path.dirname(file));
        if (!repo || requestId !== this.requestId ||
            repo.gitDir === this.sources.current()?.gitDir)
            return;
        const context = await this.sources.loadContext(repo);
        if (requestId === this.requestId && this.sources.current() &&
            repo.gitDir !== this.sources.current()?.gitDir)
            this.sources.switchTo(repo, context);
    }

    cancel() {
        this.requestId++;
    }
}