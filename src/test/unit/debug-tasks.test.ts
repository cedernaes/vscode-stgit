import * as assert from "assert";
import { readFileSync } from "fs";
import * as path from "path";
import * as ts from "typescript";

function readConfig(file: string): Record<string, unknown> {
    const location = path.resolve(__dirname, "../../../.vscode", file);
    const parsed = ts.parseConfigFileTextToJson(location, readFileSync(location, "utf8"));
    assert.strictEqual(parsed.error, undefined);
    return parsed.config as Record<string, unknown>;
}

suite("Extension debug tasks", () => {
    test("compiles host and webview assets before starting watch for every launch", () => {
        const tasks = readConfig("tasks.json").tasks as {
            label: string;
            script?: string;
            isBackground?: boolean;
            dependsOn?: string[];
            dependsOrder?: string;
            problemMatcher?: { base: string; background: { activeOnStart: boolean; beginsPattern: string; endsPattern: string } };
        }[];
        const compile = tasks.find((task) => task.label === "stgit: compile");
        const watch = tasks.find((task) => task.label === "stgit: watch");
        const debug = tasks.find((task) => task.label === "stgit: debug");
        assert.strictEqual(compile?.script, "compile");
        assert.strictEqual(watch?.script, "watch");
        assert.strictEqual(watch?.isBackground, true);
        assert.strictEqual(watch?.problemMatcher?.base, "$tsc-watch");
        assert.strictEqual(watch?.problemMatcher?.background.activeOnStart, true);
        const readiness = watch!.problemMatcher!.background;
        assert.match("[0] 2:26:27 PM - Starting compilation in watch mode...", new RegExp(readiness.beginsPattern));
        assert.match("[0] 2:26:28 PM - Found 0 errors. Watching for file changes.", new RegExp(readiness.endsPattern));
        assert.doesNotMatch("[1] 2:26:28 PM - Found 0 errors. Watching for file changes.", new RegExp(readiness.endsPattern));
        assert.strictEqual(debug?.dependsOrder, "sequence");
        assert.deepStrictEqual(debug?.dependsOn, [compile.label, watch.label]);
        const launches = readConfig("launch.json").configurations as { preLaunchTask: string }[];
        assert.ok(launches.length > 0);
        assert.ok(launches.every((launch) => launch.preLaunchTask === debug.label));
    });
});
