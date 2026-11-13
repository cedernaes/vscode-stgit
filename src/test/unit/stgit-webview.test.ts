import * as assert from "assert";
import { readFileSync } from "fs";
import * as path from "path";
import * as vm from "vm";
import { JSDOM } from "jsdom";
import { stgitWebviewHtml } from "../../stgit-webview";
import type { StGitViewState } from "../../stgit-webview";

async function until(condition: () => boolean) {
    for (let attempt = 0; attempt < 30; attempt++) {
        if (condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(condition(), "webview did not update in time");
}

suite("StGit webview", () => {
    test("loads the compiled React bundle and stylesheet under a restrictive CSP", () => {
        const assetRoot = path.resolve(__dirname, "../../../out/webview");
        const script = readFileSync(path.join(assetRoot, "index.js"), "utf8");
        assert.doesNotThrow(() => new vm.Script(script));
        assert.ok(readFileSync(path.join(assetRoot, "index.css"), "utf8").includes(".loading"));
        const webview = {
            cspSource: "vscode-resource:",
            asWebviewUri: (uri: { toString(): string }) => uri,
        } as unknown as Parameters<typeof stgitWebviewHtml>[0];
        const assets = {
            script: { toString: () => "vscode-resource:/out/webview/index.js?v=1" },
            style: { toString: () => "vscode-resource:/out/webview/index.css?v=1" },
        } as Parameters<typeof stgitWebviewHtml>[1];
        const html = stgitWebviewHtml(webview, assets);
        assert.match(html, /default-src 'none'/);
        assert.match(html, /script-src vscode-resource:/);
        assert.match(html, /src="vscode-resource:.*index\.js\?v=1"/);
        assert.match(html, /href="vscode-resource:.*index\.css\?v=1"/);
        assert.doesNotMatch(html, /<script>.*<\/script>/s);
    });

    test("renders state safely and sends selection, commands and commit drafts", async () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
            url: "https://stgit.test/",
            runScripts: "outside-only",
            pretendToBeVisual: true,
        });
        const style = dom.window.document.createElement("style");
        style.textContent = readFileSync(path.resolve(__dirname, "../../../out/webview/index.css"), "utf8");
        dom.window.document.head.append(style);
        const vscodeStyle = dom.window.document.createElement("style");
        vscodeStyle.textContent = "body, table, button, textarea { font-family: sans-serif; }";
        dom.window.document.head.append(vscodeStyle);
        const messages: unknown[] = [];
        let persistedScroll = 60;
        const restoredScroll: number[] = [];
        Object.defineProperty(dom.window, "scrollTo", { value: (_x: number, scrollY: number) => restoredScroll.push(scrollY) });
        const webviewApi = {
            postMessage: (message: unknown) => messages.push(JSON.parse(JSON.stringify(message))),
            getState: () => ({ scrollY: persistedScroll }),
            setState: (state: { scrollY: number }) => {
                persistedScroll = state.scrollY;
            },
        };
        (dom.window as unknown as { acquireVsCodeApi: () => typeof webviewApi }).acquireVsCodeApi = () => webviewApi;
        dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
        const script = readFileSync(path.resolve(__dirname, "../../../out/webview/index.js"), "utf8");
        try {
            dom.window.eval(script);
            await until(() => messages.some((message) => (message as { type: string }).type === "ready"));

            const state: StGitViewState = {
                branch: "feature/<branch>",
                submodule: "",
                notice: "",
                noticeCommand: "",
                selected: { patchId: "+:patch" },
                loading: true,
                editing: null,
                rows: [
                    {
                        id: "+:patch",
                        kind: "+",
                        symbol: "+",
                        description: "<img src=x onerror=alert(1)>",
                        expanded: true,
                        marked: false,
                        empty: false,
                        highlighted: false,
                        files: [{ path: "file-a", name: "file-a", status: "Modified", kind: "M", highlighted: false }],
                    },
                    {
                        id: "I:",
                        kind: "I",
                        symbol: "Index",
                        description: "Index",
                        expanded: true,
                        marked: false,
                        empty: false,
                        highlighted: false,
                        files: [{ path: "old-name", name: "old-name -> new-name", status: "Rename 100%", kind: "R", highlighted: false }],
                    },
                    {
                        id: "W:",
                        kind: "W",
                        symbol: "Work Tree",
                        description: "Work Tree",
                        expanded: true,
                        marked: false,
                        empty: false,
                        highlighted: false,
                        files: [{ path: "local-file", name: "local-file", status: "Modified", kind: "M", highlighted: false }],
                    },
                ],
            };
            const render = () => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "render", state: { ...state, rows: [...state.rows] } } }));
            render();
            await until(() => !!dom.window.document.querySelector('tr[data-path="file-a"]'));
            assert.deepStrictEqual(restoredScroll, [60]);
            assert.strictEqual(dom.window.document.querySelector("img"), null);
            assert.match(dom.window.document.querySelector(".name")!.textContent!, /<img src=x/);
            const status = () => dom.window.document.querySelector<HTMLElement>('.heading [role="status"]')!;
            const spinnerVisibility = () => dom.window.getComputedStyle(status().querySelector(".spinner")!).visibility;
            assert.strictEqual(status().textContent, "Running / refreshing...");
            assert.strictEqual(spinnerVisibility(), "visible");
            // When VS Code focuses the newly opened webview, the selected row takes keyboard focus.
            assert.strictEqual(dom.window.document.activeElement, dom.window.document.body);
            dom.window.dispatchEvent(new dom.window.FocusEvent("focus"));
            assert.strictEqual(dom.window.document.activeElement?.getAttribute("data-patch-id"), "+:patch");
            assert.strictEqual(dom.window.document.activeElement?.hasAttribute("data-path"), false);
            for (const section of ["I:", "W:"]) {
                const header = dom.window.document.querySelector<HTMLTableRowElement>(`tr[data-patch-id="${section}"]:not(.file)`)!;
                assert.strictEqual(header.querySelector("[aria-expanded]")?.getAttribute("aria-expanded"), "true");
                assert.ok(dom.window.document.querySelector(`tr[data-patch-id="${section}"].file`));
                assert.strictEqual(dom.window.getComputedStyle(header).height, "20px");
            }
            for (const element of ["#root", "table", "button"]) {
                assert.match(dom.window.getComputedStyle(dom.window.document.querySelector(element)!).fontFamily, /monospace/);
            }
            assert.ok(dom.window.document.querySelector('tr[data-kind="R"]'));
            assert.match(style.textContent!, /\.file\[data-kind=(?:"R"|R)\].*--vscode-gitDecoration-deletedResourceForeground/s);

            const file = dom.window.document.querySelector<HTMLTableRowElement>('tr[data-path="file-a"]')!;
            file.click();
            await until(() => messages.some((message) => (message as { type: string }).type === "select"));
            assert.deepStrictEqual(messages.at(-1), { type: "select", patchId: "+:patch", path: "file-a" });
            file.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            assert.deepStrictEqual(messages.at(-1), { type: "command", command: "stgit.toggleExpand" });

            for (const patch of state.rows) {
                patch.files = [];
            }
            render();
            await until(() => dom.window.document.querySelectorAll("tr.empty").length === 3);
            assert.deepStrictEqual(
                [...dom.window.document.querySelectorAll("tr.empty .name")].map((cell) => cell.textContent),
                ["No files", "No changes", "No changes"],
            );
            assert.strictEqual(dom.window.document.querySelectorAll("tr[data-row]").length, 3);
            state.rows[1].expanded = false;
            render();
            await until(() => dom.window.document.querySelectorAll("tr.empty").length === 2);
            assert.strictEqual(dom.window.document.querySelector('tr[data-patch-id="I:"] .expand')?.getAttribute("aria-expanded"), "false");

            state.loading = false;
            state.editing = { kind: "create", body: "Initial" };
            render();
            await until(() => dom.window.document.querySelector<HTMLTextAreaElement>("textarea")?.value === "Initial");
            // The status slot stays in place when loading ends, so the layout does not shift.
            assert.strictEqual(status().textContent, "");
            assert.strictEqual(spinnerVisibility(), "hidden");
            const editor = dom.window.document.querySelector<HTMLTextAreaElement>("textarea")!;
            assert.match(dom.window.getComputedStyle(editor).fontFamily, /monospace/);
            const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
            setter.call(editor, "Draft text");
            editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
            await until(() => messages.some((message) => (message as { type: string; body?: string }).type === "draft" && (message as { body: string }).body === "Draft text"));
            render();
            assert.strictEqual(editor.value, "Draft text");
            editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
            assert.deepStrictEqual(messages.at(-1), { type: "submit", body: "Draft text" });
            editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            assert.deepStrictEqual(messages.at(-1), { type: "cancel" });
        } finally {
            dom.window.close();
        }
    });

    test("scopes patch shortcuts to the webview outside commit editing", () => {
        const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
        const shortcuts: { key: string; command: string; when: string }[] = manifest.contributes.keybindings;
        const patchShortcuts = shortcuts.filter((binding) => binding.command.startsWith("stgit.") && binding.command !== "stgit.open");
        assert.ok(patchShortcuts.length > 30);
        assert.ok(!patchShortcuts.some((binding) => binding.key === "enter"));
        for (const binding of patchShortcuts) {
            assert.match(binding.when, /activeWebviewPanelId == stgit/);
            assert.doesNotMatch(binding.when, /editorTextFocus|resourceScheme/);
            assert.match(binding.when, /!inQuickOpen && !terminalFocus/);
        }
        assert.strictEqual(
            shortcuts.find((binding) => binding.command === "stgit.submitComment")?.when,
            "activeWebviewPanelId == stgit && stgitEditing && !inQuickOpen && !terminalFocus",
        );
    });
});
