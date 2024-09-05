import * as t from "bun:test";
import * as uuid from "uuid";
import * as errors from "#/adapters/errors";
import * as spark_fi_health_factor from "#/adapters/spark_fi/health_factor";
import * as domain from "#/domain";
import * as testutils from "#/testutils";

t.describe("spark_fi_health_factor adapter", () => {
    const adapter = new spark_fi_health_factor.Adapter();
    const client = testutils.createRPCClient();

    const trigger: domain.Trigger<spark_fi_health_factor.UserSettings, spark_fi_health_factor.State> = {
        id: uuid.v4(),
        chainId: domain.Chain.Ethereum,
        kind: domain.Kind.SparkFiHealthFactor,
        address: "0x12Dec026d5826F95bA23957529B36a386E085583",
        userSettings: { healthFactorThreshold: 5.5 },
        state: null,
        matchDedupKey: null,
        scheduledAt: new Date(),
    };

    const mocks = {
        readContract: t.spyOn(client, "readContract"),
    };

    t.beforeEach(() => {
        mocks.readContract.mockClear();
    });

    t.describe("check user", () => {
        t.test("should handle not supported chain", async () => {
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.None, client);
            t.expect(result).toEqual({ active: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should call the right function with the right args", async () => {
            mocks.readContract.mockResolvedValueOnce([0n]);

            await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);

            t.expect(mocks.readContract).toHaveBeenCalledWith({
                address: adapter["POOL_ADDRESSES"][domain.Chain.Ethereum],
                abi: adapter["POOL_ABI"],
                functionName: "getUserAccountData",
                args: ["0x12Dec026d5826F95bA23957529B36a386E085583"],
            });
        });

        t.test("should handle not active user", async () => {
            mocks.readContract.mockResolvedValueOnce([0n]);
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);
            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });
        });

        t.test("should handle acive user", async () => {
            mocks.readContract.mockResolvedValueOnce([1n]);
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client);
            t.expect(result).toEqual({ active: true, userSettings: { healthFactorThreshold: 1.1 } });
        });
    });

    t.describe("matching", () => {
        t.test("should error when chain is not supported", async () => {
            const result = await adapter.matchTrigger({ ...trigger, chainId: domain.Chain.None }, client);
            t.expect(result).toEqual({ matched: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should call the right function with the right args", async () => {
            mocks.readContract.mockResolvedValueOnce([0n]);

            await adapter.matchTrigger(trigger, client);

            t.expect(mocks.readContract).toHaveBeenCalledWith({
                address: adapter["POOL_ADDRESSES"][domain.Chain.Ethereum],
                abi: adapter["POOL_ABI"],
                functionName: "getUserAccountData",
                args: ["0x12Dec026d5826F95bA23957529B36a386E085583"],
            });
        });

        t.test("should error when user is not active", async () => {
            mocks.readContract.mockResolvedValueOnce([0n, 0n, 0n, 0n, 0n, 0n]);
            const result = await adapter.matchTrigger(trigger, client);
            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });
        });

        t.test("should match when current health factor value exceeds threshold", async () => {
            mocks.readContract.mockResolvedValueOnce([1n, 0n, 0n, 0n, 0n, BigInt(3.4 * 10 ** 18)]);
            const result = await adapter.matchTrigger(trigger, client);
            t.expect(result).toEqual({ matched: true, dedupKey: "b326b5062b2f0e69046810717534cb09", context: { healthFactor: 3.4 } });
        });

        t.test("should not match when current health factor value does not exceed threshold", async () => {
            mocks.readContract.mockResolvedValueOnce([1n, 0n, 0n, 0n, 0n, BigInt(6 * 10 ** 18)]);
            const result = await adapter.matchTrigger(trigger, client);
            t.expect(result).toEqual({ matched: false });
        });
    });

    t.describe("mapping", () => {
        t.test("should map into notification data", async () => {
            const context: spark_fi_health_factor.Context = { healthFactor: 3.4 };
            const data = await adapter.mapIntoNotificationData(trigger, context);
            t.expect(data).toEqual({ chainId: domain.Chain.Ethereum, healthFactor: 3.4, threshold: 5.5 });
        });
    });
});
