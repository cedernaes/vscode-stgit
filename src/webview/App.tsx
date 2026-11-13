import { ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Circle, Ellipsis, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StGitViewRow, StGitViewState } from "../stgit-webview";

type Selection = StGitViewState["selected"];
type ExtensionMessage =
    { type: "ready" | "cancel" } | { type: "select"; patchId: string; path?: string } | { type: "command"; command: string } | { type: "draft" | "submit"; body: string };

interface PersistedViewState {
    scrollY: number;
}

declare function acquireVsCodeApi(): {
    postMessage(message: ExtensionMessage): void;
    getState(): PersistedViewState | undefined;
    setState(state: PersistedViewState): void;
};

const api = acquireVsCodeApi();

function matchesSelection(row: HTMLTableRowElement, selection: Selection): boolean {
    return row.dataset.patchId === selection.patchId && row.dataset.path === selection.path;
}

export function App() {
    const [state, setState] = useState<StGitViewState | null>(null);
    const [selected, setSelected] = useState<Selection>({ patchId: "I:" });
    const [draft, setDraft] = useState("");
    const editingRef = useRef(false);
    const focusEditor = useRef(false);
    const restoreRowFocus = useRef(false);
    const restoreScroll = useRef(api.getState()?.scrollY);
    const messageRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const saveScroll = () => api.setState({ scrollY: window.scrollY });
        window.addEventListener("scroll", saveScroll, { passive: true });
        return () => window.removeEventListener("scroll", saveScroll);
    }, []);

    useEffect(() => {
        const onMessage = (event: MessageEvent<{ type: "render"; state: StGitViewState }>) => {
            if (event.data?.type !== "render") {
                return;
            }
            restoreRowFocus.current = !!document.activeElement?.closest("tr[data-row]") || (editingRef.current && !event.data.state.editing);
            if (!editingRef.current && event.data.state.editing) {
                setDraft(event.data.state.editing.body);
                focusEditor.current = true;
            }
            editingRef.current = !!event.data.state.editing;
            setSelected(event.data.state.selected);
            setState(event.data.state);
        };
        window.addEventListener("message", onMessage);
        api.postMessage({ type: "ready" });
        return () => window.removeEventListener("message", onMessage);
    }, []);

    useLayoutEffect(() => {
        if (state && restoreScroll.current !== undefined) {
            window.scrollTo(0, restoreScroll.current);
            restoreScroll.current = undefined;
        }
        if (focusEditor.current) {
            messageRef.current?.focus();
            focusEditor.current = false;
        } else if (restoreRowFocus.current) {
            const row = [...document.querySelectorAll<HTMLTableRowElement>("tr[data-row]")].find((candidate) => matchesSelection(candidate, selected));
            row?.focus({ preventScroll: true });
            restoreRowFocus.current = false;
        }
    }, [state, selected]);

    function choose(selection: Selection, row?: HTMLTableRowElement) {
        setSelected(selection);
        row?.focus();
        api.postMessage({ type: "select", ...selection });
    }

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (state?.editing) {
                if (event.key === "Escape") {
                    event.preventDefault();
                    api.postMessage({ type: "cancel" });
                } else if (event.ctrlKey && event.key === "Enter") {
                    event.preventDefault();
                    api.postMessage({ type: "submit", body: draft });
                }
                return;
            }
            if (event.key === "Enter" && event.target instanceof HTMLTableRowElement && event.target.dataset.row) {
                event.preventDefault();
                api.postMessage({ type: "command", command: "stgit.toggleExpand" });
                return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                return;
            }
            event.preventDefault();
            const entries = [...document.querySelectorAll<HTMLTableRowElement>("tr[data-row]")];
            const current = entries.findIndex((row) => matchesSelection(row, selected));
            const step = event.key === "ArrowDown" ? 1 : -1;
            const index = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, current + step));
            const next = entries[index];
            if (next?.dataset.patchId) {
                choose({ patchId: next.dataset.patchId, path: next.dataset.path }, next);
                next.scrollIntoView({ block: "nearest" });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [state?.editing, selected, draft]);

    function patchRow(patch: StGitViewRow) {
        const isSelected = selected.patchId === patch.id && selected.path === undefined;
        const section = patch.kind === "H" ? "history" : patch.kind === "+" ? "applied" : patch.kind === "-" ? "popped" : patch.kind === "I" ? "index" : "work-tree";
        return (
            <tr
                key={patch.id}
                data-row="true"
                data-patch-id={patch.id}
                className={`entry ${section}${patch.highlighted ? " highlighted" : ""}${isSelected ? " selected" : ""}`}
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                title={patch.description}
                onClick={(event) => choose({ patchId: patch.id }, event.currentTarget)}
                onDoubleClick={(event) => {
                    choose({ patchId: patch.id }, event.currentTarget);
                    api.postMessage({ type: "command", command: "stgit.toggleExpand" });
                }}
            >
                <td>
                    {patch.kind === "+" || patch.kind === "-" ? (
                        <button
                            className="expand mark"
                            title={patch.marked ? "Unmark patch (u)" : "Mark patch (m)"}
                            aria-label={patch.marked ? "Unmark patch" : "Mark patch"}
                            onClick={(event) => {
                                event.stopPropagation();
                                choose({ patchId: patch.id }, event.currentTarget.closest("tr")!);
                                api.postMessage({ type: "command", command: patch.marked ? "stgit.unmarkPatch" : "stgit.markPatch" });
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                        >
                            {patch.marked ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                        </button>
                    ) : (
                        <span className="mark" />
                    )}
                    <button
                        className="expand"
                        title={patch.expanded ? "Collapse" : "Expand"}
                        aria-label={`${patch.expanded ? "Collapse" : "Expand"} ${patch.description}`}
                        aria-expanded={patch.expanded}
                        onClick={(event) => {
                            event.stopPropagation();
                            choose({ patchId: patch.id }, event.currentTarget.closest("tr")!);
                            api.postMessage({ type: "command", command: "stgit.toggleExpand" });
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                    >
                        {patch.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                </td>
                <td className="symbol">{patch.symbol}</td>
                <td className="name">
                    {patch.description}
                    {patch.empty ? " (empty)" : ""}
                </td>
                <td>{patch.files.length || ""}</td>
            </tr>
        );
    }

    function fileRows(patch: StGitViewRow) {
        if (!patch.expanded) {
            return null;
        }
        if (!patch.files.length) {
            return (
                <tr key={`${patch.id}:empty`} className="empty">
                    <td />
                    <td />
                    <td className="name" colSpan={2}>
                        {patch.kind === "I" || patch.kind === "W" ? "No changes" : "No files"}
                    </td>
                </tr>
            );
        }
        return patch.files.map((file) => {
            const row = { patchId: patch.id, path: file.path };
            const isSelected = selected.patchId === patch.id && selected.path === file.path;
            return (
                <tr
                    key={`${patch.id}:${file.path}`}
                    data-row="true"
                    data-patch-id={patch.id}
                    data-path={file.path}
                    data-kind={file.kind}
                    className={`entry file${file.highlighted ? " highlighted" : ""}${isSelected ? " selected" : ""}`}
                    tabIndex={isSelected ? 0 : -1}
                    aria-selected={isSelected}
                    title={`${file.status}: ${file.name}`}
                    onClick={(event) => choose(row, event.currentTarget)}
                    onDoubleClick={(event) => {
                        choose(row, event.currentTarget);
                        api.postMessage({ type: "command", command: "stgit.toggleExpand" });
                    }}
                >
                    <td />
                    <td className="symbol">{file.kind}</td>
                    <td className="name">{file.name}</td>
                    <td>{file.status}</td>
                </tr>
            );
        });
    }

    const command = (command: string) => api.postMessage({ type: "command", command });
    return (
        <>
            <header>
                {state?.submodule && <div className="submodule">Submodule: {state.submodule}</div>}
                <div className="heading">
                    <div className="branch">{state?.branch ?? "StGit"}</div>
                    <span
                        className={state?.loading ? "loading active" : "loading"}
                        role="status"
                        aria-live="polite"
                        title={state?.loading ? "Running / refreshing..." : undefined}
                    >
                        <span className="spinner" aria-hidden="true" />
                        <span className="visually-hidden">{state?.loading ? "Running / refreshing..." : ""}</span>
                    </span>
                    <button className="tool" title="Reload status (g)" aria-label="Reload status" onClick={() => command("stgit.reload")}>
                        <RotateCcw size={17} />
                    </button>
                    <button className="tool" title="Refresh patch (r)" aria-label="Refresh patch" onClick={() => command("stgit.refresh")}>
                        <RefreshCw size={17} />
                    </button>
                    <button className="tool" title="New patch (Shift+N)" aria-label="New patch" onClick={() => command("stgit.newPatch")}>
                        <Plus size={17} />
                    </button>
                    <button className="tool" title="StGit commands (h)" aria-label="StGit commands" onClick={() => command("stgit.help")}>
                        <Ellipsis size={17} />
                    </button>
                </div>
            </header>
            {state?.notice && (
                <div className="notice">
                    <span>{state.notice}</span>
                    {state.noticeCommand && (
                        <button className="tool" title={state.notice} aria-label={state.notice} onClick={() => command(state.noticeCommand)}>
                            <ArrowUpRight size={17} />
                        </button>
                    )}
                </div>
            )}
            <table aria-label="StGit patches and files">
                <thead>
                    <tr>
                        <th scope="col" />
                        <th scope="col">Status</th>
                        <th scope="col">Patch / file</th>
                        <th scope="col">Files</th>
                    </tr>
                </thead>
                <tbody>
                    {state?.rows.map((patch) => (
                        <Fragment key={patch.id}>
                            {patchRow(patch)}
                            {fileRows(patch)}
                        </Fragment>
                    ))}
                </tbody>
            </table>
            {state?.editing && (
                <div className="composer">
                    <label htmlFor="message">Commit message</label>
                    <textarea
                        id="message"
                        ref={messageRef}
                        spellCheck
                        placeholder="Subject (50 chars), blank line, then body (72 chars per line)"
                        value={draft}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            api.postMessage({ type: "draft", body: event.target.value });
                        }}
                    />
                    <div className="actions">
                        <button onClick={() => api.postMessage({ type: "cancel" })}>Cancel</button>
                        <button className="primary" onClick={() => api.postMessage({ type: "submit", body: draft })}>
                            {state.editing.kind === "edit" ? "Update" : "Commit"}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
