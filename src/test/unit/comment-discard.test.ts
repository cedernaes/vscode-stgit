import * as assert from "assert";
import { readFileSync } from "fs";
import * as path from "path";
import { confirmCommentDiscard } from "../../comment-discard";

suite("Comment discard", () => {
    test("Escape closes an empty focused comment without prompting", () => {
        const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
        const bindings = manifest.contributes.keybindings.filter((binding: { key: string; command: string; when?: string }) => {
            return binding.key === "escape" && binding.when?.includes("resourceScheme == stgit");
        });
        assert.strictEqual(bindings.at(-2).command, "stgit.cancel");
        assert.deepStrictEqual(bindings.at(-1), {
            key: "escape",
            command: "stgit.cancelEmptyComment",
            when: "resourceScheme == stgit && commentEditorFocused && commentIsEmpty",
        });
    });

    test("closes when no comment is open without asking", async () => {
        let asked = false;
        const allowed = await confirmCommentDiscard(false, async () => {
            asked = true;
            return false;
        });
        assert.strictEqual(allowed, true);
        assert.strictEqual(asked, false);
    });

    test("keeps an open comment when the prompt is dismissed", async () => {
        let asked = false;
        const allowed = await confirmCommentDiscard(true, async () => {
            asked = true;
            return false;
        });
        assert.strictEqual(allowed, false);
        assert.strictEqual(asked, true);
    });

    test("closes an open comment when discard is confirmed", async () => {
        const allowed = await confirmCommentDiscard(true, async () => true);
        assert.strictEqual(allowed, true);
    });
});
