import * as viem from "viem";
import * as errors from "#/adapters/errors";
import type * as types from "#/adapters/types";
import * as utils from "#/adapters/utils";
import * as domain from "#/domain";

export type UserSettings = {
    reminderDelayInSeconds: number;
};

export type State = null;

export type Context = {
    loans: Loan[];
};

type Loan = {
    amount: number;
    symbol: string;
    maturityDateInSecs: number;
    storageSlot: bigint;
};

type Assets = Record<string, { symbol: string; dustThreshold: bigint }>;

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    private readonly DEFAULT_REMINDER_DELAY_IN_SECONDS = 7 * 24 * 60 * 60; // 1 week

    private readonly ROUTER_ADDRESSES: Partial<Record<domain.Chain, viem.Address>> = {
        [domain.Chain.Ethereum]: "0x6e7058c91f85e0f6db4fc9da2ca41241f5e4263f",
        [domain.Chain.Arbitrum]: "0x1344A36A1B56144C3Bc62E7757377D288fDE0369",
    };

    private readonly ROUTER_ABI = viem.parseAbi([
        "function getAccountPortfolio(address account) view returns ((uint256 currencyId, uint256 maturity, uint256 assetType, int256 notional, uint256 storageSlot, uint8 storageState)[])",
    ]);

    // https://docs.notional.finance/v3-technical-docs/currency-ids-and-precision/currency-ids
    private readonly ASSETS: Assets = {
        "1": { symbol: "ETH", dustThreshold: viem.parseUnits("0.00001", 8) },
        "2": { symbol: "DAI", dustThreshold: viem.parseUnits("0.01", 8) },
        "3": { symbol: "USDC", dustThreshold: viem.parseUnits("0.01", 8) },
        "4": { symbol: "WBTC", dustThreshold: viem.parseUnits("0.00001", 8) },
        "5": { symbol: "wstETH", dustThreshold: viem.parseUnits("0.00001", 8) },
        "6": { symbol: "FRAX", dustThreshold: viem.parseUnits("0.01", 8) },
        "7": { symbol: "rETH", dustThreshold: viem.parseUnits("0.00001", 8) },
        "8": { symbol: "USDT", dustThreshold: viem.parseUnits("0.01", 8) },
    };

    // Check if the user has at least one active loan
    public async checkUser(address: viem.Address, chainId: domain.Chain, client: viem.PublicClient): Promise<types.UserCheckResult<UserSettings>> {
        const routerAddresss = this.ROUTER_ADDRESSES[chainId];
        if (!routerAddresss) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        // Get all user's positions
        const userPortfolio = await client.readContract({
            address: routerAddresss,
            abi: this.ROUTER_ABI,
            functionName: "getAccountPortfolio",
            args: [address],
        });

        // Get the user's active loans with enough amount
        let hasAtLeastOneLoan = false;
        for (const position of userPortfolio) {
            const isFixRateBorrowPosition = position.assetType === 1n && position.notional < 0n;
            if (isFixRateBorrowPosition) {
                const currencyId = position.currencyId.toString();
                const asset = this.ASSETS[currencyId];
                const absNotional = position.notional * -1n;

                const isDustPosition = absNotional <= asset.dustThreshold;
                if (isDustPosition) {
                    continue;
                }

                hasAtLeastOneLoan = true;
                break;
            }
        }

        // if the user doesn't have at least one active loan
        if (!hasAtLeastOneLoan) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        return { active: true, userSettings: { reminderDelayInSeconds: this.DEFAULT_REMINDER_DELAY_IN_SECONDS } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings>, client: viem.PublicClient): Promise<types.MatchResult<State, Context>> {
        const routerAddresss = this.ROUTER_ADDRESSES[trigger.chainId];
        if (!routerAddresss) {
            return { matched: false, error: new errors.NotSupportedChainError() };
        }

        // Get all user's positions
        const userPortfolio = await client.readContract({
            address: routerAddresss,
            abi: this.ROUTER_ABI,
            functionName: "getAccountPortfolio",
            args: [trigger.address],
        });

        // Get the user's active loans with enough amount
        const loans: Loan[] = [];
        for (const position of userPortfolio) {
            const isFixRateBorrowPosition = position.assetType === 1n && position.notional < 0n;
            if (isFixRateBorrowPosition) {
                const currencyId = position.currencyId.toString();
                const asset = this.ASSETS[currencyId];
                const absNotional = position.notional * -1n;

                const isDustPosition = absNotional <= asset.dustThreshold;
                if (isDustPosition) {
                    continue;
                }

                loans.push({
                    amount: Number(viem.formatUnits(absNotional, 8)),
                    symbol: asset.symbol,
                    maturityDateInSecs: Number(position.maturity),
                    storageSlot: position.storageSlot,
                });
            }
        }

        // if the user doesn't have at least one active loan
        if (loans.length === 0) {
            return { matched: false, error: new errors.NotActiveUserError() };
        }

        // get the loans that will expire before the reminder
        const expiringLoans = loans.filter((loan) => {
            const timeBeforeExpirationInSeconds = loan.maturityDateInSecs - Date.now() / 1000;
            return timeBeforeExpirationInSeconds < trigger.userSettings.reminderDelayInSeconds;
        });

        // if the user doesn't have at least one loan that will expire before the reminder delay
        if (expiringLoans.length === 0) {
            return { matched: false };
        }

        return { matched: true, dedupKey: this.makeDedupKey(expiringLoans), context: { loans: expiringLoans } };
    }

    public async mapIntoNotificationData(trigger: domain.Trigger<UserSettings>, context: Context): Promise<domain.NotificationData> {
        return {
            chainId: trigger.chainId,
            loans: context.loans.map((loan) => ({
                amount: loan.amount,
                symbol: loan.symbol,
                maturityDateIso: new Date(loan.maturityDateInSecs * 1000),
            })),
            reminderDelayInSeconds: trigger.userSettings.reminderDelayInSeconds,
        };
    }

    private makeDedupKey(loans: Loan[]): string {
        const sorted = loans.sort((a, b) => b.maturityDateInSecs - a.maturityDateInSecs);
        const joined = sorted.map((loan) => loan.storageSlot.toString()).join("-");
        return utils.hash(joined);
    }
}
