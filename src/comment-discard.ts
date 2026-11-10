export class CommentDraft {
    private document?: { getText(): string };

    constructor(private readonly initialBody: string) {}

    trackDocument(document: { uri: { scheme: string; path: string }; getText(): string }) {
        if (!this.document && document.uri.scheme === "comment" && document.uri.path.startsWith("/commentinput-")) {
            this.document = document;
        }
    }

    get hasChanges(): boolean {
        const body = this.document?.getText() ?? this.initialBody;
        return body.replace(/\r\n/g, "\n") !== this.initialBody.replace(/\r\n/g, "\n");
    }
}

export async function confirmCommentDiscard(hasUnsavedChanges: boolean, askToDiscard: () => Promise<boolean>): Promise<boolean> {
    if (!hasUnsavedChanges) {
        return true;
    }
    return await askToDiscard();
}
