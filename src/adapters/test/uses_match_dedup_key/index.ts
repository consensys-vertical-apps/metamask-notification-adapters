import type * as viem from "viem";
import type * as types from "#/adapters/types";
import * as utils from "#/adapters/utils";
import type * as domain from "#/domain";

type State = null;

type UserSettings = null;

type Context = {
    value: string;
};

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    public async checkUser(_address: viem.Address, _chainId: domain.Chain, _client: viem.PublicClient, _blockNumber: bigint): Promise<types.UserCheckResult<UserSettings>> {
        return { active: true };
    }

    public async matchTrigger(_trigger: domain.Trigger<UserSettings, State>, _client: viem.PublicClient, _blockNumber: bigint): Promise<types.MatchResult<State, Context>> {
        return { matched: true, dedupKey: utils.hash("some key"), context: { value: "some value" } };
    }

    public async mapIntoNotificationData(trigger: domain.Trigger, context: Context): Promise<domain.NotificationData> {
        return { chainId: trigger.chainId, value: context.value.toUpperCase() };
    }
}
