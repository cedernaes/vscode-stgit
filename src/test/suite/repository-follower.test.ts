import * as assert from 'assert';
import { RepositoryFollower } from '../../repository-follower';

const firstRepo = { gitDir: '/first/.git' };
const secondRepo = { gitDir: '/second/.git' };

suite('Repository follower', () => {
    test('follows the file repository and skips the current one', async () => {
        let current = firstRepo;
        const switched: string[] = [];
        const follower = new RepositoryFollower({
            lookup: async directory => {
                assert.strictEqual(directory, '/second');
                return secondRepo;
            },
            current: () => current,
            loadContext: async () => 'submodule context',
            switchTo: (repo, context) => {
                assert.strictEqual(context, 'submodule context');
                switched.push(repo.gitDir);
                current = repo;
            },
        });
        await follower.followFile('/second/file');
        await follower.followFile('/second/another-file');
        assert.deepStrictEqual(switched, [secondRepo.gitDir]);
    });

    test('ignores an older file lookup after a newer selection', async () => {
        let finish: ((repo: typeof firstRepo) => void) | undefined;
        const switched: string[] = [];
        const follower = new RepositoryFollower({
            lookup: directory => directory === '/first' ?
                new Promise(resolve => { finish = resolve; }) :
                Promise.resolve(secondRepo),
            current: () => firstRepo,
            loadContext: async () => 'context',
            switchTo: repo => { switched.push(repo.gitDir); },
        });
        const older = follower.followFile('/first/file');
        await follower.followFile('/second/file');
        finish!(firstRepo);
        await older;
        assert.deepStrictEqual(switched, [secondRepo.gitDir]);
    });

    test('cancels an in-flight context lookup on close', async () => {
        let finish: ((context: string) => void) | undefined;
        const switched: string[] = [];
        const follower = new RepositoryFollower({
            lookup: async () => secondRepo,
            current: () => firstRepo,
            loadContext: () => new Promise(resolve => { finish = resolve; }),
            switchTo: repo => { switched.push(repo.gitDir); },
        });
        const pending = follower.followFile('/second/file');
        await Promise.resolve();
        follower.cancel();
        finish!('context');
        await pending;
        assert.deepStrictEqual(switched, []);
    });
});