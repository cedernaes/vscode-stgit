export function nextStagedFileLine(workTreeLine: number, fileIndex: number, fileCount: number): number | undefined {
    return fileIndex + 1 < fileCount ? workTreeLine + fileIndex + 2 : undefined;
}

export function remainingIndexFileLine(indexLine: number, fileIndex: number, fileCount: number): number {
    if (fileIndex > 0) {
        return indexLine + fileIndex;
    }
    return fileCount > 1 ? indexLine + 2 : indexLine;
}

export function correspondingLine(previous: string, next: string, line: number): number {
    const oldLines = previous.split("\n");
    const newLines = next.split("\n");
    const text = oldLines[line];
    if (text === undefined) {
        return Math.min(line, newLines.length - 1);
    }
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
        prefix++;
    }
    if (line < prefix) {
        return line;
    }
    let suffix = 0;
    while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) {
        suffix++;
    }
    if (line >= oldLines.length - suffix) {
        return line + newLines.length - oldLines.length;
    }
    const oldWorkTree = oldLines.findIndex((value) => value.startsWith("   ▾ Work Tree"));
    const newWorkTree = newLines.findIndex((value) => value.startsWith("   ▾ Work Tree"));
    if (oldWorkTree >= 0 && line === oldWorkTree + 1 && newWorkTree >= 0 && newLines[newWorkTree + 1]?.trim() === "<no files>") {
        return newWorkTree + 1;
    }
    const matches = newLines.flatMap((value, index) => (value === text ? [index] : []));
    if (matches.length) {
        return matches.reduce((best, index) => (Math.abs(index - line) < Math.abs(best - line) ? index : best));
    }
    return Math.min(line, newLines.length - 1);
}
