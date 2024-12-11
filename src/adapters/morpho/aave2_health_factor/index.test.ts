import * as t from "bun:test";
import * as errors from "#/adapters/errors";
import * as morpho_compound_health_factor from "#/adapters/morpho/compound_health_factor";
import * as domain from "#/domain";
import * as viem from "viem";
import * as uuid from "uuid";
import * as viemChains from "viem/chains";

t.describe("morpho_compound_health_factor adapter", () => {
    const adapter = new morpho_compound_health_factor.Adapter();
    const publicClient = viem.createPublicClient({ transport: viem.http(viemChains.mainnet.rpcUrls.default.http[0]), chain: viemChains.mainnet });

    const trigger: domain.Trigger<morpho_compound_health_factor.UserSettings, morpho_compound_health_factor.State> = {
        id: uuid.v4(),
        chainId: domain.Chain.Ethereum,
        kind: domain.Kind.AaveV3HealthFactor,
        address: "0x12Dec026d5826F95bA23957529B36a386E085583",
        userSettings: { healthFactorThreshold: 1.1 },
        state: null,
        matchDedupKey: null,
        scheduledAt: new Date(),
    };

    t.describe("check user", () => {
        t.test("should handle not supported chain", async () => {
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.None, publicClient);
            t.expect(result).toEqual({ active: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should call the right function with the right args", async () => {
            const readContract = t.spyOn(publicClient, "readContract").mockResolvedValue([]);

            await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, publicClient);

            t.expect(readContract).toHaveBeenCalledWith({
                address: adapter["LENS_ADDRESSES"][domain.Chain.Ethereum],
                abi: adapter["lensAbi"],
                functionName: "getEnteredMarkets",
                args: ["0x12Dec026d5826F95bA23957529B36a386E085583"],
            });

            readContract.mockRestore();
        });

        t.test("should handle not active user", async () => {
            const readContract = t.spyOn(publicClient, "readContract").mockResolvedValue([]);

            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, publicClient);

            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should handle acive user", async () => {
            const readContract = t.spyOn(publicClient, "readContract").mockResolvedValue([1n]);

            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, publicClient);

            t.expect(result).toEqual({ active: true, userSettings: { healthFactorThreshold: 1.1 } });

            readContract.mockRestore();
        });
    });

    t.describe("matching", () => {
        t.test("should error when chain is not supported", async () => {
            const result = await adapter.matchTrigger({ ...trigger, chainId: domain.Chain.None }, publicClient);

            t.expect(result).toEqual({ matched: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should call the right function with the right args", async () => {
            const readContract = t.spyOn(publicClient, "readContract").mockResolvedValue(0n);

            await adapter.matchTrigger(trigger, publicClient);

            t.expect(readContract).toHaveBeenCalledWith({
                address: adapter["LENS_ADDRESSES"][domain.Chain.Ethereum],
                abi: adapter["lensAbi"],
                functionName: "getUserHealthFactor",
                args: ["0x12Dec026d5826F95bA23957529B36a386E085583"],
            });

            readContract.mockRestore();
        });

        t.test("should error when user is not active", async () => {
            const readContract = t.spyOn(publicClient, "readContract").mockResolvedValueOnce([]);

            const result = await adapter.matchTrigger(trigger, publicClient);

            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should match when current health factor value is below the threshold", async () => {
            const readContract = t
                .spyOn(publicClient, "readContract")
                .mockResolvedValueOnce([1n])
                .mockResolvedValueOnce(BigInt(1.05 * 10 ** 18));

            const result = await adapter.matchTrigger(trigger, publicClient);

            t.expect(result).toEqual({ matched: true, dedupKey: "b326b5062b2f0e69046810717534cb09", context: { healthFactor: 1.05 } });

            readContract.mockRestore();
        });

        t.test("should not match when current health factor value is above the threshold", async () => {
            const readContract = t
                .spyOn(publicClient, "readContract")
                .mockResolvedValueOnce([1n])
                .mockResolvedValueOnce(BigInt(1.2 * 10 ** 18));

            const result = await adapter.matchTrigger(trigger, publicClient);

            t.expect(result).toEqual({ matched: false });

            readContract.mockRestore();
        });
    });

    t.describe("mapping", () => {
        t.test("should map into notification data", async () => {
            const context: morpho_compound_health_factor.Context = { healthFactor: 1.05 };
            const data = await adapter.mapIntoNotificationData(trigger, context);

            t.expect(data).toEqual({ chainId: domain.Chain.Ethereum, healthFactor: 1.05, threshold: 1.1 });
        });
    });
});
