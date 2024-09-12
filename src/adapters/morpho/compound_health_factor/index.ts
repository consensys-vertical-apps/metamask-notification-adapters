import * as errors from "#/adapters/errors";
import type * as types from "#/adapters/types";
import * as domain from "#/domain";
import * as viem from "viem";
import * as utils from "#/adapters/utils";

export type UserSettings = {
    healthFactorThreshold: number;
};

export type State = null;

export type Context = {
    healthFactor: number;
};

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    private readonly LENS_ADDRESSES: Partial<Record<domain.Chain, viem.Address>> = {
        // https://docs.morpho.org/morpho-optimizers/contracts/morpho-optimizers-aave-compound-v2/addresses
        [domain.Chain.Ethereum]: "0x930f1b46e1d081ec1524efd95752be3ece51ef67",
    };

    private readonly lensAbi = viem.parseAbi([
        "function getEnteredMarkets(address _user) view returns(address[] enteredMarkets)",
        "function getUserHealthFactor(address _user) view returns (uint256)",
    ]);

    public async checkUser(address: viem.Address, chainId: domain.Chain, publicClient: viem.PublicClient): Promise<types.UserCheckResult<UserSettings>> {
        const ca = this.LENS_ADDRESSES[chainId];
        if (!ca) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        const markets = await publicClient.readContract({
            address: ca,
            abi: this.lensAbi,
            functionName: "getEnteredMarkets",
            args: [address],
        });

        if (markets.length === 0) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        return { active: true, userSettings: { healthFactorThreshold: 1.1 } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, publicClient: viem.PublicClient): Promise<types.MatchResult<State, Context>> {
        const ca = this.LENS_ADDRESSES[trigger.chainId];
        if (!ca) {
            return { matched: false, error: new errors.NotSupportedChainError() };
        }

        // check if the user is active
        const markets = await publicClient.readContract({
            address: ca,
            abi: this.lensAbi,
            functionName: "getEnteredMarkets",
            args: [trigger.address],
        });
        if (markets.length === 0) {
            return { matched: false, error: new errors.NotActiveUserError() };
        }

        // Get health factor
        const healthFactor = await publicClient.readContract({
            address: ca,
            abi: this.lensAbi,
            functionName: "getUserHealthFactor",
            args: [trigger.address],
        });

        // calculate the health factor
        const hf = Number((healthFactor * 100n) / BigInt(10 ** 18)) / 100;

        // check if the health factor is below the threshold
        if (hf < trigger.userSettings.healthFactorThreshold) {
            const dedupKey = utils.hash("true");

            return { matched: true, dedupKey, context: { healthFactor: hf } };
        }

        return { matched: false };
    }

    public async mapIntoNotificationData(trigger: domain.Trigger<UserSettings, State>, context: Context): Promise<domain.NotificationData> {
        return {
            chainId: trigger.chainId,
            healthFactor: context.healthFactor,
            threshold: trigger.userSettings.healthFactorThreshold,
        };
    }
}
