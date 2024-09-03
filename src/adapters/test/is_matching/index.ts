import type * as adapters from "#/adapters";
import type * as domain from "#/domain";
import type * as viem from "viem";

type UserSettings = null;

type State = null;

type Context = null;

export class Adapter implements adapters.IContractAdapter<UserSettings, State, Context> {
    public async checkUser(_address: viem.Address, _chainId: domain.Chain, _client: viem.PublicClient): Promise<adapters.UserCheckResult<UserSettings>> {
        return { active: true, userSettings: null };
    }

    public async matchTrigger(_trigger: domain.Trigger<UserSettings, State>, _client: viem.PublicClient): Promise<adapters.MatchResult<State, Context>> {
        return { matched: true, context: null };
    }

    public async mapIntoNotificationData(_trigger: domain.Trigger<UserSettings, State>, _context: Context): Promise<domain.NotificationData> {
        return { title: "test", body: "test" };
    }
}
