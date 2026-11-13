/**
 * Formats the upstream part of the branch line, e.g. ` <-> origin/main`.
 * An upstream with the same name as the local branch is abbreviated to
 * `<remote>/*`.
 */
export function formatUpstream(branchName: string | null, remoteName: string | null, remoteBranch: string | null): string {
    if (remoteBranch && remoteName) {
        return ` <-> ${remoteName}/${remoteBranch === branchName ? "*" : remoteBranch}`;
    }
    if (remoteName) {
        return ` (${remoteName})`;
    }
    return "";
}
