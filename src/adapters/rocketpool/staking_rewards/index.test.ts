import * as t from "bun:test";
import * as uuid from "uuid";
import * as adapters from "#/adapters";
import * as rocketpool_staking_rewards from "#/adapters/rocketpool/staking_rewards";
import * as domain from "#/domain";
import * as testutils from "#/testutils";

t.describe("rocketpool_staking_rewards adapter", () => {
    const adapter = new rocketpool_staking_rewards.Adapter();
    const client = testutils.createRPCClient();

    const trigger: domain.Trigger<rocketpool_staking_rewards.UserSettings, rocketpool_staking_rewards.State> = {
        id: uuid.v4(),
        chainId: domain.Chain.Ethereum,
        kind: domain.Kind.RocketpoolStakingRewards,
        address: "0x1234567890123456789012345678901234567890",
        userSettings: { notificationIntervalDays: 30 },
        state: null as unknown as rocketpool_staking_rewards.State,
        matchDedupKey: null,
        scheduledAt: new Date(),
    };

    const mocks = {
        readContract: t.spyOn(client, "readContract"),
        getBlockNumber: t.spyOn(client, "getBlockNumber"),
        getLogs: t.spyOn(client, "getLogs"),
    };

    t.beforeEach(() => {
        mocks.readContract.mockClear();
        mocks.getBlockNumber.mockClear();
        mocks.getLogs.mockClear();
    });

    t.describe("check user", () => {
        t.test("should handle not supported chain", async () => {
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.None, client);
            t.expect(result).toEqual({ active: false, error: new adapters.NotSupportedChainError() });
        });

        t.test("should call the right function with the right args", async () => {
            mocks.readContract.mockResolvedValueOnce(0n);

            await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);

            t.expect(mocks.readContract).toHaveBeenCalledWith({
                address: adapter["RETH_TOKEN_ADDRESS"],
                abi: adapter["RETH_ABI"],
                functionName: "balanceOf",
                args: ["0x12Dec026d5826F95bA23957529B36a386E085583"],
            });
        });

        t.test("should handle not active user", async () => {
            mocks.readContract.mockResolvedValueOnce(0n);
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);
            t.expect(result).toEqual({ active: false, error: new adapters.NotActiveUserError() });
        });

        t.test("should handle when user doesn't have enough balance", async () => {
            mocks.readContract.mockResolvedValueOnce(adapter["DUST_THRESHOLD"] - 1n);
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);
            t.expect(result).toEqual({ active: false, error: new adapters.NotActiveUserError() });
        });

        t.test("should handle active user", async () => {
            mocks.readContract.mockResolvedValueOnce(adapter["DUST_THRESHOLD"] + 1n);
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);
            t.expect(result).toEqual({ active: true, userSettings: { notificationIntervalDays: 30 } });
        });
    });

    t.describe("matching", () => {
        t.test("should return NotActiveUserError for balance below dust threshold", async () => {
            mocks.readContract.mockResolvedValueOnce(adapter["DUST_THRESHOLD"] - 1n);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result.matched).toBe(false);
            t.expect(result.error).toBeInstanceOf(adapters.NotActiveUserError);
        });

        t.test("should initialize state on first run", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentRethBalance
                .mockResolvedValueOnce("0xe126C916abe6E5e673d965E8BC6c5C0B5EAd4fFb") // rocketNetworkBalancesAddress
                .mockResolvedValueOnce(BigInt(10000 * 1e18)) // totalRethSupply
                .mockResolvedValueOnce(BigInt(10500 * 1e18)); // totalEthBalance

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            mocks.getLogs.mockResolvedValueOnce([]);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result.matched).toBe(false);
            t.expect(result.state).toBeDefined();
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
            t.expect(result.state?.startingEthValue).toBe(10499999999999998950n); // 10 rETH * 1.05 exchange rate
            t.expect(result.state?.ethValueChanges).toEqual([]);
        });

        t.test("should not trigger notification when interval not reached", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentRethBalance
                .mockResolvedValueOnce("0xe126C916abe6E5e673d965E8BC6c5C0B5EAd4fFb") // rocketNetworkBalancesAddress
                .mockResolvedValueOnce(BigInt(10000 * 1e18)) // totalRethSupply
                .mockResolvedValueOnce(BigInt(10500 * 1e18)); // totalEthBalance

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            mocks.getLogs.mockResolvedValueOnce([]);

            const state: rocketpool_staking_rewards.State = {
                lastBlockNumber: BigInt(900),
                lastNotificationTimestamp: Math.floor(Date.now() / 1000) - 15 * 24 * 60 * 60, // 15 days ago
                startingEthValue: BigInt(10e18),
                ethValueChanges: [BigInt(11e18)], // Deposit of 1 ETH
            };

            const result = await adapter.matchTrigger({ ...trigger, state }, client);

            t.expect(result.matched).toBe(false);
            t.expect(result.state).toBeDefined();
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
            t.expect(result.state?.ethValueChanges.length).toBe(1);
        });

        t.test("should trigger notification when interval is reached", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentRethBalance
                .mockResolvedValueOnce("0xe126C916abe6E5e673d965E8BC6c5C0B5EAd4fFb") // rocketNetworkBalancesAddress
                .mockResolvedValueOnce(BigInt(10000 * 1e18)) // totalRethSupply
                .mockResolvedValueOnce(BigInt(10500 * 1e18)); // totalEthBalance

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            mocks.getLogs.mockResolvedValueOnce([]);

            const initialState: rocketpool_staking_rewards.State = {
                lastBlockNumber: BigInt(700),
                lastNotificationTimestamp: Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60, // 31 days ago
                startingEthValue: BigInt(10e18),
                ethValueChanges: [],
            };

            const result = await adapter.matchTrigger({ ...trigger, state: initialState }, client);

            t.expect(result.matched).toBe(true);
            t.expect(result.state).toBeDefined();
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
            t.expect(result.state?.ethValueChanges).toEqual([]);
            t.expect(result.context).toBeDefined();
            t.expect(result.context?.daysSinceLastNotification).toBe(31);
        });

        t.test("should handle different notification interval settings", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentRethBalance
                .mockResolvedValueOnce("0xe126C916abe6E5e673d965E8BC6c5C0B5EAd4fFb") // rocketNetworkBalancesAddress
                .mockResolvedValueOnce(BigInt(10000 * 1e18)) // totalRethSupply
                .mockResolvedValueOnce(BigInt(10500 * 1e18)); // totalEthBalance

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            mocks.getLogs.mockResolvedValueOnce([]);

            const initialState: rocketpool_staking_rewards.State = {
                lastBlockNumber: BigInt(900),
                lastNotificationTimestamp: Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60, // 8 days ago
                startingEthValue: BigInt(10e18),
                ethValueChanges: [],
            };

            const result = await adapter.matchTrigger({ ...trigger, userSettings: { notificationIntervalDays: 7 }, state: initialState }, client);

            t.expect(result.matched).toBe(true);
            t.expect(result.context?.daysSinceLastNotification).toBe(8);
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
        });
    });

    t.describe("exchange rate", () => {
        t.test("should get rETH exchange rate with real RPC call", async () => {
            const exchangeRate = await adapter["getRethExchangeRate"](client, BigInt(20583000));
            t.expect(exchangeRate).toBe(1114328825954335594n);
        });
    });

    t.describe("eth value changes", () => {
        t.test("should get ETH value changes with real address and block range", async () => {
            const address = "0x9cCCe9d3DE172e78EF10e447A531cccb3c2185e3";
            const fromBlock = BigInt(20583077);
            const toBlock = BigInt(20583876);

            const ethValueChanges = await adapter["getEthValueChanges"](client, address, fromBlock, toBlock);

            t.expect(ethValueChanges.length).toBe(2);
            t.expect(ethValueChanges[0]).toBe(0n);
            t.expect(ethValueChanges[1]).toBe(1398209656273243n);
        });
    });

    t.describe("reward calculation", () => {
        t.test("should calculate rewards correctly when ETH value increases due to exchange rate", () => {
            const startingEthValue = BigInt(10 * 1e18);
            const endingEthValue = BigInt(11 * 1e18);
            const ethValueChanges: bigint[] = [];

            const reward = adapter["calculateRewards"](startingEthValue, endingEthValue, ethValueChanges);

            t.expect(reward).toBe(BigInt(1 * 1e18));
        });

        t.test("should calculate rewards correctly with a single deposit", () => {
            const startingEthValue = BigInt(10 * 1e18);
            const endingEthValue = BigInt(15 * 1e18);
            const ethValueChanges = [
                BigInt(14 * 1e18), // Deposit of 4 ETH
            ];

            const reward = adapter["calculateRewards"](startingEthValue, endingEthValue, ethValueChanges);

            t.expect(reward).toBe(BigInt(1 * 1e18)); // 15 - 10 - 4 = 1 ETH reward
        });

        t.test("should calculate rewards correctly with a single withdrawal", () => {
            const startingEthValue = BigInt(10 * 1e18);
            const endingEthValue = BigInt(9 * 1e18);
            const ethValueChanges = [
                BigInt(8 * 1e18), // Withdrawal of 2 ETH
            ];

            const reward = adapter["calculateRewards"](startingEthValue, endingEthValue, ethValueChanges);

            t.expect(reward).toBe(BigInt(1 * 1e18)); // 9 - 10 - (-2) = 0 ETH reward
        });

        t.test("should calculate rewards correctly with multiple deposits and withdrawals", () => {
            const startingEthValue = BigInt(10 * 1e18);
            const endingEthValue = BigInt(13 * 1e18);
            const ethValueChanges = [
                BigInt(15 * 1e18), // Deposit of 5 ETH
                BigInt(13 * 1e18), // Withdrawal of 2 ETH
                BigInt(14 * 1e18), // Deposit of 1 ETH
                BigInt(12 * 1e18), // Withdrawal of 2 ETH
            ];

            const reward = adapter["calculateRewards"](startingEthValue, endingEthValue, ethValueChanges);

            t.expect(reward).toBe(BigInt(1 * 1e18)); // 13 - 10 - (5 - 2 + 1 - 2) = 1 ETH reward
        });

        t.test("should handle zero rewards correctly", () => {
            const startingEthValue = BigInt(10 * 1e18);
            const endingEthValue = BigInt(15 * 1e18);
            const ethValueChanges = [BigInt(15 * 1e18)]; // Deposit of 5 ETH

            const reward = adapter["calculateRewards"](startingEthValue, endingEthValue, ethValueChanges);

            t.expect(reward).toBe(BigInt(0));
        });

        t.test("should handle negative rewards correctly (loss scenario)", () => {
            const startingEthValue = BigInt(10 * 1e18);
            const endingEthValue = BigInt(9 * 1e18);
            const ethValueChanges: bigint[] = [];

            const reward = adapter["calculateRewards"](startingEthValue, endingEthValue, ethValueChanges);

            t.expect(reward).toBe(BigInt(-1 * 1e18));
        });

        t.test("should calculate rewards correctly with many small changes", () => {
            const startingEthValue = BigInt(10 * 1e18);
            const endingEthValue = BigInt(10.5 * 1e18);
            const ethValueChanges = [BigInt(10.1 * 1e18), BigInt(10.2 * 1e18), BigInt(10.15 * 1e18), BigInt(10.25 * 1e18), BigInt(10.3 * 1e18)];

            const reward = adapter["calculateRewards"](startingEthValue, endingEthValue, ethValueChanges);

            t.expect(reward).toBe(BigInt(0.2 * 1e18)); // 10.5 - 10 - (0.3 - 0) = 0.2 ETH reward
        });
    });

    t.describe("mapping", () => {
        t.test("should map into notification data", async () => {
            const context: rocketpool_staking_rewards.Context = {
                currentRethBalance: BigInt(10 * 1e18),
                currentExchangeRate: BigInt(1.05 * 1e18),
                currentEthValue: BigInt(10.5 * 1e18),
                estimatedTotalRewardInPeriod: BigInt(0.5 * 1e18),
                daysSinceLastNotification: 30,
            };

            const data = await adapter.mapIntoNotificationData(trigger, context);

            t.expect(data).toEqual({
                chainId: domain.Chain.Ethereum,
                currentRethBalance: "10",
                currentEthValue: "10.5",
                estimatedTotalRewardInPeriod: "0.5",
                daysSinceLastNotification: 30,
                notificationIntervalDays: 30,
            });
        });
    });
});
