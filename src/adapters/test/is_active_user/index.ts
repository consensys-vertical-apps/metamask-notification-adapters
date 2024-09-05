import type * as viem from "viem";
import type * as types from "#/adapters/types";
import type * as domain from "#/domain";

type UserSettings = {
    value: string;
};

type State = null;

type Context = null;

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    public async checkUser(_address: viem.Address, _chainId: domain.Chain, _client: viem.PublicClient): Promise<types.UserCheckResult<UserSettings>> {
        return { active: true, userSettings: { value: "test" } };
    }

    public async matchTrigger(_trigger: domain.Trigger<UserSettings, State>, _client: viem.PublicClient): Promise<types.MatchResult<State, Context>> {
        return { matched: true, context: null };
    }

    public async mapIntoNotificationData(_trigger: domain.Trigger<UserSettings, State>, _context: Context): Promise<domain.NotificationData> {
        return { title: "test", body: "test" };
    }
}
