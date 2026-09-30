export function nextStagedFileLine(workTreeLine: number, fileIndex: number, fileCount: number): number {
    return workTreeLine + fileIndex + (fileIndex + 1 < fileCount ? 2 : 1);
}

export function correspondingLine(previous: string, next: string, line: number): number {
    const oldLines = previous.split("\n");
    const newLines = next.split("\n");
    const text = oldLines[line];
    if (text === undefined) return Math.min(line, newLines.length - 1);
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
    if (line < prefix) return line;
    let suffix = 0;
    while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix++;
    if (line >= oldLines.length - suffix) return line + newLines.length - oldLines.length;
    const matches = newLines.flatMap((value, index) => (value === text ? [index] : []));
    if (matches.length) return matches.reduce((best, index) => (Math.abs(index - line) < Math.abs(best - line) ? index : best));
    return Math.min(line, newLines.length - 1);
}
