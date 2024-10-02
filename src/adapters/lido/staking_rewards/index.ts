import * as viem from "viem";
import * as errors from "#/adapters/errors";
import type * as types from "#/adapters/types";
import * as domain from "#/domain";

export type UserSettings = {
    notificationIntervalDays: number;
};

export type State = {
    lastBlockNumber: bigint;
    lastNotificationTimestamp: number;
    startBalance: bigint;
    startRate: bigint;
    deposits: bigint;
    withdrawals: bigint;
};

export type Context = {
    currentStethBalance: bigint;
    currentExchangeRate: bigint;
    currentEthValue: bigint;
    estimatedTotalRewardInPeriod: bigint;
    daysSinceLastNotification: number;
};

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    private readonly STETH_DUST_THRESHOLD: bigint = viem.parseEther("0.0001"); // adjust as needed

    private readonly STETH_TOKEN_ADDRESS: viem.Address = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

    private readonly STETH_ABI = viem.parseAbi([
        "function balanceOf(address account) view returns (uint256)",
        "function getPooledEthByShares(uint256 _sharesAmount) view returns (uint256)",
    ]);

    private readonly STETH_TRANSFER_EVENT = viem.parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

    // Checks if a user is eligible for Lido staking rewards notifications
    public async checkUser(address: viem.Address, chainId: domain.Chain, client: viem.PublicClient, blockNumber: bigint): Promise<types.UserCheckResult<UserSettings>> {
        if (chainId !== domain.Chain.Ethereum) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        // Fetch the user's stETH balance
        const balance = await client.readContract({
            address: this.STETH_TOKEN_ADDRESS,
            abi: this.STETH_ABI,
            functionName: "balanceOf",
            args: [address],
            blockNumber,
        });

        // Check if the user is active (balance above dust threshold)
        if (balance <= this.STETH_DUST_THRESHOLD) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        // Default to monthly notifications
        return { active: true, userSettings: { notificationIntervalDays: 30 } };
    }

    // Matches the trigger conditions and updates the state
    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, client: viem.PublicClient, blockNumber: bigint): Promise<types.MatchResult<State, Context>> {
        const currentStethBalance = await this.getStethBalance(client, trigger.address, blockNumber);

        // Check if the user is active (balance above dust threshold)
        if (currentStethBalance <= this.STETH_DUST_THRESHOLD) {
            return { matched: false, error: new errors.NotActiveUserError() };
        }

        const currentTimestamp = Math.floor(Date.now() / 1000);
        const currentExchangeRate = await this.getStethExchangeRate(client, blockNumber);
        const currentEthValue = (currentStethBalance * currentExchangeRate) / BigInt(1e18);

        // Initialize state if it's the first run
        if (!trigger.state) {
            return {
                matched: false,
                state: {
                    lastBlockNumber: blockNumber,
                    lastNotificationTimestamp: currentTimestamp,
                    startBalance: currentStethBalance,
                    startRate: currentExchangeRate,
                    deposits: BigInt(0),
                    withdrawals: BigInt(0),
                },
            };
        }

        // Track deposits and withdrawals
        const [deposits, withdrawals] = await Promise.all([
            this.trackDeposits(client, trigger.address, trigger.state.lastBlockNumber + 1n, blockNumber),
            this.trackWithdrawals(client, trigger.address, trigger.state.lastBlockNumber + 1n, blockNumber),
        ]);

        const totalDeposits = trigger.state.deposits + deposits;
        const totalWithdrawals = trigger.state.withdrawals + withdrawals;

        const daysSinceLastNotification = Math.floor((currentTimestamp - trigger.state.lastNotificationTimestamp) / (24 * 60 * 60));

        // Check if the notification interval has passed
        if (daysSinceLastNotification >= trigger.userSettings.notificationIntervalDays) {
            const estimatedTotalRewardInPeriod = this.calculateRewards(
                trigger.state.startBalance,
                trigger.state.startRate,
                currentStethBalance,
                currentExchangeRate,
                totalDeposits,
                totalWithdrawals,
            );

            return {
                matched: true,
                state: {
                    lastBlockNumber: blockNumber,
                    lastNotificationTimestamp: currentTimestamp,
                    startBalance: currentStethBalance,
                    startRate: currentExchangeRate,
                    deposits: BigInt(0),
                    withdrawals: BigInt(0),
                },
                context: {
                    currentStethBalance: currentStethBalance,
                    currentExchangeRate: currentExchangeRate,
                    currentEthValue: currentEthValue,
                    estimatedTotalRewardInPeriod: estimatedTotalRewardInPeriod,
                    daysSinceLastNotification: daysSinceLastNotification,
                },
            };
        }

        // Update state without triggering a notification
        return {
            matched: false,
            state: {
                ...trigger.state,
                lastBlockNumber: blockNumber,
                deposits: totalDeposits,
                withdrawals: totalWithdrawals,
            },
        };
    }

    // Maps the trigger and context into notification data
    public async mapIntoNotificationData(trigger: domain.Trigger<UserSettings, State>, context: Context): Promise<domain.NotificationData> {
        return {
            chainId: trigger.chainId,
            currentStethBalance: viem.formatEther(context.currentStethBalance),
            currentEthValue: viem.formatEther(context.currentEthValue),
            estimatedTotalRewardInPeriod: viem.formatEther(context.estimatedTotalRewardInPeriod),
            daysSinceLastNotification: context.daysSinceLastNotification,
            notificationIntervalDays: trigger.userSettings.notificationIntervalDays,
        };
    }

    // Retrieves the stETH balance for a given address
    private async getStethBalance(client: viem.PublicClient, address: viem.Address, blockNumber: bigint): Promise<bigint> {
        return client.readContract({
            address: this.STETH_TOKEN_ADDRESS,
            abi: this.STETH_ABI,
            functionName: "balanceOf",
            args: [address],
            blockNumber: blockNumber,
        });
    }

    // Retrieves the current ETH/stETH exchange rate
    private async getStethExchangeRate(client: viem.PublicClient, blockNumber: bigint): Promise<bigint> {
        const oneShare = BigInt(1e18);
        return client.readContract({
            address: this.STETH_TOKEN_ADDRESS,
            abi: this.STETH_ABI,
            functionName: "getPooledEthByShares",
            args: [oneShare],
            blockNumber: blockNumber,
        });
    }

    // Tracks deposits (incoming transfers) and calculates their ETH value
    private async trackDeposits(client: viem.PublicClient, address: viem.Address, fromBlock: bigint, toBlock: bigint): Promise<bigint> {
        const logs = await client.getLogs({
            address: this.STETH_TOKEN_ADDRESS,
            event: this.STETH_TRANSFER_EVENT,
            args: { to: address },
            fromBlock: fromBlock,
            toBlock: toBlock,
        });

        let deposits = BigInt(0);
        for (const log of logs) {
            const rate = await this.getStethExchangeRate(client, log.blockNumber);
            deposits += ((log.args.value as bigint) * rate) / BigInt(1e18);
        }

        return deposits;
    }

    // Tracks withdrawals (outgoing transfers) and calculates their ETH value
    private async trackWithdrawals(client: viem.PublicClient, address: viem.Address, fromBlock: bigint, toBlock: bigint): Promise<bigint> {
        const logs = await client.getLogs({
            address: this.STETH_TOKEN_ADDRESS,
            event: this.STETH_TRANSFER_EVENT,
            args: { from: address },
            fromBlock: fromBlock,
            toBlock: toBlock,
        });

        let withdrawals = BigInt(0);
        for (const log of logs) {
            const rate = await this.getStethExchangeRate(client, log.blockNumber);
            withdrawals += ((log.args.value as bigint) * rate) / BigInt(1e18);
        }

        return withdrawals;
    }

    // Calculates the rewards based for Lido staking rewards\
    //
    // The formula:
    // Rewards = (End Value - Start Value) - (Deposits - Withdrawals)
    //
    // This formula works because:
    // 1. (End Value - Start Value) represents the total change in ETH value
    // 2. Subtracting (Deposits - Withdrawals) removes the effect of user actions
    //    - Deposits increase the balance but aren't rewards, so we subtract them
    //    - Withdrawals decrease the balance but don't affect rewards, so we add them back
    // 3. What remains is the change in value due to staking rewards and rate changes
    //
    // Note: This implicitly handles the rebasing mechanism of stETH:
    // - Rebases increase the stETH balance, which is reflected in the higher endBalance
    // - The reward from rebases is thus captured in (End Value - Start Value)
    private calculateRewards(startBalance: bigint, startRate: bigint, endBalance: bigint, endRate: bigint, deposits: bigint, withdrawals: bigint): bigint {
        const startValue = (startBalance * startRate) / BigInt(1e18);
        const endValue = (endBalance * endRate) / BigInt(1e18);

        return endValue - startValue - deposits + withdrawals;
    }
}
