import * as assert from "assert";
import { correspondingLine, nextStagedFileLine } from "../../stage-selection";

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
        const target = nextStagedFileLine(2, 1, 3);
        assert.strictEqual(after.split("\n")[correspondingLine(before, after, target)], "    gamma.txt");
    });

    test("stages consecutive files and keeps the final one selected in the index", () => {
        const indexFiles = ["already.txt"];
        const workTreeFiles = ["alpha.txt", "beta.txt", "gamma.txt"];
        while (workTreeFiles.length) {
            const before = ["Index", ...indexFiles, "Work Tree", ...workTreeFiles, "End"].join("\n");
            const workTreeLine = indexFiles.length + 1;
            const target = nextStagedFileLine(workTreeLine, 0, workTreeFiles.length);
            indexFiles.push(workTreeFiles.shift()!);
            const after = ["Index", ...indexFiles, "Work Tree", ...workTreeFiles, "End"].join("\n");
            const selected = after.split("\n")[correspondingLine(before, after, target)];
            assert.strictEqual(selected, workTreeFiles[0] ?? indexFiles.at(-1));
        }
    });
});
