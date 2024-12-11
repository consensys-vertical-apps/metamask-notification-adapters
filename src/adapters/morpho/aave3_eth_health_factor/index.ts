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
    private readonly OPTIMIZER_ADDRESSES: Partial<Record<domain.Chain, viem.Address>> = {
        // https://docs.morpho.org/morpho-optimizers/contracts/morpho-optimizer-aavev3-reference/addresses
        [domain.Chain.Ethereum]: "0x33333aea097c193e66081e930c33020272b33333",
    };

    private readonly optimizerAbi = viem.parseAbi(["function liquidityData(address user) view returns ((uint256 borrowable, uint256 maxDebt, uint256 debt))"]);

    public async checkUser(address: viem.Address, chainId: domain.Chain, publicClient: viem.PublicClient): Promise<types.UserCheckResult<UserSettings>> {
        const ca = this.OPTIMIZER_ADDRESSES[chainId];
        if (!ca) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        const { debt } = await publicClient.readContract({
            address: ca,
            abi: this.optimizerAbi,
            functionName: "liquidityData",
            args: [address],
        });

        if (debt === 0n) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        return { active: true, userSettings: { healthFactorThreshold: 1.1 } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, publicClient: viem.PublicClient): Promise<types.MatchResult<State, Context>> {
        const ca = this.OPTIMIZER_ADDRESSES[trigger.chainId];
        if (!ca) {
            return { matched: false, error: new errors.NotSupportedChainError() };
        }

        const { debt, maxDebt } = await publicClient.readContract({
            address: ca,
            abi: this.optimizerAbi,
            functionName: "liquidityData",
            args: [trigger.address],
        });

        // check if the user is active
        if (debt === 0n) {
            return { matched: false, error: new errors.NotActiveUserError() };
        }

        // calculate the health factor
        const hf = Number((maxDebt * 100n) / debt) / 100;

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
