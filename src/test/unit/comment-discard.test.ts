import * as assert from "assert";
import { readFileSync } from "fs";
import * as path from "path";
import { CommentDraft, confirmCommentDiscard } from "../../comment-discard";

suite("Comment discard", () => {
    test("Escape cancels the webview composer without invoking patch actions", () => {
        const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
        const bindings = manifest.contributes.keybindings.filter((binding: { key: string; command: string; when?: string }) => {
            return binding.key === "escape" && binding.when?.includes("activeWebviewPanelId == stgit");
        });
        assert.deepStrictEqual(bindings, [
            {
                key: "escape",
                command: "stgit.cancel",
                when: "activeWebviewPanelId == stgit && !stgitEditing && !inQuickOpen && !terminalFocus && !inputFocus",
            },
        ]);
    });

    test("closes without asking when there are no unsaved changes", async () => {
        let asked = false;
        const allowed = await confirmCommentDiscard(false, async () => {
            asked = true;
            return false;
        });
        assert.strictEqual(allowed, true);
        assert.strictEqual(asked, false);
    });

    test("keeps a changed comment when the prompt is dismissed", async () => {
        let asked = false;
        const allowed = await confirmCommentDiscard(true, async () => {
            asked = true;
            return false;
        });
        assert.strictEqual(allowed, false);
        assert.strictEqual(asked, true);
    });

    test("closes a changed comment when discard is confirmed", async () => {
        const allowed = await confirmCommentDiscard(true, async () => true);
        assert.strictEqual(allowed, true);
    });

    test("does not mark a draft as changed before its input opens", () => {
        assert.strictEqual(new CommentDraft("").hasChanges, false);
        assert.strictEqual(new CommentDraft("Original message").hasChanges, false);
    });

    for (const [name, initialBody, body, expected] of [
        ["empty new message", "", "", false],
        ["unchanged existing message", "Original message", "Original message", false],
        ["new message", "", "New message", true],
        ["changed existing message", "Original message", "Changed message", true],
        ["deleted existing message", "Original message", "", true],
        ["normalized line endings", "Subject\r\n\r\nBody\r\n", "Subject\n\nBody\n", false],
    ] as const) {
        test(`detects unsaved changes for ${name}`, () => {
            const draft = new CommentDraft(initialBody);
            draft.trackDocument({ uri: { scheme: "comment", path: "/commentinput-1.md" }, getText: () => body });
            assert.strictEqual(draft.hasChanges, expected);
        });
    }

    test("stops prompting when edits are reverted to the original text", () => {
        const draft = new CommentDraft("Original message");
        let body = "Changed message";
        draft.trackDocument({ uri: { scheme: "comment", path: "/commentinput-1.md" }, getText: () => body });
        assert.strictEqual(draft.hasChanges, true);
        body = "Original message";
        assert.strictEqual(draft.hasChanges, false);
    });

    test("ignores unrelated documents and other drafts opened later", () => {
        const draft = new CommentDraft("Original message");
        draft.trackDocument({ uri: { scheme: "file", path: "/commentinput-1.md" }, getText: () => "Other message" });
        draft.trackDocument({ uri: { scheme: "comment", path: "/other-comment.md" }, getText: () => "Other message" });
        assert.strictEqual(draft.hasChanges, false);
        draft.trackDocument({ uri: { scheme: "comment", path: "/commentinput-1.md" }, getText: () => "Original message" });
        draft.trackDocument({ uri: { scheme: "comment", path: "/commentinput-2.md" }, getText: () => "Other message" });
        assert.strictEqual(draft.hasChanges, false);
    });
});
