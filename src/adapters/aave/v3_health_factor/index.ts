import * as viem from "viem";
import * as adapters from "#/adapters";
import * as domain from "#/domain";

export type UserSettings = {
    healthFactorThreshold: number;
};

export type State = null;

export type Context = {
    healthFactor: number;
};

export class Adapter implements adapters.IContractAdapter<UserSettings, State, Context> {
    private readonly POOL_ADDRESSES: Partial<Record<domain.Chain, viem.Address>> = {
        [domain.Chain.Ethereum]: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
        [domain.Chain.Optimism]: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        [domain.Chain.Arbitrum]: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        [domain.Chain.Polygon]: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        [domain.Chain.Avalanche]: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        [domain.Chain.BNB]: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
    };

    private readonly POOL_ABI = viem.parseAbi([
        "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
    ]);

    public async checkUser(address: viem.Address, chainId: domain.Chain, client: viem.PublicClient): Promise<adapters.UserCheckResult<UserSettings>> {
        // check if the chain is supported
        const ca = this.POOL_ADDRESSES[chainId];
        if (!ca) {
            return { active: false, error: new adapters.NotSupportedChainError() };
        }

        const [totalCollateralBase] = await client.readContract({
            address: ca,
            abi: this.POOL_ABI,
            functionName: "getUserAccountData",
            args: [address],
        });

        // check if the user is active by checking if they have any collateral
        if (totalCollateralBase === 0n) {
            return { active: false, error: new adapters.NotActiveUserError() };
        }

        return { active: true, userSettings: { healthFactorThreshold: 1.1 } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, client: viem.PublicClient): Promise<adapters.MatchResult<State, Context>> {
        // check if the chain is supported
        const address = this.POOL_ADDRESSES[trigger.chainId];
        if (!address) {
            return { matched: false, error: new adapters.NotSupportedChainError() };
        }

        // get the user account data that includes the health factor
        const [totalCollateralBase, _, __, ___, ____, healthFactor] = await client.readContract({
            address,
            abi: this.POOL_ABI,
            functionName: "getUserAccountData",
            args: [trigger.address],
        });

        // check if the user is active
        if (totalCollateralBase === 0n) {
            return { matched: false, error: new adapters.NotActiveUserError() };
        }

        // calculate the health factor
        const hf = Number((healthFactor * 100n) / BigInt(10 ** 18)) / 100;

        // check if the health factor is below the threshold
        if (hf < trigger.userSettings.healthFactorThreshold) {
            return { matched: true, dedupKey: this.makeDedupKey(), context: { healthFactor: hf } };
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

    // NOTE: we want to return with the same key for the same condition
    private makeDedupKey(): string {
        return adapters.hash("true");
    }
}
