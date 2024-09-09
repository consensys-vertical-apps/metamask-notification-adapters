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
    startingEthValue: bigint;
    ethValueChanges: bigint[];
};

export type Context = {
    currentRethBalance: bigint;
    currentExchangeRate: bigint;
    currentEthValue: bigint;
    estimatedTotalRewardInPeriod: bigint;
    daysSinceLastNotification: number;
};

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    private readonly DEFAULT_NOTIFICATION_INTERVAL_DAYS = 30;

    private readonly DUST_THRESHOLD: bigint = viem.parseEther("0.0001"); // rETH, adjust as needed

    private readonly RETH_TOKEN_ADDRESS: viem.Address = "0xae78736Cd615f374D3085123A210448E74Fc6393";
    private readonly ROCKET_STORAGE_ADDRESS: viem.Address = "0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46";

    private readonly RETH_ABI = viem.parseAbi(["function balanceOf(address account) view returns (uint256)"]);
    private readonly ROCKET_STORAGE_ABI = viem.parseAbi(["function getAddress(bytes32 key) view returns (address)"]);
    private readonly ROCKET_NETWORK_BALANCES_ABI = viem.parseAbi(["function getTotalRETHSupply() view returns (uint256)", "function getTotalETHBalance() view returns (uint256)"]);
    private readonly ERC20_TRANSFER_EVENT = viem.parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

    public async checkUser(address: viem.Address, chainId: domain.Chain, client: viem.PublicClient): Promise<types.UserCheckResult<UserSettings>> {
        if (chainId !== domain.Chain.Ethereum) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        const balance = await client.readContract({
            address: this.RETH_TOKEN_ADDRESS,
            abi: this.RETH_ABI,
            functionName: "balanceOf",
            args: [address],
        });

        // Check if the user is active (balance above dust threshold)
        if (balance <= this.DUST_THRESHOLD) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        return { active: true, userSettings: { notificationIntervalDays: this.DEFAULT_NOTIFICATION_INTERVAL_DAYS } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, client: viem.PublicClient): Promise<types.MatchResult<State, Context>> {
        const currentRethBalance = await this.getRethBalance(client, trigger.address);

        // Check if the user is active (balance above dust threshold)
        if (currentRethBalance <= this.DUST_THRESHOLD) {
            return { matched: false, error: new errors.NotActiveUserError() };
        }

        const currentBlockNumber = await client.getBlockNumber();
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const currentExchangeRate = await this.getRethExchangeRate(client, currentBlockNumber);
        const currentEthValue = (currentRethBalance * currentExchangeRate) / BigInt(1e18);

        // Initialize state if it's the first run
        if (!trigger.state) {
            return {
                matched: false,
                state: {
                    lastBlockNumber: currentBlockNumber,
                    lastNotificationTimestamp: currentTimestamp,
                    startingEthValue: currentEthValue,
                    ethValueChanges: [],
                },
            };
        }

        // Fetch ETH value changes since last run
        const newEthValueChanges = await this.getEthValueChanges(client, trigger.address, trigger.state.lastBlockNumber + 1n, currentBlockNumber);

        // Combine existing and new ETH value changes
        const allEthValueChanges = [...trigger.state.ethValueChanges, ...newEthValueChanges];

        const daysSinceLastNotification = Math.floor((currentTimestamp - trigger.state.lastNotificationTimestamp) / (24 * 60 * 60));

        // Check if the notification interval has passed
        if (daysSinceLastNotification >= trigger.userSettings.notificationIntervalDays) {
            const estimatedTotalRewardInPeriod = this.calculateRewards(trigger.state.startingEthValue, currentEthValue, allEthValueChanges);

            return {
                matched: true,
                state: {
                    lastBlockNumber: currentBlockNumber,
                    lastNotificationTimestamp: currentTimestamp,
                    startingEthValue: currentEthValue,
                    ethValueChanges: [],
                },
                context: {
                    currentRethBalance: currentRethBalance,
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
                lastBlockNumber: currentBlockNumber,
                lastNotificationTimestamp: trigger.state.lastNotificationTimestamp,
                startingEthValue: trigger.state.startingEthValue,
                ethValueChanges: allEthValueChanges,
            },
        };
    }

    public async mapIntoNotificationData(trigger: domain.Trigger<UserSettings, State>, context: Context): Promise<domain.NotificationData> {
        return {
            chainId: trigger.chainId,
            currentRethBalance: viem.formatEther(context.currentRethBalance),
            currentEthValue: viem.formatEther(context.currentEthValue),
            estimatedTotalRewardInPeriod: viem.formatEther(context.estimatedTotalRewardInPeriod),
            daysSinceLastNotification: context.daysSinceLastNotification,
            notificationIntervalDays: trigger.userSettings.notificationIntervalDays,
        };
    }

    private async getRethBalance(client: viem.PublicClient, address: viem.Address, blockNumber?: bigint): Promise<bigint> {
        return client.readContract({
            address: this.RETH_TOKEN_ADDRESS,
            abi: this.RETH_ABI,
            functionName: "balanceOf",
            args: [address],
            blockNumber: blockNumber,
        });
    }

    private async getRethExchangeRate(client: viem.PublicClient, blockNumber: bigint): Promise<bigint> {
        // https://docs.rocketpool.net/developers/usage/contracts/contracts.html
        const key = viem.keccak256(viem.concat([viem.stringToHex("contract.address"), viem.stringToHex("rocketNetworkBalances")]));

        const rocketNetworkBalancesAddress = await client.readContract({
            address: this.ROCKET_STORAGE_ADDRESS,
            abi: this.ROCKET_STORAGE_ABI,
            functionName: "getAddress",
            args: [key],
            blockNumber: blockNumber,
        });

        const [totalRethSupply, totalEthBalance] = await Promise.all([
            client.readContract({
                address: rocketNetworkBalancesAddress,
                abi: this.ROCKET_NETWORK_BALANCES_ABI,
                functionName: "getTotalRETHSupply",
                blockNumber: blockNumber,
            }),
            client.readContract({
                address: rocketNetworkBalancesAddress,
                abi: this.ROCKET_NETWORK_BALANCES_ABI,
                functionName: "getTotalETHBalance",
                blockNumber: blockNumber,
            }),
        ]);

        return (totalEthBalance * BigInt(1e18)) / totalRethSupply;
    }

    /**
     * Retrieves ETH values for a given address at each block where a transfer occurred.
     *
     * For each unique block with a transfer:
     * 1. Fetch the rETH balance
     * 2. Get the current exchange rate
     * 3. Calculate ETH value: ETH_value = rETH_balance * exchange_rate
     *
     * Returns an array of ETH values, representing the user's ETH value at each relevant block.
     */
    private async getEthValueChanges(client: viem.PublicClient, address: viem.Address, fromBlock: bigint, toBlock: bigint): Promise<bigint[]> {
        const [logs1, logs2] = await Promise.all([
            client.getLogs({
                address: this.RETH_TOKEN_ADDRESS,
                event: this.ERC20_TRANSFER_EVENT,
                args: { from: address },
                fromBlock: fromBlock,
                toBlock: toBlock,
            }),
            client.getLogs({
                address: this.RETH_TOKEN_ADDRESS,
                event: this.ERC20_TRANSFER_EVENT,
                args: { to: address },
                fromBlock: fromBlock,
                toBlock: toBlock,
            }),
        ]);

        const ethValues: bigint[] = [];
        const uniqueBlockNumbers = new Set([...logs1, ...logs2].map((log) => log.blockNumber));

        for (const blockNumber of uniqueBlockNumbers) {
            const [balance, exchangeRate] = await Promise.all([
                this.getRethBalance(client, address, blockNumber), //
                this.getRethExchangeRate(client, blockNumber),
            ]);
            const ethValue = (balance * exchangeRate) / BigInt(1e18);

            ethValues.push(ethValue);
        }

        return ethValues;
    }

    /**
     * Calculates the total ETH rewards for a Rocket Pool staker over a given period.
     *
     * The calculation is based on the formula:
     * Reward = (Ending ETH Value - Starting ETH Value) - Net Deposits/Withdrawals
     *
     * Where Net Deposits/Withdrawals is the cumulative sum of all ETH value changes:
     * Net Deposits/Withdrawals = Σ (ETH_value_i - ETH_value_i-1)
     *
     * This approach ensures that:
     * - Rewards are based on actual ETH value change
     * - Both deposits and withdrawals are correctly accounted for
     * - Exchange rate fluctuations are accurately reflected
     */
    private calculateRewards(startingEthValue: bigint, endingEthValue: bigint, ethValueChanges: bigint[]): bigint {
        let cumulativeChange = BigInt(0);
        let previousValue = startingEthValue;

        for (const value of ethValueChanges) {
            const change = value - previousValue;
            cumulativeChange += change;
            previousValue = value;
        }

        return endingEthValue - startingEthValue - cumulativeChange;
    }
}
