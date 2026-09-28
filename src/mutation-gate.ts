export class MutationGate {
    private pending = 0;
    private tail: Promise<void> = Promise.resolve();

    constructor(
        private readonly pause: () => void,
        private readonly resume: () => void,
    ) {}

    run<T>(action: () => T | Promise<T>): Promise<T> {
        this.pending++;
        if (this.pending === 1) this.pause();
        const current = this.tail.then(action);
        this.tail = current.then(
            () => undefined,
            () => undefined,
        );
        return current.finally(() => {
            this.pending--;
            if (this.pending === 0) this.resume();
        });
    }
}
