export async function confirmCommentDiscard(hasOpenComment: boolean, askToDiscard: () => Promise<boolean>): Promise<boolean> {
    if (!hasOpenComment) {
        return true;
    }
    return await askToDiscard();
}
