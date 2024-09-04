import type * as viem from "viem";
import * as aave_v3_health_factor from "#/adapters/aave/aave_v3_health_factor";
import * as ens_expiration from "#/adapters/ens/expiration";
import * as test_is_active_user from "#/adapters/test/is_active_user";
import * as test_is_matching from "#/adapters/test/is_matching";
import * as test_is_not_active_user from "#/adapters/test/is_not_active_user";
import * as test_is_not_matching from "#/adapters/test/is_not_matching";
import * as test_is_not_supported_chain from "#/adapters/test/is_not_supported_chain";
import * as domain from "#/domain";

export const CONTRACT_ADAPTERS: ContractAdapters = {
    // Actual adapters
    [domain.Kind.AaveV3HealthFactor]: new aave_v3_health_factor.Adapter(),
    [domain.Kind.EnsExpiration]: new ens_expiration.Adapter(),

    // Test adapters
    [domain.Kind.TestIsMatching]: new test_is_matching.Adapter(),
    [domain.Kind.TestIsNotMatching]: new test_is_not_matching.Adapter(),
    [domain.Kind.TestIsActiveUser]: new test_is_active_user.Adapter(),
    [domain.Kind.TestIsNotActiveUser]: new test_is_not_active_user.Adapter(),
    [domain.Kind.TestIsNotSupportedChain]: new test_is_not_supported_chain.Adapter(),
};

type ContractAdapters = {
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    [k in domain.Kind]?: IContractAdapter<any, any, any>;
};

export interface IContractAdapter<U, S, C> {
    checkUser: (address: viem.Address, chainId: domain.Chain, client: viem.PublicClient) => Promise<UserCheckResult<U>>;
    matchTrigger: (trigger: domain.Trigger<U, S>, client: viem.PublicClient) => Promise<MatchResult<S, C>>;
    mapIntoNotificationData: (trigger: domain.Trigger<U, S>, context: C) => Promise<domain.NotificationData>;
}

export type UserCheckResult<U> = ActiveUserResult<U> | NotActiveUserResult;

interface ActiveUserResult<U> {
    active: true;
    userSettings?: U;
    error?: never;
}

interface NotActiveUserResult {
    active: false;
    userSettings?: never;
    error?: Error;
}

export type MatchResult<S, C> = MatchedResult<S, C> | UnmatchedResult<S>;

interface MatchedResult<S, C> {
    matched: true;
    dedupKey?: string;
    state?: S;
    context: C;
    error?: never;
}

interface UnmatchedResult<S> {
    matched: false;
    state?: S;
    context?: never;
    error?: Error;
}

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

export function hash(data: Bun.BlobOrStringOrBuffer): string {
    const hasher = new Bun.CryptoHasher("md5");
    return hasher.update(data).digest("hex");
}
