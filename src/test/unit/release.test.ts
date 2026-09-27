import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    bumpVersion, extractReleaseNotes, isBumpKind, parsePackageVersion,
    parseVersion, performRelease, releaseUnreleasedSection, runCli,
    setLockVersion, setPackageVersion,
} from '../../release';

const changelog = [
    '# Changelog',
    '',
    'All notable changes are documented in this file.',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '- Add a shiny thing',
    '',
    '### Fixed',
    '- Fix a broken thing',
    '',
    '## [1.2.3] - 2026-01-02',
    '',
    '### Added',
    '- Add an older thing',
    '',
].join('\n');

const packageJson = [
    '{',
    '    "name": "stgit",',
    '    "version": "1.2.3",',
    '    "engines": {',
    '        "vscode": "^1.91.0"',
    '    },',
    '    "devDependencies": {',
    '        "some-dep": "1.2.3"',
    '    }',
    '}',
    '',
].join('\n');

const packageLock = [
    '{',
    '    "name": "stgit",',
    '    "version": "1.2.3",',
    '    "lockfileVersion": 3,',
    '    "packages": {',
    '        "": {',
    '            "name": "stgit",',
    '            "version": "1.2.3",',
    '            "license": "BSD-2-Clause",',
    '            "devDependencies": {',
    '                "some-dep": "1.2.3"',
    '            }',
    '        },',
    '        "node_modules/some-dep": {',
    '            "version": "1.2.3"',
    '        }',
    '    }',
    '}',
    '',
].join('\n');

suite('Release version bumping', () => {
    test('bumps each version component', () => {
        assert.strictEqual(bumpVersion('1.2.0', 'major'), '2.0.0');
        assert.strictEqual(bumpVersion('1.2.0', 'minor'), '1.3.0');
        assert.strictEqual(bumpVersion('1.2.0', 'patch'), '1.2.1');
    });
    test('resets the less significant components', () => {
        assert.strictEqual(bumpVersion('1.2.3', 'major'), '2.0.0');
        assert.strictEqual(bumpVersion('1.2.3', 'minor'), '1.3.0');
        assert.strictEqual(bumpVersion('0.9.11', 'patch'), '0.9.12');
    });
    test('does not treat components as decimals', () => {
        assert.strictEqual(bumpVersion('0.9.9', 'patch'), '0.9.10');
        assert.strictEqual(bumpVersion('1.19.0', 'minor'), '1.20.0');
    });
    test('rejects versions that are not x.y.z', () => {
        for (const bad of ['1.2', 'v1.2.3', '1.2.3-beta', '1.2.3.4', '', 'x']) {
            assert.throws(() => parseVersion(bad), /Not an 'x.y.z' version/,
                `expected '${bad}' to be rejected`);
        }
    });
    test('accepts only the three release kinds', () => {
        assert.ok(isBumpKind('major') && isBumpKind('minor'));
        assert.ok(isBumpKind('patch'));
        assert.ok(!isBumpKind('Patch') && !isBumpKind('prerelease'));
    });
});

suite('Release manifest parsing', () => {
    test('reads the version from package.json', () => {
        assert.strictEqual(parsePackageVersion(packageJson), '1.2.3');
    });
    test('rejects a manifest without a usable version', () => {
        assert.throws(() => parsePackageVersion('{ "name": "stgit" }'),
            /has no 'version' string/);
        assert.throws(() => parsePackageVersion('{ "version": 1 }'),
            /has no 'version' string/);
        assert.throws(() => parsePackageVersion('{ "version": "1.2" }'),
            /Not an 'x.y.z' version/);
        assert.throws(() => parsePackageVersion('{ oops'), /not valid JSON/);
    });
    test('replaces the version without reformatting the manifest', () => {
        const updated = setPackageVersion(packageJson, '2.0.0');
        assert.strictEqual(updated, packageJson.replace(
            '"version": "1.2.3"', '"version": "2.0.0"'));
        assert.strictEqual(parsePackageVersion(updated), '2.0.0');
    });
    test('leaves dependency versions alone', () => {
        const updated = setPackageVersion(packageJson, '1.2.4');
        assert.ok(updated.includes('"some-dep": "1.2.3"'));
    });
    test('updates both package versions in the lock file', () => {
        const updated = setLockVersion(packageLock, '2.0.0');
        const lock = JSON.parse(updated) as {
            version: string;
            packages: Record<string, { version: string }>;
        };
        assert.strictEqual(lock.version, '2.0.0');
        assert.strictEqual(lock.packages[''].version, '2.0.0');
        assert.strictEqual(
            lock.packages['node_modules/some-dep'].version, '1.2.3');
        assert.strictEqual(updated.split('\n').length,
            packageLock.split('\n').length);
    });
});

suite('Release changelog rewriting', () => {
    test('renames the unreleased section and adds an empty one', () => {
        const updated = releaseUnreleasedSection(
            changelog, '1.3.0', '2026-09-27');
        assert.strictEqual(updated, [
            '# Changelog',
            '',
            'All notable changes are documented in this file.',
            '',
            '## [Unreleased]',
            '',
            '## [1.3.0] - 2026-09-27',
            '',
            '### Added',
            '- Add a shiny thing',
            '',
            '### Fixed',
            '- Fix a broken thing',
            '',
            '## [1.2.3] - 2026-01-02',
            '',
            '### Added',
            '- Add an older thing',
            '',
        ].join('\n'));
    });
    test('works when the unreleased section is the last one', () => {
        const only = '# Changelog\n\n## [Unreleased]\n\n- One thing\n';
        assert.strictEqual(
            releaseUnreleasedSection(only, '0.1.0', '2026-09-27'),
            '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-09-27\n\n'
            + '- One thing\n');
    });
    test('requires an unreleased section with entries', () => {
        assert.throws(() => releaseUnreleasedSection(
            '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- Thing\n',
            '1.0.1', '2026-09-27'), /no '## \[Unreleased\]' section/);
        assert.throws(() => releaseUnreleasedSection(
            '# Changelog\n\n## [Unreleased]\n\n### Added\n\n', '1.0.1',
            '2026-09-27'), /section is empty/);
    });
    test('refuses to release a version that already exists', () => {
        assert.throws(
            () => releaseUnreleasedSection(changelog, '1.2.3', '2026-09-27'),
            /already has a 1\.2\.3 section/);
    });
    test('validates the release date', () => {
        assert.throws(
            () => releaseUnreleasedSection(changelog, '1.3.0', '27-09-2026'),
            /Not a 'YYYY-MM-DD' date/);
    });
    test('extracts the notes of a given version', () => {
        assert.strictEqual(extractReleaseNotes(changelog, '1.2.3'),
            '### Added\n- Add an older thing\n');
    });
    test('extracts the notes of the newest release by default', () => {
        const updated = releaseUnreleasedSection(
            changelog, '1.3.0', '2026-09-27');
        assert.strictEqual(extractReleaseNotes(updated),
            '### Added\n- Add a shiny thing\n\n### Fixed\n'
            + '- Fix a broken thing\n');
    });
    test('reports a missing version section', () => {
        assert.throws(() => extractReleaseNotes(changelog, '9.9.9'),
            /has no 9\.9\.9 section/);
        assert.throws(() => extractReleaseNotes('# Changelog\n'),
            /no released version section/);
    });
});

suite('Release work tree updates', () => {
    const makeWorkTree = () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stgit-release-'));
        fs.writeFileSync(path.join(root, 'package.json'), packageJson);
        fs.writeFileSync(path.join(root, 'package-lock.json'), packageLock);
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
        return root;
    };
    const read = (root: string, file: string) =>
        fs.readFileSync(path.join(root, file), 'utf8');

    test('writes the bumped version and the released changelog', () => {
        const root = makeWorkTree();
        const result = performRelease(
            { root, kind: 'minor', date: '2026-09-27' });
        assert.strictEqual(result.previousVersion, '1.2.3');
        assert.strictEqual(result.version, '1.3.0');
        assert.strictEqual(result.tag, 'v1.3.0');
        assert.strictEqual(result.notes,
            '### Added\n- Add a shiny thing\n\n### Fixed\n'
            + '- Fix a broken thing\n');
        assert.deepStrictEqual(result.changedFiles.sort(),
            ['CHANGELOG.md', 'package-lock.json', 'package.json']);
        assert.strictEqual(parsePackageVersion(read(root, 'package.json')),
            '1.3.0');
        assert.strictEqual(parsePackageVersion(read(root,
            'package-lock.json')), '1.3.0');
        assert.ok(read(root, 'CHANGELOG.md').includes(
            '## [1.3.0] - 2026-09-27'));
        assert.ok(read(root, 'CHANGELOG.md').includes('## [Unreleased]\n\n##'));
    });
    test('leaves the work tree untouched on a dry run', () => {
        const root = makeWorkTree();
        const result = performRelease(
            { root, kind: 'major', date: '2026-09-27', dryRun: true });
        assert.strictEqual(result.version, '2.0.0');
        assert.strictEqual(read(root, 'package.json'), packageJson);
        assert.strictEqual(read(root, 'CHANGELOG.md'), changelog);
    });
    test('writes nothing when the changelog is unusable', () => {
        const root = makeWorkTree();
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'),
            '# Changelog\n\n## [1.2.3] - 2026-01-02\n\n- Thing\n');
        assert.throws(() => performRelease({ root, kind: 'patch' }),
            /no '## \[Unreleased\]' section/);
        assert.strictEqual(read(root, 'package.json'), packageJson);
    });
    test('releases without a lock file', () => {
        const root = makeWorkTree();
        fs.rmSync(path.join(root, 'package-lock.json'));
        const result = performRelease({ root, kind: 'patch' });
        assert.deepStrictEqual(result.changedFiles,
            ['package.json', 'CHANGELOG.md']);
        assert.strictEqual(parsePackageVersion(read(root, 'package.json')),
            '1.2.4');
    });

    test('bumps via the command line and prints the new version', () => {
        assert.strictEqual(
            runCli(['minor', '--date=2026-09-27'], makeWorkTree()), '1.3.0');
        assert.strictEqual(runCli(['bump', 'patch'], makeWorkTree()), '1.2.4');
    });
    test('refuses a second release without new entries', () => {
        const root = makeWorkTree();
        runCli(['patch'], root);
        assert.throws(() => runCli(['patch'], root), /section is empty/);
    });
    test('prints release notes via the command line', () => {
        const root = makeWorkTree();
        assert.strictEqual(runCli(['notes', '1.2.3'], root),
            '### Added\n- Add an older thing\n');
    });
    test('rejects an unusable command line', () => {
        const root = makeWorkTree();
        assert.throws(() => runCli([], root), /Expected 'major'/);
        assert.throws(() => runCli(['prerelease'], root), /Expected 'major'/);
        assert.throws(() => runCli(['patch', '--force'], root),
            /Unknown option: --force/);
    });
});
