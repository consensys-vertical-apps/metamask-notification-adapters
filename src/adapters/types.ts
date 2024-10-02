import type * as viem from "viem";
import type * as domain from "#/domain";

export type ContractAdapters = {
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    [k in domain.Kind]?: IContractAdapter<any, any, any>;
};

export interface IContractAdapter<U, S, C> {
    checkUser: (address: viem.Address, chainId: domain.Chain, client: viem.PublicClient, blocknum: bigint) => Promise<UserCheckResult<U>>;
    matchTrigger: (trigger: domain.Trigger<U, S>, client: viem.PublicClient, blocknum: bigint) => Promise<MatchResult<S, C>>;
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
