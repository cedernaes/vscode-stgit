import * as assert from "assert";
import { MutationGate } from "../../mutation-gate";
import { RepoDisplayLoads } from "../../repo-reader";

suite("Mutation gate", () => {
    test("starts a mutation without waiting for an in-flight read and discards its result", async () => {
        let finishRead!: (value: string) => void;
        const shown: string[] = [];
        const loads = new RepoDisplayLoads({ topLevelDir: "/repo" }, { run: async () => "", runCommand: async () => ({ stdout: "", stderr: "", ecode: 0 }) }, (_kind, error) =>
            assert.fail(String(error)),
        );
        const gate = new MutationGate(
            () => loads.pause(),
            () => loads.resume(),
        );
        const read = loads.loadSeries(
            () =>
                new Promise<string>((resolve) => {
                    finishRead = resolve;
                }),
            (value) => shown.push(value),
        );
        let started = false;
        const mutation = gate.run(async () => {
            started = true;
        });
        await mutation;
        assert.strictEqual(started, true);
        finishRead("stale");
        await read;
        assert.strictEqual(shown.length, 0);
        await loads.loadSeries(
            async () => "fresh",
            (value) => shown.push(value),
        );
        assert.deepStrictEqual(shown, ["fresh"]);
        loads.dispose();
    });

    test("serializes overlapping mutations and resumes once after both finish", async () => {
        const events: string[] = [];
        let finishFirst!: () => void;
        const gate = new MutationGate(
            () => events.push("paused"),
            () => events.push("resumed"),
        );
        const first = gate.run(async () => {
            events.push("first started");
            await new Promise<void>((resolve) => {
                finishFirst = resolve;
            });
        });
        const second = gate.run(async () => {
            events.push("second started");
        });
        await Promise.resolve();
        assert.deepStrictEqual(events, ["paused", "first started"]);
        finishFirst();
        await Promise.all([first, second]);
        assert.deepStrictEqual(events, ["paused", "first started", "second started", "resumed"]);
    });

    test("resumes after a failed mutation", async () => {
        const events: string[] = [];
        const gate = new MutationGate(
            () => events.push("paused"),
            () => events.push("resumed"),
        );
        await assert.rejects(
            gate.run(async () => {
                throw new Error("failed");
            }),
            /failed/,
        );
        assert.deepStrictEqual(events, ["paused", "resumed"]);
    });
});
