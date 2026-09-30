/*
 * Release helper: bumps the version in package.json (and package-lock.json)
 * and turns the "[Unreleased]" changelog section into a released section,
 * leaving a fresh empty "[Unreleased]" section behind.
 *
 * Usage:
 *   node out/release.js <major|minor|patch> [--date=YYYY-MM-DD] [--dry-run]
 *   node out/release.js notes [<version>]
 *
 * "bump" prints the new version on stdout; "notes" prints the changelog
 * entries of a released version (the most recent one by default).
 */
import * as fs from "fs";
import * as path from "path";

export type BumpKind = "major" | "minor" | "patch";

export interface Version {
    major: number;
    minor: number;
    patch: number;
}

export const unreleasedHeading = "## [Unreleased]";

const bumpKinds: readonly string[] = ["major", "minor", "patch"];

export function isBumpKind(kind: string): kind is BumpKind {
    return bumpKinds.includes(kind);
}

export function parseVersion(version: string): Version {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    if (!m) {
        throw new Error(`Not an 'x.y.z' version: '${version}'`);
    }
    return {
        major: parseInt(m[1], 10),
        minor: parseInt(m[2], 10),
        patch: parseInt(m[3], 10),
    };
}

export function formatVersion(v: Version): string {
    return `${v.major}.${v.minor}.${v.patch}`;
}

export function bumpVersion(version: string, kind: BumpKind): string {
    const v = parseVersion(version);
    switch (kind) {
        case "major":
            return formatVersion({ major: v.major + 1, minor: 0, patch: 0 });
        case "minor":
            return formatVersion({ ...v, minor: v.minor + 1, patch: 0 });
        case "patch":
            return formatVersion({ ...v, patch: v.patch + 1 });
    }
}

export function parsePackageVersion(json: string): string {
    let pkg: { version?: unknown };
    try {
        pkg = JSON.parse(json) as { version?: unknown };
    } catch (e) {
        throw new Error(`package.json is not valid JSON: ${String(e)}`);
    }
    if (typeof pkg.version !== "string") {
        throw new Error("package.json has no 'version' string");
    }
    parseVersion(pkg.version);
    return pkg.version;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces the top-level "version" field, leaving the rest of the file
 * (indentation, key order, comments in the JSON's whitespace) untouched.
 */
export function setPackageVersion(json: string, version: string): string {
    const current = parsePackageVersion(json);
    parseVersion(version);
    const re = new RegExp(`("version"\\s*:\\s*")${escapeRegExp(current)}(")`);
    if (!re.test(json)) {
        throw new Error(`Could not locate the '${current}' version field`);
    }
    return json.replace(re, `$1${version}$2`);
}

/**
 * Updates the two version fields npm keeps for the package itself: the
 * root one and the one of the "" entry in "packages". Dependency versions
 * are left alone.
 */
export function setLockVersion(lock: string, version: string): string {
    const current = parsePackageVersion(lock);
    parseVersion(version);
    const quoted = escapeRegExp(current);
    const rootRe = new RegExp(`("version"\\s*:\\s*")${quoted}(")`);
    let updated = lock.replace(rootRe, `$1${version}$2`);
    const selfRe = new RegExp(`("packages"\\s*:\\s*\\{\\s*""\\s*:\\s*\\{` + `[^{}]*?"version"\\s*:\\s*")${quoted}(")`);
    updated = updated.replace(selfRe, `$1${version}$2`);
    return updated;
}

function isSectionHeading(line: string): boolean {
    return /^##\s+/.test(line);
}

function isUnreleasedHeading(line: string): boolean {
    return /^##\s+\[unreleased\]/i.test(line);
}

function versionHeadingRe(version: string): RegExp {
    return new RegExp(`^##\\s+\\[${escapeRegExp(version)}\\]`);
}

function dropTrailingBlanks(lines: string[]): string[] {
    const end = [...lines];
    while (end.length && end[end.length - 1].trim() === "") {
        end.pop();
    }
    return end;
}

function dropLeadingBlanks(lines: string[]): string[] {
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") {
        i++;
    }
    return lines.slice(i);
}

function findSection(lines: string[], matches: (line: string) => boolean) {
    const start = lines.findIndex(matches);
    if (start < 0) {
        return undefined;
    }
    let end = start + 1;
    while (end < lines.length && !isSectionHeading(lines[end])) {
        end++;
    }
    return { start, end, body: lines.slice(start + 1, end) };
}

export function isEmptyChangelogBody(body: string[]): boolean {
    return !body.some((line) => {
        const text = line.trim();
        return text !== "" && !/^#{3,}\s/.test(text);
    });
}

export function releaseDate(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

function checkDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`Not a 'YYYY-MM-DD' date: '${date}'`);
    }
}

/**
 * Renames the "[Unreleased]" section to "[version] - date" and inserts a
 * fresh, empty "[Unreleased]" section above it.
 */
export function releaseUnreleasedSection(changelog: string, version: string, date: string): string {
    parseVersion(version);
    checkDate(date);
    const lines = changelog.split("\n");
    const section = findSection(lines, isUnreleasedHeading);
    if (!section) {
        throw new Error(`CHANGELOG.md has no '${unreleasedHeading}' section`);
    }
    if (isEmptyChangelogBody(section.body)) {
        throw new Error(`The '${unreleasedHeading}' section is empty; nothing to release`);
    }
    if (findSection(lines, (line) => versionHeadingRe(version).test(line))) {
        throw new Error(`CHANGELOG.md already has a ${version} section`);
    }

    const head = dropTrailingBlanks(lines.slice(0, section.start));
    const body = dropTrailingBlanks(dropLeadingBlanks(section.body));
    const tail = dropLeadingBlanks(lines.slice(section.end));
    const result = [...head, "", unreleasedHeading, "", `## [${version}] - ${date}`, "", ...body, "", ...tail];
    return `${dropTrailingBlanks(result).join("\n")}\n`;
}

/**
 * Returns the changelog entries of a released version, or of the most
 * recent released version if none is given.
 */
export function extractReleaseNotes(changelog: string, version?: string): string {
    const lines = changelog.split("\n");
    const matches = version ? (line: string) => versionHeadingRe(version).test(line) : (line: string) => /^##\s+\[\d+\.\d+\.\d+\]/.test(line);
    const section = findSection(lines, matches);
    if (!section) {
        throw new Error(version ? `CHANGELOG.md has no ${version} section` : "CHANGELOG.md has no released version section");
    }
    const body = dropTrailingBlanks(dropLeadingBlanks(section.body));
    return body.length ? `${body.join("\n")}\n` : "";
}

export interface ReleaseResult {
    previousVersion: string;
    version: string;
    tag: string;
    date: string;
    notes: string;
    changedFiles: string[];
}

export interface ReleaseOptions {
    root: string;
    kind: BumpKind;
    date?: string;
    dryRun?: boolean;
}

/** Performs the release bump in a work tree. */
export function performRelease(opts: ReleaseOptions): ReleaseResult {
    const { root, kind } = opts;
    const date = opts.date ?? releaseDate();
    const packagePath = path.join(root, "package.json");
    const lockPath = path.join(root, "package-lock.json");
    const changelogPath = path.join(root, "CHANGELOG.md");

    const packageJson = fs.readFileSync(packagePath, "utf8");
    const previousVersion = parsePackageVersion(packageJson);
    const version = bumpVersion(previousVersion, kind);
    const changelog = fs.readFileSync(changelogPath, "utf8");

    const newPackageJson = setPackageVersion(packageJson, version);
    const newChangelog = releaseUnreleasedSection(changelog, version, date);
    const hasLock = fs.existsSync(lockPath);
    const newLock = hasLock ? setLockVersion(fs.readFileSync(lockPath, "utf8"), version) : undefined;

    const changedFiles = ["package.json", "CHANGELOG.md"];
    if (hasLock) {
        changedFiles.push("package-lock.json");
    }
    if (!opts.dryRun) {
        fs.writeFileSync(packagePath, newPackageJson);
        fs.writeFileSync(changelogPath, newChangelog);
        if (newLock !== undefined) {
            fs.writeFileSync(lockPath, newLock);
        }
    }
    return {
        previousVersion,
        version,
        tag: `v${version}`,
        date,
        notes: extractReleaseNotes(newChangelog, version),
        changedFiles,
    };
}

const usage = ["Usage:", "  release <major|minor|patch> [--date=YYYY-MM-DD] [--dry-run]", "  release notes [<version>]"].join("\n");

export function runCli(argv: string[], root: string): string {
    const args = argv.filter((a) => !a.startsWith("--"));
    const flags = argv.filter((a) => a.startsWith("--"));
    const command = args[0] === "bump" ? args[1] : args[0];

    for (const flag of flags) {
        if (!/^--(dry-run|date=\d{4}-\d{2}-\d{2}|help)$/.test(flag)) {
            throw new Error(`Unknown option: ${flag}\n${usage}`);
        }
    }
    if (flags.includes("--help")) {
        return usage;
    }
    if (command === "notes") {
        const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
        return extractReleaseNotes(changelog, args[1]);
    }
    if (!command || !isBumpKind(command)) {
        throw new Error(`Expected 'major', 'minor' or 'patch'\n${usage}`);
    }
    const dateFlag = flags.find((f) => f.startsWith("--date="));
    const result = performRelease({
        root,
        kind: command,
        date: dateFlag?.slice("--date=".length),
        dryRun: flags.includes("--dry-run"),
    });
    process.stderr.write(`${result.previousVersion} -> ${result.version} (${result.date})\n`);
    if (flags.includes("--dry-run")) {
        process.stderr.write("Dry run: no files were written\n");
    }
    return result.version;
}

function main() {
    try {
        const out = runCli(process.argv.slice(2), process.env.RELEASE_ROOT ?? path.resolve(__dirname, ".."));
        process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
    } catch (e) {
        process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
