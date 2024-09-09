import * as t from "bun:test";
import * as uuid from "uuid";
import * as adapters from "#/adapters";
import * as lido_staking_rewards from "#/adapters/lido/staking_rewards";
import * as domain from "#/domain";
import * as testutils from "#/testutils";

t.describe("lido_staking_rewards adapter", () => {
    const adapter = new lido_staking_rewards.Adapter();
    const client = testutils.createRPCClient();

    const trigger: domain.Trigger<lido_staking_rewards.UserSettings, lido_staking_rewards.State> = {
        id: uuid.v4(),
        chainId: domain.Chain.Ethereum,
        kind: domain.Kind.LidoStakingRewards,
        address: "0x1234567890123456789012345678901234567890",
        userSettings: { notificationIntervalDays: 30 },
        state: null as unknown as lido_staking_rewards.State,
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
                address: adapter["STETH_TOKEN_ADDRESS"],
                abi: adapter["STETH_ABI"],
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
            mocks.readContract.mockResolvedValueOnce(adapter["STETH_DUST_THRESHOLD"] - 1n);
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);
            t.expect(result).toEqual({ active: false, error: new adapters.NotActiveUserError() });
        });

        t.test("should handle active user", async () => {
            mocks.readContract.mockResolvedValueOnce(adapter["STETH_DUST_THRESHOLD"] + 1n);
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);
            t.expect(result).toEqual({ active: true, userSettings: { notificationIntervalDays: 30 } });
        });
    });

    t.describe("matching", () => {
        t.test("should return NotActiveUserError for balance below dust threshold", async () => {
            mocks.readContract.mockResolvedValueOnce(adapter["STETH_DUST_THRESHOLD"] - 1n);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result.matched).toBe(false);
            t.expect(result.error).toBeInstanceOf(adapters.NotActiveUserError);
        });

        t.test("should initialize state on first run", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentStethBalance
                .mockResolvedValueOnce(BigInt(1.05 * 1e18)); // stETH exchange rate

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result.matched).toBe(false);
            t.expect(result.state).toBeDefined();
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
            t.expect(result.state?.startBalance).toBe(BigInt(10 * 1e18));
            t.expect(result.state?.startRate).toBe(BigInt(1.05 * 1e18));
            t.expect(result.state?.deposits).toBe(0n);
            t.expect(result.state?.withdrawals).toBe(0n);
        });

        t.test("should not trigger notification when interval not reached", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentStethBalance
                .mockResolvedValueOnce(BigInt(1.05 * 1e18)); // stETH exchange rate

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            mocks.getLogs
                .mockResolvedValueOnce([]) // deposits
                .mockResolvedValueOnce([]); // withdrawals

            const state: lido_staking_rewards.State = {
                lastBlockNumber: BigInt(900),
                lastNotificationTimestamp: Math.floor(Date.now() / 1000) - 15 * 24 * 60 * 60, // 15 days ago
                startBalance: BigInt(9 * 1e18),
                startRate: BigInt(1.04 * 1e18),
                deposits: 1n,
                withdrawals: 1n,
            };

            const result = await adapter.matchTrigger({ ...trigger, state }, client);

            t.expect(result.matched).toBe(false);
            t.expect(result.state).toBeDefined();
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
            t.expect(result.state?.deposits).toBe(1n);
            t.expect(result.state?.withdrawals).toBe(1n);
        });

        t.test("should trigger notification when interval is reached", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentStethBalance
                .mockResolvedValueOnce(BigInt(1.05 * 1e18)); // stETH exchange rate

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            mocks.getLogs
                .mockResolvedValueOnce([]) // deposits
                .mockResolvedValueOnce([]); // withdrawals

            const initialState: lido_staking_rewards.State = {
                lastBlockNumber: BigInt(700),
                lastNotificationTimestamp: Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60, // 31 days ago
                startBalance: BigInt(9 * 1e18),
                startRate: BigInt(1.04 * 1e18),
                deposits: 1n,
                withdrawals: 1n,
            };

            const result = await adapter.matchTrigger({ ...trigger, state: initialState }, client);

            t.expect(result.matched).toBe(true);
            t.expect(result.state).toBeDefined();
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
            t.expect(result.state?.deposits).toBe(0n);
            t.expect(result.state?.withdrawals).toBe(0n);
            t.expect(result.context).toBeDefined();
            t.expect(result.context?.daysSinceLastNotification).toBe(31);
        });

        t.test("should handle different notification interval settings", async () => {
            mocks.readContract
                .mockResolvedValueOnce(BigInt(10 * 1e18)) // currentStethBalance
                .mockResolvedValueOnce(BigInt(1.05 * 1e18)); // stETH exchange rate

            mocks.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

            mocks.getLogs
                .mockResolvedValueOnce([]) // deposits
                .mockResolvedValueOnce([]); // withdrawals

            const initialState: lido_staking_rewards.State = {
                lastBlockNumber: BigInt(900),
                lastNotificationTimestamp: Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60, // 8 days ago
                startBalance: BigInt(9 * 1e18),
                startRate: BigInt(1.04 * 1e18),
                deposits: 0n,
                withdrawals: 0n,
            };

            const result = await adapter.matchTrigger({ ...trigger, userSettings: { notificationIntervalDays: 7 }, state: initialState }, client);

            t.expect(result.matched).toBe(true);
            t.expect(result.context?.daysSinceLastNotification).toBe(8);
            t.expect(result.state?.lastBlockNumber).toBe(BigInt(1000));
        });
    });

    t.describe("exchange rate", () => {
        t.test("should get stETH exchange rate with real RPC call", async () => {
            const exchangeRate = await adapter["getStethExchangeRate"](client, BigInt(20626033));
            t.expect(exchangeRate).toBe(1177101458282319168n);
        });
    });

    t.describe("deposit and withdrawal tracking", () => {
        t.test("should track deposits correctly", async () => {
            const deposits = await adapter["trackDeposits"](client, "0xddBEfaA6EEBD13ACA8613018501eEF8247287C16", BigInt(20625938), BigInt(20626033));
            t.expect(deposits).toBe(588550729141159584n);
        });

        t.test("should track withdrawals correctly", async () => {
            const withdrawals = await adapter["trackWithdrawals"](client, "0xddBEfaA6EEBD13ACA8613018501eEF8247287C16", BigInt(20625938), BigInt(20626033));
            t.expect(withdrawals).toBe(588550729141159584n);
        });
    });

    t.describe("reward calculation", () => {
        t.test("should calculate rewards correctly when stETH value increases due to exchange rate", () => {
            const startBalance = BigInt(10 * 1e18);
            const startRate = BigInt(1 * 1e18);
            const endBalance = BigInt(10 * 1e18);
            const endRate = BigInt(1.05 * 1e18);
            const deposits = BigInt(0);
            const withdrawals = BigInt(0);

            const reward = adapter["calculateRewards"](startBalance, startRate, endBalance, endRate, deposits, withdrawals);

            // (10 * 1.05) - (10 * 1) = 0.5
            t.expect(reward).toBe(BigInt(0.5 * 1e18));
        });

        t.test("should calculate rewards correctly with a single deposit", () => {
            const startBalance = BigInt(10 * 1e18);
            const startRate = BigInt(1 * 1e18);
            const endBalance = BigInt(15 * 1e18);
            const endRate = BigInt(1.05 * 1e18);
            const deposits = BigInt(5 * 1e18);
            const withdrawals = BigInt(0);

            const reward = adapter["calculateRewards"](startBalance, startRate, endBalance, endRate, deposits, withdrawals);

            // (15 * 1.05) - (10 * 1) - 5 = 0.75
            t.expect(reward).toBe(BigInt(0.75 * 1e18));
        });

        t.test("should calculate rewards correctly with a single withdrawal", () => {
            const startBalance = BigInt(10 * 1e18);
            const startRate = BigInt(1 * 1e18);
            const endBalance = BigInt(8 * 1e18);
            const endRate = BigInt(1.05 * 1e18);
            const deposits = BigInt(0);
            const withdrawals = BigInt(2 * 1e18);

            const reward = adapter["calculateRewards"](startBalance, startRate, endBalance, endRate, deposits, withdrawals);

            // (8 * 1.05) - (10 * 1) + 2 = 0.4
            t.expect(reward).toBe(BigInt(0.4 * 1e18));
        });

        t.test("should calculate rewards correctly with multiple deposits and withdrawals", () => {
            const startBalance = BigInt(10 * 1e18);
            const startRate = BigInt(1 * 1e18);
            const endBalance = BigInt(12 * 1e18);
            const endRate = BigInt(1.05 * 1e18);
            const deposits = BigInt(5 * 1e18);
            const withdrawals = BigInt(3 * 1e18);

            const reward = adapter["calculateRewards"](startBalance, startRate, endBalance, endRate, deposits, withdrawals);

            // (12 * 1.05) - (10 * 1) - 5 + 3 = 0.6
            t.expect(reward).toBe(BigInt(0.6 * 1e18));
        });

        t.test("should handle zero rewards correctly", () => {
            const startBalance = BigInt(10 * 1e18);
            const startRate = BigInt(1 * 1e18);
            const endBalance = BigInt(15 * 1e18);
            const endRate = BigInt(1 * 1e18);
            const deposits = BigInt(5 * 1e18);
            const withdrawals = BigInt(0);

            const reward = adapter["calculateRewards"](startBalance, startRate, endBalance, endRate, deposits, withdrawals);

            // (15 * 1) - (10 * 1) - 5 = 0
            t.expect(reward).toBe(BigInt(0));
        });

        t.test("should handle negative rewards correctly (loss scenario)", () => {
            const startBalance = BigInt(10 * 1e18);
            const startRate = BigInt(1 * 1e18);
            const endBalance = BigInt(10 * 1e18);
            const endRate = BigInt(0.95 * 1e18);
            const deposits = BigInt(0);
            const withdrawals = BigInt(0);

            const reward = adapter["calculateRewards"](startBalance, startRate, endBalance, endRate, deposits, withdrawals);

            // (10 * 0.95) - (10 * 1) = -0.5
            t.expect(reward).toBe(BigInt(-0.5 * 1e18));
        });
    });

    t.describe("mapping", () => {
        t.test("should map into notification data", async () => {
            const context: lido_staking_rewards.Context = {
                currentStethBalance: BigInt(10 * 1e18),
                currentExchangeRate: BigInt(1.05 * 1e18),
                currentEthValue: BigInt(10.5 * 1e18),
                estimatedTotalRewardInPeriod: BigInt(0.5 * 1e18),
                daysSinceLastNotification: 30,
            };

            const data = await adapter.mapIntoNotificationData(trigger, context);

            t.expect(data).toEqual({
                chainId: domain.Chain.Ethereum,
                currentStethBalance: "10",
                currentEthValue: "10.5",
                estimatedTotalRewardInPeriod: "0.5",
                daysSinceLastNotification: 30,
                notificationIntervalDays: 30,
            });
        });
    });
});
