// Copyright (C) 2022-2023, Samuel Rydh <samuelrydh@gmail.com>
// This code is licensed under the BSD 2-Clause license.

import * as vscode from "vscode";
import { commands, window, workspace } from "vscode";
import { confirmCommentDiscard } from "./comment-discard";
import { getStGitConfig } from "./config";
import { openAndShowDiffDocument, refreshDiff } from "./diff-provider";
import { getUserConfirmation, info, log, showStatusMessage } from "./extension";
import { uncommitFiles } from "./git";
import { MutationGate } from "./mutation-gate";
import { RepositoryInfo } from "./repo";
import { RepoDisplayLoads, RepoReader } from "./repo-reader";
import { RepositoryFollower } from "./repository-follower";
import { StGitStateMonitor, readRepositoryState } from "./state-monitor";
import { StGitViewState, stgitWebviewHtml } from "./stgit-webview";
import { run, runAndReportErrors, runCommand } from "./util";

const RENAMEOPTS: readonly string[] = ["--find-renames"];

interface IndexStageInfo {
    perm: string;
    sha: string;
    stage: number;
}
type DeltaKind = keyof typeof Delta.STATUS_MESSAGE;

export class Delta {
    private indexStageInfo: IndexStageInfo[] = [];

    static readonly STATUS_MESSAGE = {
        M: "Modified",
        D: "Deleted",
        A: "Added",
        O: "<unknown>",
        U: "Unresolved",
        R: "Rename",
        C: "Copy",
        T: "FileType",
        X: "X-Unknown",
    };

    constructor(
        private readonly srcMode: string,
        private readonly destMode: string,
        readonly srcSha: string,
        readonly destSha: string,
        private readonly status: DeltaKind,
        private readonly score: string,
        readonly path: string,
        readonly destPath: string | undefined,
    ) {}

    attachIndexStageInfo(stageInfo: IndexStageInfo[]) {
        this.indexStageInfo = stageInfo;
    }

    get deleted() {
        return this.status.startsWith("D");
    }
    get conflict() {
        return this.status.startsWith("U");
    }
    get isSubmodule() {
        return this.srcMode === "160000" || this.destMode === "160000";
    }
    private get stageInfoString() {
        if (!this.indexStageInfo.length) {
            return "";
        }
        const m = this.indexStageInfo.reduce((s, e) => s | (1 << (e.stage - 1)), 0);
        if (m === 3) {
            return "(deleted by them)";
        }
        if (m === 5) {
            return "(deleted by us)";
        }
        if (m === 6) {
            return "(added by both)";
        }
        if (m === 7) {
            return "";
        }
        return `(stage ${m})`;
    }
    private get permissionDelta(): string {
        const [sMode, dMode] = [this.srcMode, this.destMode];
        if (this.status !== "U" && sMode !== "100755" && dMode === "100755") {
            return " +x";
        } else if (sMode === "100755" && dMode === "100644") {
            return " -x";
        }
        return "";
    }
    get docLine() {
        const what = Delta.STATUS_MESSAGE[this.status];
        const similarity = this.status === "R" ? ` ${Number(this.score)}%` : "";
        const s = `${what}${similarity}${this.permissionDelta}`;
        const dest = this.destPath ? ` -> ${this.destPath}` : "";
        const submoduleMarker = this.isSubmodule ? " [submodule]" : "";
        const s2 = `     ${s.padEnd(16)} ${this.path}${dest}${submoduleMarker}`;
        const sinfo = this.stageInfoString;
        if (!sinfo && !dest && !submoduleMarker) {
            return s2;
        }
        return `${s2.padEnd(50)} ${sinfo}`;
    }
    get statusLabel() {
        const similarity = this.status === "R" ? ` ${Number(this.score)}%` : "";
        return `${Delta.STATUS_MESSAGE[this.status]}${similarity}${this.permissionDelta}${this.stageInfoString ? ` ${this.stageInfoString}` : ""}`;
    }
    get kind() {
        return this.status;
    }
    static fromDiff(diffOutput: string): Delta[] {
        const entries: Delta[] = [];
        for (let s = diffOutput; ;) {
            const i0 = s.indexOf("\0");
            const spec = s.slice(1, i0);
            const [sMode, dMode, srcSha, destSha, status] = spec.split(" ");

            const i1 = s.indexOf("\0", i0 + 1);
            if (i1 < 0) {
                break;
            }
            const name = s.slice(i0 + 1, i1);

            let destName = undefined;
            if (status[0] === "R" || status[0] === "C") {
                const i2 = s.indexOf("\0", i1 + 1);
                destName = s.slice(i1 + 1, i2);
                s = s.slice(i2 + 1);
            } else {
                s = s.slice(i1 + 1);
            }
            const score = status.slice(1);
            const kind: DeltaKind = status[0] in Delta.STATUS_MESSAGE ? (status[0] as DeltaKind) : "X";
            entries.push(new Delta(sMode, dMode, srcSha, destSha, kind, score, name, destName));
        }
        return entries;
    }
}

abstract class Patch {
    protected expanded = false;
    marked = false;
    deltas: Delta[] = [];
    protected sha: string | null = null;
    private detailsFetcher: Promise<void> | null = null;
    private commitMessage: string | null = null;

    // Line number for this patch in the StGit window
    lineNum = 0;
    // Number of lines displayed in the StGit window
    lineCount = 0;

    constructor(
        protected readonly reader: RepoReader,
        public readonly description: string,
        public readonly label: string,
        public readonly kind: "+" | "-" | "H" | "I" | "W",
        public readonly empty: boolean,
        private readonly symbol: "+" | "-" | ">" | " " = " ",
    ) {}

    get rowId(): string {
        return `${this.kind}:${this.kind === "H" ? this.sha : this.label}`;
    }

    get isExpanded(): boolean {
        return this.expanded;
    }

    get statusSymbol(): string {
        return this.symbol;
    }

    async updateFromOld(old: Patch) {
        this.marked = old.marked;
        if (this.expanded !== old.expanded) {
            await this.toggleExpanded();
        }
    }
    getLines(): string[] {
        const m = this.marked ? "*" : " ";
        const empty = this.empty ? "(empty) " : "";
        const caret = this.expanded ? "▾" : "▸";
        const lines = [`${this.symbol}${m} ${caret} ${empty}${this.description}`];
        if (this.expanded) {
            for (const d of this.deltas) {
                lines.push(d.docLine);
            }
            if (!this.deltas.length) {
                lines.push("     <no files>");
            }
        }
        return lines;
    }
    updateLineSpan(lineNum: number, lineCount: number) {
        this.lineNum = lineNum;
        this.lineCount = lineCount;
    }

    protected abstract doFetchDetails(): Promise<void>;

    setMarked(marked: boolean): boolean {
        if (this.kind !== "+" && this.kind !== "-") {
            return false;
        }
        const changed = this.marked !== marked;
        this.marked = marked;
        return changed;
    }

    fetchDetails(): Promise<void> {
        if (!this.detailsFetcher) {
            this.detailsFetcher = this.doFetchDetails();
        }
        return this.detailsFetcher;
    }

    async getSha(): Promise<string | null> {
        await this.fetchDetails();
        return this.sha;
    }

    async getCommitMessage(): Promise<string | null> {
        if (!this.commitMessage) {
            const sha = await this.getSha();
            if (sha) {
                this.commitMessage = await this.reader.run("git", ["show", "-s", "--format=%B", sha]);
            }
        }
        return this.commitMessage;
    }

    async toggleExpanded() {
        await this.fetchDetails();
        this.expanded = !this.expanded;
    }
}

export function formatCommitDescription(description: string, commitMessage: string): string {
    const hasBody = commitMessage
        .split(/\r?\n/)
        .slice(1)
        .some((line) => line.trim() !== "");
    return hasBody ? `${description} […]` : description;
}

export class StGitPatch extends Patch {
    static fromSeries(line: string, commitMessage: string, reader: RepoReader): Patch {
        const empty = line[0] === "0";
        const kind = line[1] === "-" ? "-" : "+";
        const symbol = line[1] as "+" | "-" | ">";
        const sha = line.slice(3, 43);
        const [name, ...description] = line.slice(44).split("#");
        const label = name.trim();
        const desc = description.join("#").trim();
        const patch = new this(reader, formatCommitDescription(desc, commitMessage), label, kind, empty, symbol);
        patch.sha = sha;
        return patch;
    }
    protected async doFetchDetails(): Promise<void> {
        this.sha = await this.reader.run("stg", ["id", "--", this.label]);
        const tree = await this.reader.run("git", ["diff-tree", ...RENAMEOPTS, "-z", "--no-commit-id", "-r", this.sha]);
        this.deltas = Delta.fromDiff(tree);
    }
}

export class WorkTree extends Patch {
    constructor(
        reader: RepoReader,
        private readonly unknownFilesVisible: boolean,
    ) {
        super(reader, `Work Tree${unknownFilesVisible ? " [+untracked]" : ""}`, "", "W", false);
        this.expanded = true;
    }
    private async fetchUnknownFiles(): Promise<string> {
        if (!this.unknownFilesVisible) {
            return "";
        }
        const unknownFiles = await this.reader.run("git", ["ls-files", "--exclude-standard", "-o", "-z"]);
        return unknownFiles
            .split("\0")
            .filter((name) => name)
            .map((name) => ":000000 000000" + " 0000000000000000000000000000000000000000" + " 0000000000000000000000000000000000000000" + ` O\0${name}\0`)
            .join("");
    }
    protected async doFetchDetails(): Promise<void> {
        const result = await Promise.all([this.reader.run("git", ["diff", "--raw", "--no-renames", "-z"]), this.fetchUnknownFiles()]);
        this.deltas = Delta.fromDiff(result.join(""));
    }
}

class Index extends Patch {
    constructor(reader: RepoReader) {
        super(reader, "Index", "", "I", false);
        this.expanded = true;
    }
    protected async doFetchDetails(): Promise<void> {
        const tree = await this.reader.run("git", ["diff-index", ...RENAMEOPTS, "-z", "--cached", "HEAD"]);
        const deltas = Delta.fromDiff(tree);

        // Fetch information about index stages
        if (deltas.some((x) => x.conflict)) {
            const s = await this.reader.run("git", ["ls-files", "-u", "-z"]);
            const entries = s.split("\0");
            const regexp = /([0-9]*) ([0-9a-f]*) ([1-3]*)\t(.*)/;
            for (const d of deltas.filter((d) => d.conflict)) {
                const indexStageInfo: IndexStageInfo[] = [];
                for (const e of entries) {
                    const m = e.match(regexp);
                    if (m?.[4] === d.path) {
                        indexStageInfo.push({
                            perm: m[1],
                            sha: m[2],
                            stage: parseInt(m[3]),
                        });
                    }
                }
                d.attachIndexStageInfo(indexStageInfo);
            }
        }
        this.deltas = deltas;
    }
}

const DEFAULT_HISTORY_FORMAT = "%h   %s";

async function getHistoryFormat(reader: RepoReader): Promise<string> {
    let pretty = await reader.run("git", ["config", "--get", "format.pretty"], { inhibitLogging: true });
    for (let depth = 0; pretty && depth < 5; depth++) {
        if (pretty.startsWith("format:")) {
            return pretty.slice("format:".length);
        }
        if (pretty.startsWith("tformat:")) {
            return pretty.slice("tformat:".length);
        }
        if (pretty.includes("%")) {
            return pretty;
        }
        if (pretty === "oneline") {
            return "%h %s";
        }
        if (pretty === "reference") {
            return "%h (%s, %as)";
        }
        pretty = await reader.run("git", ["config", "--get", `pretty.${pretty}`], { inhibitLogging: true });
    }
    return DEFAULT_HISTORY_FORMAT;
}

export class History extends Patch {
    protected sha: string;
    constructor(reader: RepoReader, sha: string, description: string) {
        super(reader, description, "", "H", false);
        this.sha = sha;
    }
    getLines(): string[] {
        const lines = super.getLines();
        lines[0] = `${this.expanded ? "▾" : "▸"} ${this.description}`;
        return lines;
    }
    protected async doFetchDetails(): Promise<void> {
        const tree = await this.reader.run("git", ["diff-tree", ...RENAMEOPTS, "-z", "--no-commit-id", "-r", this.sha]);
        this.deltas = Delta.fromDiff(tree);
    }
    static async fromRev(reader: RepoReader, rev: string, limit: number) {
        if (limit === 0) {
            return [];
        }
        const format = await getHistoryFormat(reader);
        const log = await reader.run("git", ["log", "--reverse", "--first-parent", `-n${limit}`, "--color=never", `--format=%H%x00${format}%x00%B%x00`, rev]);
        if (log === "") {
            return [];
        }
        const fields = log.split("\0");
        const history: History[] = [];
        for (let i = 0; i + 2 < fields.length; i += 3) {
            const sha = fields[i].trim();
            const title = fields[i + 1].trim();
            const description = fields[i + 2].trim();
            history.push(new History(reader, sha, formatCommitDescription(title, description)));
        }
        return history;
    }
}

class StGitDoc {
    private readonly mutations = new MutationGate(
        () => {
            this.monitor.pause();
            this.displayLoads.pause();
            this.running = true;
            this.notifyDirty();
        },
        () => {
            if (this.disposed) {
                return;
            }
            this.monitor.resume();
            this.displayLoads.resume();
            this.reload();
            this.running = false;
            this.notifyDirty();
        },
    );
    private running = false;
    private loading = false;
    private disposed = false;
    private unknownFilesVisible = false;
    private monitor: StGitStateMonitor;
    private displayLoads: RepoDisplayLoads;

    private history: Patch[] = [];
    private applied: Patch[] = [];
    private popped: Patch[] = [];
    private index: Patch;
    private workTree: Patch;
    private selectedRow: { patchId: string; path?: string } = { patchId: "I:" };
    private needRepair = false;
    private stgMissing = false;
    private branchInitialized = true;
    private warnedAboutMissingStgBinary = false;
    private historySize = 5;
    private loadedHistorySize = 5;
    private branchName: string | null = null;
    private remoteName: string | null = null;
    private remoteBranch: string | null = null;
    private newUpstream = false;

    // Submodule navigation context
    // Stack of parent repos with their relative paths for navigation
    private parentRepoStack: {
        repo: RepositoryInfo;
        relativePath: string;
        submodulePath: string;
    }[] = [];
    private relativePathFromRoot = "";

    // start of history
    private baseSha: string | null = null;

    private editing: { kind: "create" | "edit"; body: string } | null = null;
    private editingInitialBody = "";
    private editPatch: Patch | null = null;

    private get mainViewColumn(): vscode.ViewColumn {
        return this.panel.viewColumn ?? vscode.ViewColumn.One;
    }

    constructor(
        public panel: vscode.WebviewPanel,
        public repo: RepositoryInfo,
        public notifyDirty: () => void,
    ) {
        this.displayLoads = new RepoDisplayLoads(
            repo,
            { run, runCommand },
            (kind, error) => log(`StGit ${kind} reload failed:`, String(error)),
            (loading) => {
                this.loading = loading;
                this.notifyDirty();
            },
        );
        this.index = new Index(this.reader);
        this.workTree = new WorkTree(this.reader, this.unknownFilesVisible);
        this.configListener = getStGitConfig().onDidChangeConfiguration(() => this.updateConfiguration({ reload: true }));
        this.updateConfiguration({ reload: false });
        this.setupSubmoduleContext(repo);
        this.reload();
        this.monitor = new StGitStateMonitor(repo, {
            readState: (currentRepo) => readRepositoryState(currentRepo, runCommand),
            watchFiles: (currentRepo, changed) => {
                const watcher = workspace.createFileSystemWatcher(new vscode.RelativePattern(currentRepo.topLevelDir, "**/*"));
                const onChange = (uri: vscode.Uri) => changed(uri.fsPath);
                watcher.onDidChange(onChange);
                watcher.onDidCreate(onChange);
                watcher.onDidDelete(onChange);
                return watcher;
            },
            reload: () => this.reload(),
            reloadWorkTree: () => this.reloadIndexAndWorkTree(),
        });
        this.monitor.start();
    }
    private configListener: vscode.Disposable;
    dispose() {
        this.disposed = true;
        this.displayLoads.dispose();
        this.monitor.dispose();
        this.configListener.dispose();
        void commands.executeCommand("setContext", "stgitEditing", false);
    }

    private get reader() {
        return this.displayLoads.currentReader;
    }

    runMutation<T>(action: () => T | Promise<T>): Promise<T> {
        return this.mutations.run(action);
    }

    private get patches() {
        return [...this.history, ...this.applied, this.index, this.workTree, ...this.popped];
    }

    selectRow(patchId: string, path?: string) {
        if (!this.patches.some((patch) => patch.rowId === patchId && (path === undefined || patch.deltas.some((delta) => delta.path === path)))) {
            return;
        }
        this.selectedRow = { patchId, path };
    }

    get viewState(): StGitViewState {
        if (this.pendingPath) {
            const patch = this.patches.find((candidate) => candidate.isExpanded && candidate.deltas.some((delta) => delta.path === this.pendingPath));
            if (patch) {
                this.selectedRow = { patchId: patch.rowId, path: this.pendingPath };
                this.pendingPath = null;
            }
        }
        const selectedPatch = this.patches.find((patch) => patch.rowId === this.selectedRow.patchId);
        const selected = selectedPatch
            ? selectedPatch.isExpanded && selectedPatch.deltas.some((delta) => delta.path === this.selectedRow.path)
                ? this.selectedRow
                : { patchId: selectedPatch.rowId }
            : { patchId: this.index.rowId };
        this.selectedRow = selected;
        return {
            branch: `${this.branchName ?? this.baseSha?.slice(0, 16) ?? "<unknown>"}${this.upstreamString}`,
            submodule: this.relativePathFromRoot,
            notice: this.stgMissing
                ? "StGit is not installed (stg binary missing)"
                : !this.branchInitialized
                  ? "Initialize this branch for StGit"
                  : this.needRepair
                    ? "StGit repair needed (Ctrl+U G)"
                    : "",
            noticeCommand: this.stgMissing ? "" : !this.branchInitialized ? "stgit.initializeBranch" : this.needRepair ? "stgit.repair" : "",
            selected,
            loading: this.running || this.loading,
            editing: this.editing,
            rows: this.patches.map((patch) => ({
                id: patch.rowId,
                kind: patch.kind,
                symbol: patch.statusSymbol || (patch.kind === "I" ? "◫" : patch.kind === "W" ? "◇" : "○"),
                description: patch.description,
                expanded: patch.isExpanded,
                marked: patch.marked,
                empty: patch.empty,
                highlighted: this.applied.includes(patch) && patch.deltas.some((delta) => this.highlightPaths?.has(delta.path)),
                files: patch.deltas.map((delta) => ({
                    path: delta.path,
                    name: `${delta.path}${delta.destPath ? ` → ${delta.destPath}` : ""}${delta.isSubmodule ? " [submodule]" : ""}`,
                    status: delta.statusLabel,
                    kind: delta.kind,
                    highlighted: this.highlightPaths?.has(delta.path) ?? false,
                })),
            })),
        };
    }
    private updateConfiguration(opt: { reload: boolean }) {
        const config = getStGitConfig();
        this.unknownFilesVisible = config.showUnknownFiles;
        if (opt.reload) {
            this.reload();
        }
    }

    async setupSubmoduleContext(repo: RepositoryInfo) {
        const { stack, relativePath } = await RepositoryInfo.buildParentStack(repo);
        if (this.repo !== repo) {
            return;
        }
        this.parentRepoStack = stack;
        this.relativePathFromRoot = relativePath;
        this.notifyDirty();
    }

    switchRepository(repo: RepositoryInfo, context: Awaited<ReturnType<typeof RepositoryInfo.buildParentStack>>) {
        if (this.repo.gitDir === repo.gitDir) {
            return;
        }
        if (this.editing) {
            info("Finish or cancel the commit message before switching repositories.");
            return;
        }
        this.displayLoads.switchRepository(repo);
        this.repo = repo;
        RepositoryInfo.setSelectedRepo(repo);
        this.monitor.setRepository(repo);
        this.parentRepoStack = context.stack;
        this.relativePathFromRoot = context.relativePath;
        this.history = [];
        this.applied = [];
        this.popped = [];
        this.index = new Index(this.reader);
        this.workTree = new WorkTree(this.reader, this.unknownFilesVisible);
        this.selectedRow = { patchId: this.index.rowId };
        this.pendingPath = null;
        this.baseSha = null;
        this.branchName = null;
        this.remoteName = null;
        this.remoteBranch = null;
        this.newUpstream = false;
        this.needRepair = false;
        this.stgMissing = false;
        this.branchInitialized = true;
        this.highlightPaths = null;
        this.notifyDirty();
        this.reload();
    }

    reload() {
        if (this.disposed) {
            return;
        }
        void this.displayLoads.loadSeries(
            (reader) => this.readSeries(reader),
            (state) => {
                this.branchName = state.branch || null;
                if (!this.newUpstream) {
                    const slash = state.upstream.indexOf("/");
                    this.remoteName = state.upstream.slice(0, slash) || this.remoteName;
                    this.remoteBranch = state.upstream.slice(slash + 1) || null;
                }
                this.branchInitialized = state.series.ecode === 0;
                this.stgMissing = state.series.ecode < 0;
                if (this.stgMissing) {
                    this.warnAboutMissingStGit();
                }
                this.popped = state.patches.filter((p) => p.kind === "-");
                this.applied = state.patches.filter((p) => p.kind !== "-");
                this.baseSha = state.baseSha;
                this.history = state.history;
                this.loadedHistorySize = state.historySize;
                this.needRepair = state.needRepair;
                this.notifyDirty();
            },
        );
        this.reloadIndexAndWorkTree();
    }

    private async readSeries(reader: RepoReader) {
        const old = new Map(this.patches.map((p) => [p.label, p]));
        const [branch, upstream, series, base, top, gitHead] = await Promise.all([
            reader.run("git", ["symbolic-ref", "--short", "HEAD"]),
            reader.run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { inhibitLogging: true }),
            reader.runCommand("stg", ["series", "-ae", "--commit-id=40", "--description"]),
            reader.run("stg", ["id", "--", "{base}"]),
            reader.run("stg", ["top"]),
            reader.run("git", ["rev-parse", "HEAD"]),
        ]);
        const lines = series.ecode === 0 ? series.stdout.split("\n").filter((line) => line) : [];
        const messagesBySha = new Map<string, string>();
        if (lines.length) {
            const output = await reader.run("git", ["show", "-s", "--format=%H%x00%B%x00", ...lines.map((line) => line.slice(3, 43))]);
            const fields = output.split("\0");
            for (let i = 0; i + 1 < fields.length; i += 2) {
                messagesBySha.set(fields[i].trim(), fields[i + 1]);
            }
        }
        const patches = lines.map((line) => {
            const sha = line.slice(3, 43);
            return StGitPatch.fromSeries(line, messagesBySha.get(sha) ?? "", reader);
        });
        await Promise.all(
            patches.map(async (patch) => {
                const previous = old.get(patch.label);
                if (previous) {
                    await patch.updateFromOld(previous);
                }
                if (this.highlightPaths) {
                    await patch.fetchDetails();
                }
            }),
        );
        const baseSha = base || gitHead;
        const historySize = this.historySize;
        const [history, stgHead] = await Promise.all([
            baseSha === this.baseSha && historySize === this.loadedHistorySize ? Promise.resolve(this.history) : History.fromRev(reader, baseSha, historySize),
            reader.run("stg", ["id", "--", ...(top ? [top] : [])]),
        ]);
        return {
            branch,
            upstream,
            series,
            patches,
            baseSha,
            history,
            historySize,
            needRepair: stgHead !== gitHead && stgHead !== "",
        };
    }

    reloadIndexAndWorkTree() {
        if (this.disposed) {
            return;
        }
        void this.displayLoads.loadChanges(
            async (reader) => {
                const index = new Index(reader);
                const workTree = new WorkTree(reader, this.unknownFilesVisible);
                await Promise.all([index.updateFromOld(this.index).then(() => index.fetchDetails()), workTree.updateFromOld(this.workTree).then(() => workTree.fetchDetails())]);
                return { index, workTree };
            },
            (state) => {
                this.index = state.index;
                this.workTree = state.workTree;
                this.notifyDirty();
            },
        );
    }

    reloadWorkTree() {
        this.reloadIndexAndWorkTree();
    }
    warnAboutMissingStGit() {
        if (!this.warnedAboutMissingStgBinary) {
            this.warnedAboutMissingStgBinary = true;
            window.showErrorMessage("StGit binary (stg) not found");
        }
    }
    async refresh(extraArgs: string[] = []) {
        if (this.index.deltas.length) {
            this.index.deltas = [];
            this.notifyDirty();
            await run("stg", ["refresh", "--index", ...extraArgs]);
        } else {
            this.workTree.deltas = [];
            this.notifyDirty();
            await run("stg", ["refresh", ...extraArgs]);
        }
        this.reload();
    }
    async refreshSpecific() {
        const marked = this.applied.filter((x) => x.marked);
        const popped = this.popped.filter((x) => x.marked);
        if (popped.length) {
            info("Cannot refresh popped patches.");
            return;
        }
        const p = this.curPatch;
        if (!marked.length && p && this.applied.includes(p)) {
            marked.push(p);
        }
        if (!marked) {
            return;
        }
        if (marked.length !== 1) {
            info("More than one patch is selected.");
            return;
        }
        await this.refresh(["-p", marked[0].label]);
    }
    async repair() {
        await run("stg", ["repair"]);
        this.reload();
    }
    async initializeBranch() {
        await run("stg", ["init"]);
        this.reload();
    }
    async gotoPatch() {
        const p = this.curPatch;
        if (p?.label) {
            await runAndReportErrors("stg", ["goto", "--", p.label]);
        } else if (p?.kind === "H") {
            await runAndReportErrors("stg", ["pop", "-a"]);
        } else {
            return;
        }
        this.reload();
    }
    async pushOrPopPatches() {
        const applied = this.applied.filter((p) => p.marked);
        const popped = this.popped.filter((p) => p.marked);
        const p = this.curPatch;
        if (!applied.length && !popped.length && p) {
            if (this.applied.includes(p)) {
                applied.push(p);
            } else if (this.popped.includes(p)) {
                popped.push(p);
            }
        }
        if (!applied.length && !popped.length) {
            return;
        }
        if (applied.length && popped.length) {
            info("Both pushed and popped patches selected.");
            return;
        }
        if (popped.length) {
            const patches = popped.map((p) => p.label);
            await runAndReportErrors("stg", ["push", "--", ...patches]);
        } else if (applied.length) {
            const patches = applied.map((p) => p.label);
            await runAndReportErrors("stg", ["pop", "--", ...patches]);
        }
        this.reload();
    }
    async movePatchesTo() {
        const p = this.curPatch;
        const patches = this.patches.filter((p) => p.marked).map((p) => p.label);
        if (!p || !patches.length) {
            return;
        }
        if (this.popped.includes(p)) {
            info("Cannot move patches below unapplied patches.");
            return;
        }
        if ([this.index, this.workTree].includes(p)) {
            await runAndReportErrors("stg", ["float", "--", ...patches]);
        } else if (this.applied.includes(p)) {
            await runAndReportErrors("stg", ["sink", "-t", p.label, "--", ...patches]);
        }
        this.reload();
    }
    private async openCommentEditor(body: string, kind: "create" | "edit", editPatch: Patch | null = null) {
        if (this.editing && !(await this.confirmDiscardComment())) {
            return;
        }
        this.editing = { kind, body };
        this.editingInitialBody = body;
        this.editPatch = editPatch;
        void commands.executeCommand("setContext", "stgitEditing", true);
        this.notifyDirty();
    }

    async createPatch() {
        await this.openCommentEditor("", "create");
    }
    async editCommitMessage() {
        const p = this.curPatch;
        if (!p || !["+", "-"].includes(p.kind)) {
            return;
        }
        const sha = (await p.getSha()) ?? "error retrieving commit message>";
        const msg = await run("git", ["show", "-s", sha, "--format=%B"]);
        await this.openCommentEditor(msg, "edit", p);
    }
    async copyCommitSha() {
        const sha = await this.curPatch?.getSha();
        if (!sha) {
            return;
        }
        await vscode.env.clipboard.writeText(sha);
        showStatusMessage(`Copied commit SHA ${sha}`);
    }
    setDraft(body: string) {
        if (this.editing) {
            this.editing.body = body;
        }
    }
    get draft(): string {
        return this.editing?.body ?? "";
    }
    async submitComment(body: string) {
        if (!this.editing) {
            return;
        }
        this.setDraft(body);
        if (this.editing.kind === "create") {
            await this.commentCreatePatch();
        } else {
            await this.completePatchEdit();
        }
    }
    async commentCreatePatch() {
        if (this.editing?.kind === "create") {
            const msg = this.editing.body;
            if (msg) {
                const result = await runAndReportErrors("stg", ["new", "-m", msg]);
                if (result.ecode !== 0) {
                    return;
                }
                await this.closeCommentEditor();
                await this.refresh();
            }
        }
    }
    async completePatchEdit() {
        if (this.editing?.kind === "edit") {
            const msg = this.editing.body;
            const editPatch = this.editPatch;
            if (msg && editPatch) {
                const result = await runAndReportErrors("stg", ["edit", "-m", msg, "--", editPatch.label]);
                if (result.ecode !== 0) {
                    return;
                }
                await this.closeCommentEditor();
                this.reload();
            }
        }
    }
    focusWindow() {
        if (!this.disposed) {
            this.panel.reveal();
        }
    }
    async closeAllDiffEditors() {
        const editors = window.visibleTextEditors.filter((e) => e.document.uri.scheme === "stgit-diff");
        for (const e of editors) {
            // workaround for missing 'closeEditor' API:
            const opts: vscode.TextDocumentShowOptions = {
                viewColumn: e.viewColumn,
                preview: true,
                preserveFocus: false,
            };
            await vscode.window.showTextDocument(e.document.uri, opts);
            await commands.executeCommand("workbench.action.closeActiveEditor");
        }
    }
    private async closeCommentEditor() {
        this.editing = null;
        this.editingInitialBody = "";
        this.editPatch = null;
        void commands.executeCommand("setContext", "stgitEditing", false);
        this.notifyDirty();
        await this.closeAllDiffEditors();
        this.focusWindow();
    }
    private confirmDiscardComment(): Promise<boolean> {
        const normalize = (text: string) => text.replace(/\r\n/g, "\n");
        const hasChanges = !!this.editing && normalize(this.editing.body) !== normalize(this.editingInitialBody);
        return confirmCommentDiscard(hasChanges, async () => {
            const choice = await window.showWarningMessage("Close the commit message editor? Unsaved changes may be lost.", { modal: true }, "Discard and Close");
            return choice === "Discard and Close";
        });
    }
    async cancel() {
        if (this.editing?.kind === "create" && !this.editing.body) {
            await this.closeCommentEditor();
            return;
        }
        if (!(await this.confirmDiscardComment())) {
            return;
        }
        await this.closeCommentEditor();
    }
    async cancelEmptyComment() {
        if (this.editing?.kind === "create" && !this.editing.body) {
            await this.closeCommentEditor();
        } else {
            await this.cancel();
        }
    }
    async squashPatches() {
        const patches = this.patches.filter((p) => p.marked);
        if (patches.length <= 1) {
            return;
        }
        const labels = patches.map((p) => p.label);
        const descriptions = patches.map((p, i) => `${i + 1} - ${p.description}`);
        const desc = await window.showQuickPick(descriptions, {
            placeHolder: "Select commit comment:",
        });
        if (!desc) {
            return;
        }
        const patch = patches[descriptions.findIndex((x) => x === desc)];
        const msg = (await patch.getCommitMessage()) ?? desc;

        const result = await runCommand("stg", ["squash", "-m", msg, ...labels]);
        if (!result.ecode) {
            patches.forEach((p) => p.setMarked(false));
        }
        this.reload();
    }
    async deletePatches() {
        const patch = this.curPatch;
        const patches = this.patches.filter((p) => p.marked).map((p) => p.label);
        if (patches.length) {
            await run("stg", ["delete", ...patches]);
            this.reload();
        } else if (patch?.kind === "-" || patch?.kind === "+") {
            await run("stg", ["delete", patch.label]);
            this.reload();
        }
    }
    private highlightPaths: Set<string> | null = null;
    async highlightFile() {
        const patch = this.curPatch;
        const delta = this.curChange;
        const work = this.applied.map((p) => p.fetchDetails());
        await Promise.all(work);
        if (delta) {
            this.highlightPaths = new Set([delta.path]);
        } else if (patch) {
            this.highlightPaths = new Set(patch.deltas.map((x) => x.path));
        } else {
            this.highlightPaths = null;
        }
        this.notifyDirty();
    }
    cancelHighlighting() {
        this.highlightPaths = null;
        this.notifyDirty();
    }
    async openDiffEditor() {
        const delta = this.curChange;
        if (delta) {
            const s = `stgit-blob:///${delta.path}`;
            const srcUri = vscode.Uri.parse(`${s}#${delta.srcSha}`);
            let dstUri = vscode.Uri.parse(`${s}#${delta.destSha}`);
            const opts: vscode.TextDocumentShowOptions = {
                viewColumn: this.alternateViewColumn,
                //preserveFocus: true,
                preview: true,
            };
            if (this.workTree.deltas.includes(delta)) {
                dstUri = this.repo.getPathUri(delta.destPath ?? delta.path);
            }
            await vscode.commands.executeCommand("vscode.diff", srcUri, dstUri, `Diff ${delta.path}`, opts);
        }
    }
    private async selectMergeDiffMode(delta: Delta): Promise<string | null> {
        if (!delta.conflict) {
            return "";
        }
        const modes = [
            { desc: "1 - Incoming Changes (base -> theirs)", mode: "13" },
            { desc: "2 - Local Changes (base -> ours)", mode: "12" },
            { desc: "3 - Our (ours -> work tree)", mode: "2" },
            { desc: "4 - Theirs (theirs -> work tree)", mode: "3" },
        ];
        const labels = modes.map((s) => s.desc);
        const s = await window.showQuickPick(labels, {
            placeHolder: "Select diff type",
        });
        if (!s) {
            return null;
        }
        const mode = modes[labels.indexOf(s)].mode;
        return `,diffmode=${mode}`;
    }
    async showDiffWithOpts(opts: { preserveFocus: boolean }) {
        const delta = this.curChange;
        const patch = this.curPatch;
        const sha = await patch?.getSha();
        let spec: string | null = null;
        let invariant = false;
        if (patch && sha) {
            const s = `${sha.slice(0, 5)}`;
            if (delta) {
                spec = `diff-${s}-${delta.path}#sha=${sha},file=${delta.path}` + (delta.destPath ? `,dest=${delta.destPath}` : "");
            } else {
                spec = `diff-${s}#sha=${sha}`;
            }
            invariant = true; // Diff contents never changes
        } else if (patch?.kind === "I") {
            if (delta) {
                const m = await this.selectMergeDiffMode(delta);
                if (m === null) {
                    return;
                }
                spec = `diff-index-${delta.path}#index,file=${delta.path}` + (delta.destPath ? `,dest=${delta.destPath}` : "") + m;
            } else {
                spec = `diff-index#index`;
            }
        } else if (patch?.kind === "W") {
            if (delta) {
                spec = `diff-${delta.path}#file=${delta.path}`;
            } else {
                spec = `diff-work-tree`;
            }
        }
        if (spec) {
            const uri = vscode.Uri.parse(`stgit-diff:///${spec}`);
            // If the uri is already open, we must force a refresh
            if (!invariant) {
                refreshDiff(uri);
            }
            await openAndShowDiffDocument(uri, {
                viewColumn: this.alternateViewColumn,
                preserveFocus: opts.preserveFocus,
            });
        }
    }
    showDiff() {
        return this.showDiffWithOpts({ preserveFocus: true });
    }
    openDiff() {
        return this.showDiffWithOpts({ preserveFocus: false });
    }
    async help() {
        await vscode.commands.executeCommand("workbench.action.quickOpen", ">StGit: ");
    }
    async newPatch() {
        await run("stg", ["new", "-m", "New patch"]);
        this.reload();
    }
    async createBranch() {
        const branch = await window.showInputBox({
            prompt: `Enter branch name`,
        });
        if (!branch) {
            return;
        }
        await runAndReportErrors("stg", ["branch", "--create", branch]);
        this.newUpstream = false;
        this.reload();
    }
    async switchBranch() {
        const indexDeltas = this.index.deltas.filter((d) => !d.isSubmodule);
        const workTreeDeltas = this.workTree.deltas.filter((d) => !d.isSubmodule);
        if (indexDeltas.length || workTreeDeltas.length) {
            info("Work tree and index must be clean to switch branch");
            return;
        }
        const create = "$(plus) Create new branch";
        const branches = await run("git", ["branch"]).then<string[]>((s) => {
            return s.split("\n").map((s) => s.replace(/^[*+]/, "").trim());
        });
        const branch = await window.showQuickPick([create, ...branches], {
            placeHolder: "Select branch to checkout",
        });
        if (!branch) {
            return;
        } else if (branch.includes("Create new branch")) {
            await this.createBranch();
        } else if (branch) {
            await runAndReportErrors("git", ["switch", branch]);
            this.newUpstream = false;
            this.reload();
        }
    }
    private async allBranches() {
        const local = (await run("git", ["branch"])).split("\n");
        const remote = (await run("git", ["branch", "-r"])).split("\n");
        return [...local, ...remote].map((s) => s.replace("*", "").trim()).filter((x) => x);
    }
    async rebase() {
        const base = await window.showQuickPick(this.allBranches(), {
            placeHolder: "Select upstream branch for rebase",
        });
        if (base) {
            const result = await runAndReportErrors("stg", ["rebase", "--", base]);
            this.reload();
            if (result.ecode === 0) {
                showStatusMessage(`Rebased series on top of '${base}'`);
            }
        }
    }

    async selectRemote() {
        const remotes = (await run("git", ["remote"])).split("\n");
        const remote = await window.showQuickPick(remotes, {
            placeHolder: "Select remote",
        });
        if (remote) {
            this.remoteName = remote.trim();
            this.remoteBranch = null;
            this.reload();
        }
    }

    async selectUpstreamBranch() {
        const clear = "$(close) Clear upstream setting";
        const remotes = (await run("git", ["remote"])).split("\n").map((r) => `$(plus) ${r.trim()}: New upstream branch`);
        const branches = (await run("git", ["branch", "-r"]))
            .split("\n")
            .map((b) => b.trim())
            .filter((b) => !b.includes(" "));
        const upstream = await window.showQuickPick([clear, ...remotes, ...branches], { placeHolder: "Select upstream branch" });
        if (!upstream) {
            return;
        } else if (upstream.includes("Clear upstream")) {
            this.remoteBranch = null;
            await run("git", ["branch", "--unset-upstream"]);
        } else if (upstream.includes("$")) {
            const n = upstream.search(":");
            const s = upstream.search(" ");
            const remote = upstream.slice(s + 1, n);
            const branch = await window.showInputBox({
                prompt: `${remote} branch name`,
            });
            if (!branch) {
                return;
            }
            this.remoteName = remote;
            this.remoteBranch = branch;
            this.newUpstream = true;
        } else {
            const n = upstream.search("/");
            const remote = upstream.slice(0, n);
            const branch = upstream.slice(n + 1);
            if (!remote || !branch) {
                return;
            }
            this.remoteName = remote;
            this.remoteBranch = branch;
            this.newUpstream = false;
            await runAndReportErrors("git", ["branch", "--set-upstream-to", `${this.remoteName}/${this.remoteBranch}`]);
        }
        this.reload();
    }

    async gitFetch() {
        if (!this.remoteName) {
            await this.selectRemote();
        }
        if (this.remoteName) {
            const result = await runAndReportErrors("git", ["fetch", this.remoteName]);
            if (result.ecode === 0) {
                log(`git fetch ${this.remoteName}: success`);
            }
        }
        showStatusMessage(`Fetched '${this.remoteName}'`);
    }

    async gitPush(kind: "force" | "fast-forward") {
        if (!this.remoteBranch) {
            await this.selectUpstreamBranch();
        }
        if (!this.remoteBranch || !this.remoteName) {
            return;
        }
        const forcePlus = kind === "force" ? "+" : "";
        const spec = `${forcePlus}HEAD:${this.remoteBranch}`;

        const pushStr = kind == "force" ? "Force-push" : "Push";
        const confirmationMsg = `${pushStr} ${spec} to ${this.remoteName}?`;
        if (!(await getUserConfirmation(confirmationMsg))) {
            return;
        }

        const result = await runAndReportErrors("git", ["push", this.remoteName, spec], { errorMsg: "push failed" });
        if (result.ecode !== 0) {
            return;
        }
        log(`git push ${this.remoteName} ${spec}: success`);
        if (result.stderr.includes("Create a pull request")) {
            const link = result.stderr.split("\n").filter((s) => s.startsWith("remote:") && s.includes("https:"))[0];
            const s = `Create a GitHub pull request for ${this.remoteBranch}?`;
            if (await getUserConfirmation(s)) {
                const n = link.search("https://");
                const url = link.slice(n);
                vscode.env.openExternal(vscode.Uri.parse(url.trim()));
            }
        }
        showStatusMessage(`Pushed '${this.remoteName}/${this.remoteBranch}'`);
    }

    markPatch() {
        if (this.curPatch?.setMarked(true)) {
            this.notifyDirty();
        }
        this.moveCursorToNextPatch();
    }
    unmarkPatch() {
        if (this.curPatch?.setMarked(false)) {
            this.notifyDirty();
        }
        this.moveCursorToNextPatch();
    }
    async toggleExpand() {
        const patch = this.curPatch;
        const delta = this.curChange;
        if (delta) {
            // Check if the delta is a submodule - if so, navigate into it
            if (delta.isSubmodule) {
                await this.navigateToSubmodule(delta.path);
                return;
            }
            const uri = this.repo.getPathUri(delta.path);
            if (!uri) {
                return;
            }
            const doc = await workspace.openTextDocument(uri);
            if (doc) {
                await window.showTextDocument(doc, {
                    viewColumn: this.alternateViewColumn,
                });
            }
        } else if (patch) {
            await patch.toggleExpanded();
            this.notifyDirty();
        }
    }
    async navigateToSubmodule(submodulePath: string) {
        // Construct the full path to the submodule
        const fullPath = this.repo.getPathUri(submodulePath).fsPath;

        // Create a new RepositoryInfo for the submodule
        const submoduleRepo = await RepositoryInfo.createForPath(fullPath);
        if (!submoduleRepo) {
            info(`Failed to open submodule at ${submodulePath}`);
            return;
        }

        const context = await RepositoryInfo.buildParentStack(submoduleRepo);
        this.switchRepository(submoduleRepo, context);
        this.moveCursorToIndex();
    }
    async navigateToParent() {
        if (this.parentRepoStack.length === 0) {
            info("Already at root repository");
            return;
        }

        const parent = this.parentRepoStack.at(-1)!;
        const context = await RepositoryInfo.buildParentStack(parent.repo);
        this.switchRepository(parent.repo, context);
        this.moveCursorToDelta(parent.submodulePath);
    }
    async resolveConflict() {
        const change = this.curChange;
        if (change) {
            if (change.conflict) {
                await run("git", ["add", change.path]);
                this.reload();
            } else {
                info("No conflict to resolve");
            }
        }
    }
    async toggleChanges() {
        // Move changes between index and work tree
        const patch = this.curPatch;
        const change = this.curChange;
        if (change?.conflict) {
            info("Conflicts must be marked as resolved (shift-R).");
            return;
        }
        if (patch?.kind === "W") {
            if (change) {
                if (change.deleted) {
                    await run("git", ["rm", "--", change.path]);
                } else {
                    await run("git", ["add", "--", change.path, ...(change.destPath ? [change.destPath] : [])]);
                }
                this.selectedRow = { patchId: patch.rowId, path: patch.deltas[patch.deltas.indexOf(change) + 1]?.path };
            } else {
                await run("git", ["add", "-u"]);
            }
            this.reloadIndexAndWorkTree();
        } else if (patch?.kind == "I") {
            if (change) {
                await run("git", ["restore", "-S", "--", change.path, ...(change.destPath ? [change.destPath] : [])]);
                const index = patch.deltas.indexOf(change);
                this.selectedRow = { patchId: patch.rowId, path: patch.deltas[index > 0 ? index - 1 : 1]?.path };
            } else {
                await run("git", ["reset", "HEAD"]);
            }
            this.reloadIndexAndWorkTree();
        } else if (patch && patch === this.applied.at(-1)) {
            if (change) {
                await uncommitFiles([change.path, ...(change.destPath ? [change.destPath] : [])]);
            } else {
                await uncommitFiles();
            }
            this.reload();
        }
    }
    async revertChanges() {
        const patch = this.curPatch;
        const change = this.curChange;
        if (patch?.kind === "I") {
            if (change) {
                log(["git", "restore", "-WS", "--", change.path].join(" "));
                await run("git", ["restore", "-WS", "--", change.path]);
            } else {
                const files = patch.deltas.map((d) => d.path);
                log(["git", "restore", "-WS", "--", ...files].join(" '"));
                await run("git", ["restore", "-WS", "--", ...files]);
            }
        } else if (patch?.kind === "W") {
            if (change) {
                if (change.conflict) {
                    // Redo index merge
                    await run("git", ["checkout", "-m", change.path]);
                } else {
                    await run("git", ["restore", "--", change.path]);
                }
            } else {
                const files = patch.deltas.map((d) => d.path);
                await run("git", ["restore", "--", ...files]);
            }
        }
        this.reloadIndexAndWorkTree();
    }
    async undo() {
        await runAndReportErrors("stg", ["undo"]);
        this.reload();
    }
    async hardUndo() {
        const msg = "Perform a hard undo?" + " Files not checked in could potentially be overwritten.";
        if (!(await getUserConfirmation(msg))) {
            return;
        }
        await runAndReportErrors("stg", ["undo", "--hard"]);
        this.reload();
    }
    async redo() {
        await runAndReportErrors("stg", ["redo"]);
        this.reload();
    }
    async popCurrentPatch() {
        await runAndReportErrors("stg", ["pop"]);
        this.reload();
    }
    async pushNextPatch() {
        await runAndReportErrors("stg", ["push"]);
        this.reload();
    }
    async setHistorySize() {
        const numStr = await window.showQuickPick(["0", "1", "5", "10", "15", "20", "25", "30", "35", "40"], {
            placeHolder: "Specify Git history size",
        });
        if (numStr) {
            this.historySize = parseInt(numStr);
            this.reload();
        }
    }
    async commitOrUncommitPatches() {
        const curPatch = this.curPatch;
        if (curPatch?.kind === "H") {
            const n = this.history.length - this.history.indexOf(curPatch);
            await run("stg", ["uncommit", `-n${n}`]);
        } else if (curPatch?.kind === "+") {
            const n = this.applied.indexOf(curPatch) + 1;
            await run("stg", ["commit", `-n${n}`]);
        } else {
            return;
        }
        this.reload();
    }
    toggleShowingUnknownFiles() {
        this.unknownFilesVisible = !this.unknownFilesVisible;
        this.reloadWorkTree();
    }

    private moveCursorToNextPatch() {
        const list = this.patches;
        const curPatch = this.curPatch;
        const ind = list.findIndex((p) => p === curPatch);
        const nextPatch = list[ind + 1];
        this.selectedRow = { patchId: nextPatch?.rowId ?? curPatch?.rowId ?? this.index.rowId };
        this.notifyDirty();
    }
    private moveCursorToIndex() {
        this.selectedRow = { patchId: this.index.rowId };
        this.notifyDirty();
    }

    private pendingPath: string | null = null;
    private moveCursorToDelta(path: string) {
        this.pendingPath = path;
        this.notifyDirty();
    }
    private get curPatch(): Patch | null {
        return this.patches.find((patch) => patch.rowId === this.selectedRow.patchId) ?? null;
    }
    private get curChange(): Delta | null {
        return this.curPatch?.deltas.find((delta) => delta.path === this.selectedRow.path) ?? null;
    }
    get alternateViewColumn() {
        const col = this.mainViewColumn;
        return col > 1 ? col - 1 : col + 1;
    }

    private get upstreamString(): string {
        if (this.remoteBranch && this.remoteName) {
            return ` <-> ${this.remoteName}/${this.remoteBranch}`;
        }
        if (this.remoteName) {
            return ` (${this.remoteName})`;
        }
        return "";
    }
}

class StGitMode {
    static instance: StGitMode | null;

    stgit: StGitDoc | null = null;
    private assetRevision = 0;
    private assetReloadTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the next "ready" from the webview should pull keyboard focus into it
    private focusWhenReady = true;
    private repositoryFollower = new RepositoryFollower({
        lookup: (directory: string) => RepositoryInfo.createForPath(directory),
        current: () => this.stgit?.repo ?? null,
        loadContext: (repo) => RepositoryInfo.buildParentStack(repo),
        switchTo: (repo, context) => {
            this.stgit?.switchRepository(repo, context);
        },
    });

    constructor(private readonly context: vscode.ExtensionContext) {
        const cmd = (cmd: string, func: () => void | Promise<unknown>) => {
            return commands.registerCommand(`stgit.${cmd}`, () => {
                const doc = this.stgit;
                return doc ? doc.runMutation(func) : func();
            });
        };
        if (context.extensionMode === vscode.ExtensionMode.Development) {
            const assetRoot = vscode.Uri.joinPath(context.extensionUri, "out", "webview");
            const assetWatcher = workspace.createFileSystemWatcher(new vscode.RelativePattern(assetRoot, "index.{js,css}"));
            const scheduleReload = () => {
                if (this.assetReloadTimer) {
                    clearTimeout(this.assetReloadTimer);
                }
                this.assetReloadTimer = setTimeout(() => {
                    this.assetReloadTimer = undefined;
                    if (this.stgit) {
                        this.assetRevision++;
                        // The webview element survives an HTML update and keeps its own focus
                        this.focusWhenReady = false;
                        this.setWebviewHtml(this.stgit.panel);
                    }
                }, 150);
            };
            context.subscriptions.push(assetWatcher, assetWatcher.onDidChange(scheduleReload), assetWatcher.onDidCreate(scheduleReload));
        }
        context.subscriptions.push(
            this /* self dispose */,
            commands.registerCommand("stgit.open", () => this.openStgit()),
            cmd("refresh", () => this.stgit?.refresh()),
            cmd("repair", () => this.stgit?.repair()),
            cmd("initializeBranch", () => this.stgit?.initializeBranch()),
            cmd("refreshSpecific", () => this.stgit?.refreshSpecific()),
            cmd("createBranch", () => this.stgit?.createBranch()),
            cmd("switchBranch", () => this.stgit?.switchBranch()),
            cmd("rebase", () => this.stgit?.rebase()),
            cmd("gitFetch", () => this.stgit?.gitFetch()),
            cmd("gitPush", () => this.stgit?.gitPush("fast-forward")),
            cmd("gitForcePush", () => this.stgit?.gitPush("force")),
            cmd("selectRemote", () => this.stgit?.selectRemote()),
            cmd("selectUpstreamBranch", () => this.stgit?.selectUpstreamBranch()),
            cmd("reload", () => this.stgit?.reload()),
            cmd("resolveConflict", () => this.stgit?.resolveConflict()),
            cmd("gotoPatch", () => this.stgit?.gotoPatch()),
            cmd("markPatch", () => this.stgit?.markPatch()),
            cmd("unmarkPatch", () => this.stgit?.unmarkPatch()),
            cmd("toggleExpand", () => this.stgit?.toggleExpand()),
            cmd("toggleChanges", () => this.stgit?.toggleChanges()),
            cmd("toggleShowingUnknown", () => this.stgit?.toggleShowingUnknownFiles()),
            cmd("createPatch", () => this.stgit?.createPatch()),
            cmd("newPatch", () => this.stgit?.newPatch()),
            cmd("pushOrPopPatches", () => this.stgit?.pushOrPopPatches()),
            cmd("pushNextPatch", () => this.stgit?.pushNextPatch()),
            cmd("popCurrentPatch", () => this.stgit?.popCurrentPatch()),
            cmd("movePatchesTo", () => this.stgit?.movePatchesTo()),
            cmd("commentCreatePatch", () => this.stgit?.commentCreatePatch()),
            cmd("completePatchEdit", () => this.stgit?.completePatchEdit()),
            cmd("submitComment", () => this.stgit?.submitComment(this.stgit.draft)),
            cmd("cancel", () => this.stgit?.cancel()),
            cmd("cancelEmptyComment", () => this.stgit?.cancelEmptyComment()),
            cmd("editCommitMessage", () => this.stgit?.editCommitMessage()),
            cmd("copyCommitSha", () => this.stgit?.copyCommitSha()),
            cmd("squashPatches", () => this.stgit?.squashPatches()),
            cmd("deletePatches", () => this.stgit?.deletePatches()),
            cmd("highlightFile", () => this.stgit?.highlightFile()),
            cmd("cancelHighlighting", () => this.stgit?.cancelHighlighting()),
            cmd("openDiffEditor", () => this.stgit?.openDiffEditor()),
            cmd("showDiff", () => this.stgit?.showDiff()),
            cmd("openDiff", () => this.stgit?.openDiff()),
            cmd("setHistorySize", () => this.stgit?.setHistorySize()),
            cmd("commitOrUncommitPatches", () => this.stgit?.commitOrUncommitPatches()),
            cmd("revertChanges", () => this.stgit?.revertChanges()),
            cmd("undo", () => this.stgit?.undo()),
            cmd("hardUndo", () => this.stgit?.hardUndo()),
            cmd("redo", () => this.stgit?.redo()),
            cmd("help", () => this.stgit?.help()),
            cmd("navigateToParent", () => this.stgit?.navigateToParent()),
            workspace.onDidSaveTextDocument(() => {
                this.stgit?.reloadWorkTree();
            }),
            window.onDidChangeActiveTextEditor((editor) => {
                if (editor?.document.uri.scheme === "file" && this.stgit) {
                    void this.repositoryFollower.followFile(editor.document.uri.fsPath);
                }
            }),
        );
    }
    dispose() {
        if (this.assetReloadTimer) {
            clearTimeout(this.assetReloadTimer);
        }
        this.repositoryFollower.cancel();
        this.stgit?.dispose();
        this.stgit = null;
        StGitMode.instance = null;
    }
    private async openStgit() {
        if (this.stgit) {
            const scheme = window.activeTextEditor?.document.uri.scheme || "";
            const isInStgitBuffer = this.stgit.panel.active || scheme === "stgit-diff";
            if (!isInStgitBuffer) {
                const repo = await RepositoryInfo.lookup();
                if (!repo) {
                    info("Failed to find a GIT repository");
                    return;
                }
                const context = await RepositoryInfo.buildParentStack(repo);
                this.stgit.switchRepository(repo, context);
            }
            this.stgit.focusWindow();
            this.stgit.reload();
        } else {
            const repo = await RepositoryInfo.lookup();
            if (!repo) {
                info("Failed to find a GIT repository");
                return;
            }
            RepositoryInfo.setSelectedRepo(repo);
            const assetRoot = vscode.Uri.joinPath(this.context.extensionUri, "out", "webview");
            this.focusWhenReady = true;
            const panel = window.createWebviewPanel("stgit", "StGit", vscode.ViewColumn.Active, {
                enableScripts: true,
                localResourceRoots: [assetRoot],
            });
            this.stgit = new StGitDoc(panel, repo, () => {
                if (this.stgit?.panel === panel && panel.visible) {
                    void panel.webview.postMessage({ type: "render", state: this.stgit.viewState });
                }
            });
            panel.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(panel, message));
            panel.onDidChangeViewState(() => {
                if (panel.visible && this.stgit?.panel === panel) {
                    void panel.webview.postMessage({ type: "render", state: this.stgit.viewState });
                }
            });
            panel.onDidDispose(() => {
                if (this.stgit?.panel === panel) {
                    this.repositoryFollower.cancel();
                    this.stgit.dispose();
                    this.stgit = null;
                }
            });
            this.setWebviewHtml(panel);
        }
    }
    private setWebviewHtml(panel: vscode.WebviewPanel) {
        const assetRoot = vscode.Uri.joinPath(this.context.extensionUri, "out", "webview");
        const query = `v=${this.assetRevision}`;
        panel.webview.html = stgitWebviewHtml(panel.webview, {
            script: vscode.Uri.joinPath(assetRoot, "index.js").with({ query }),
            style: vscode.Uri.joinPath(assetRoot, "index.css").with({ query }),
        });
    }
    private async handleMessage(panel: vscode.WebviewPanel, raw: unknown) {
        const doc = this.stgit;
        if (!doc || doc.panel !== panel || !raw || typeof raw !== "object") {
            return;
        }
        const message = raw as Record<string, unknown>;
        if (message.type === "ready") {
            void panel.webview.postMessage({ type: "render", state: doc.viewState });
            // VS Code recreates the webview when the panel is opened, moved to another
            // group or shown again after being hidden, and focuses the panel before the
            // new content has loaded, so keyboard focus never reaches it. Focus it again
            // now that the content is ready.
            const focus = this.focusWhenReady;
            this.focusWhenReady = true;
            if (focus && panel.active) {
                panel.reveal(panel.viewColumn, false);
            }
        } else if (message.type === "select" && typeof message.patchId === "string" && (message.path === undefined || typeof message.path === "string")) {
            doc.selectRow(message.patchId, message.path as string | undefined);
        } else if (message.type === "draft" && typeof message.body === "string") {
            doc.setDraft(message.body);
        } else if (message.type === "submit" && typeof message.body === "string") {
            await doc.runMutation(() => doc.submitComment(message.body as string));
        } else if (message.type === "cancel") {
            await doc.runMutation(() => doc.cancel());
        } else if (
            message.type === "command" &&
            typeof message.command === "string" &&
            [
                "stgit.reload",
                "stgit.refresh",
                "stgit.newPatch",
                "stgit.help",
                "stgit.toggleExpand",
                "stgit.markPatch",
                "stgit.unmarkPatch",
                "stgit.initializeBranch",
                "stgit.repair",
            ].includes(message.command)
        ) {
            await commands.executeCommand(message.command);
        }
    }
}

export function registerStGitMode(context: vscode.ExtensionContext) {
    StGitMode.instance = new StGitMode(context);
}

export function reloadIndexAndWorkTree() {
    StGitMode.instance?.stgit?.reloadIndexAndWorkTree();
}

export function runStGitMutation<T>(action: () => T | Promise<T>): Promise<T> {
    const doc = StGitMode.instance?.stgit;
    return doc ? doc.runMutation(action) : Promise.resolve().then(action);
}
