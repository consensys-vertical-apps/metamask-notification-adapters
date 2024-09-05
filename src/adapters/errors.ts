export class NotActiveUserError extends Error {
    constructor() {
        super("not active user");
        this.name = "NotActiveUserError";
        Object.setPrototypeOf(this, NotActiveUserError.prototype);
    }

    toJSON(): string {
        return this.message;
    }
}

export class NotSupportedChainError extends Error {
    constructor() {
        super("not supported chain");
        this.name = "NotSupportedChainError";
        Object.setPrototypeOf(this, NotSupportedChainError.prototype);
    }

    toJSON(): string {
        return this.message;
    }
}
