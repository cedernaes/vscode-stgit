import type * as vscode from "vscode";

export interface StGitViewRow {
    id: string;
    kind: string;
    symbol: string;
    description: string;
    expanded: boolean;
    marked: boolean;
    empty: boolean;
    highlighted: boolean;
    files: { path: string; name: string; status: string; kind: string; highlighted: boolean }[];
}

export interface StGitViewState {
    branch: string;
    submodule: string;
    notice: string;
    noticeCommand: string;
    rows: StGitViewRow[];
    selected: { patchId: string; path?: string };
    loading: boolean;
    editing: { kind: "create" | "edit"; body: string } | null;
}

export function stgitWebviewHtml(webview: vscode.Webview, assets: { script: vscode.Uri; style: vscode.Uri }): string {
    const style = webview.asWebviewUri(assets.style);
    const script = webview.asWebviewUri(assets.script);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
    <title>StGit</title>
    <link rel="stylesheet" href="${style}">
    <script defer src="${script}"></script>
</head>
<body>
    <div id="root"></div>
</body>
</html>`;
}
