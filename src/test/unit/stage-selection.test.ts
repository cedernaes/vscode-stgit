import * as assert from "assert";
import { correspondingLine, nextStagedFileLine, remainingIndexFileLine } from "../../stage-selection";

suite("Stage selection", () => {
    test("keeps the cursor on its file when a redraw changes line counts", () => {
        const before = "Branch\nIndex\n    Modified  file-a\nWork Tree";
        const after = "Branch\nIndex\n    Modified  file-b\n" + "    Modified  file-a\nWork Tree";
        assert.strictEqual(correspondingLine(before, after, 2), 3);
        assert.strictEqual(correspondingLine(after, before, 3), 2);
        assert.strictEqual(correspondingLine(before, before, 2), 2);
        assert.strictEqual(correspondingLine(before, "Branch\nIndex", 2), 1);
        const repeated = "Branch\nPatch A\n    file-a\n" + "Patch B\n    file-a\nEnd";
        const expanded = "Branch\nPatch A\n    file-a\n" + "Patch B\n    file-b\n    file-a\nEnd";
        assert.strictEqual(correspondingLine(repeated, expanded, 4), 5);
    });

    test("advances to the next work-tree file after staging a middle file", () => {
        const before = "Index\n    already.txt\nWork Tree\n    alpha.txt\n    beta.txt\n    gamma.txt\nEnd";
        const after = "Index\n    already.txt\n    beta.txt\nWork Tree\n    alpha.txt\n    gamma.txt\nEnd";
        const target = nextStagedFileLine(2, 1, 3) ?? -1;
        assert.strictEqual(after.split("\n")[correspondingLine(before, after, target)], "    gamma.txt");
    });

    test("stages consecutive files and keeps the final selection in the work tree", () => {
        const indexFiles = ["already.txt"];
        const workTreeFiles = ["alpha.txt", "beta.txt", "gamma.txt"];
        assert.strictEqual(nextStagedFileLine(2, 0, 1), undefined);
        while (workTreeFiles.length) {
            const before = ["   ▾ Index", ...indexFiles, "   ▾ Work Tree [+untracked]", ...workTreeFiles, "--"].join("\n");
            const workTreeLine = indexFiles.length + 1;
            const target = nextStagedFileLine(workTreeLine, 0, workTreeFiles.length) ?? workTreeLine + 1;
            indexFiles.push(workTreeFiles.shift()!);
            const after = ["   ▾ Index", ...indexFiles, "   ▾ Work Tree [+untracked]", ...(workTreeFiles.length ? workTreeFiles : ["    <no files>"]), "--"].join("\n");
            const selected = after.split("\n")[correspondingLine(before, after, target)];
            assert.strictEqual(selected, workTreeFiles[0] ?? "    <no files>");
        }
    });

    test("unstages files from the bottom while selecting the preceding indexed file", () => {
        const indexFiles = [".github/asd", ".github/asd2", ".github/asd3"];
        const workTreeFiles: string[] = [];
        while (indexFiles.length) {
            const before = [
                "> <no patch applied>",
                "   ▾ Index",
                ...indexFiles,
                "   ▾ Work Tree [+untracked]",
                ...(workTreeFiles.length ? workTreeFiles : ["     <no files>"]),
                "--",
            ].join("\n");
            const fileIndex = indexFiles.length - 1;
            const target = remainingIndexFileLine(1, fileIndex, indexFiles.length);
            const removed = indexFiles.pop()!;
            workTreeFiles.push(removed);
            const after = [
                "> <no patch applied>",
                "   ▾ Index",
                ...(indexFiles.length ? indexFiles : ["    <no files>"]),
                "   ▾ Work Tree [+untracked]",
                ...workTreeFiles,
                "--",
            ].join("\n");
            const selected = after.split("\n")[correspondingLine(before, after, target)];
            assert.strictEqual(selected, indexFiles.at(-1) ?? "   ▾ Index");
        }
    });

    test("unstaging the first indexed file selects the next one", () => {
        const before = "Index\n    alpha.txt\n    beta.txt\nWork Tree\nEnd";
        const after = "Index\n    beta.txt\nWork Tree\n    alpha.txt\nEnd";
        const target = remainingIndexFileLine(0, 0, 2);
        assert.strictEqual(after.split("\n")[correspondingLine(before, after, target)], "    beta.txt");
    });
});
