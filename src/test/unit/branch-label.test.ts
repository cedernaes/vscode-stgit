import * as assert from "assert";
import { formatUpstream } from "../../branch-label";

suite("Branch label", () => {
    test("abbreviates an upstream with the same name as the branch", () => {
        assert.strictEqual(formatUpstream("webview", "fork", "webview"), " <-> fork/*");
        assert.strictEqual(formatUpstream("feature/x", "origin", "feature/x"), " <-> origin/*");
    });

    test("shows an upstream with a different name in full", () => {
        assert.strictEqual(formatUpstream("webview", "fork", "main"), " <-> fork/main");
    });

    test("does not abbreviate without a branch name", () => {
        assert.strictEqual(formatUpstream(null, "fork", "main"), " <-> fork/main");
    });

    test("shows only the remote when there is no upstream branch", () => {
        assert.strictEqual(formatUpstream("webview", "fork", null), " (fork)");
        assert.strictEqual(formatUpstream("webview", null, null), "");
    });
});
