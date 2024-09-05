import * as t from "bun:test";
import * as uuid from "uuid";
import * as viem from "viem";
import * as errors from "#/adapters/errors";
import * as notional_loan_expiration from "#/adapters/notional/loan_expiration";
import * as utils from "#/adapters/utils";
import * as domain from "#/domain";
import * as testutils from "#/testutils";

t.describe("notional_loan_expiration adapter", () => {
    const adapter = new notional_loan_expiration.Adapter();
    const client = testutils.createRPCClient();

    const defaultReminderDelayInSeconds = 60 * 60 * 24 * 7;
    const nowInSeconds = Date.now() / 1000;

    const trigger: domain.Trigger<notional_loan_expiration.UserSettings, notional_loan_expiration.State> = {
        id: uuid.v4(),
        chainId: domain.Chain.Ethereum,
        kind: domain.Kind.EnsExpiration,
        address: "0x12Dec026d5826F95bA23957529B36a386E085583",
        userSettings: { reminderDelayInSeconds: defaultReminderDelayInSeconds },
        state: null,
        matchDedupKey: null,
        scheduledAt: new Date(),
    };

    t.describe("check user", () => {
        t.test("should handle not supported chain", async () => {
            const result = await adapter.checkUser(trigger.address, domain.Chain.None, client);
            t.expect(result).toEqual({ active: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should call the right function with the right args", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([0n]);

            await adapter.checkUser(trigger.address, domain.Chain.Ethereum, client);

            t.expect(readContract).toHaveBeenCalledWith({
                address: adapter["ROUTER_ADDRESSES"][domain.Chain.Ethereum],
                abi: adapter["ROUTER_ABI"],
                functionName: "getAccountPortfolio",
                args: [trigger.address],
            });

            readContract.mockRestore();
        });

        t.test("should handle not active user if he is a lender of ETH", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 1n,
                    notional: adapter["ASSETS"]["1"].dustThreshold + 1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.checkUser(trigger.address, domain.Chain.Ethereum, client);

            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should handle not active user if it's not the right assetType", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 2n,
                    notional: adapter["ASSETS"]["1"].dustThreshold * -1n + 1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.checkUser(trigger.address, domain.Chain.Ethereum, client);

            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should handle not active user if he is a borrower of to few ETH amount", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 1n,
                    notional: (adapter["ASSETS"]["1"].dustThreshold - 1n) * -1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.checkUser(trigger.address, domain.Chain.Ethereum, client);

            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should handle acive user if he is a borrower", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 1n,
                    notional: (adapter["ASSETS"]["1"].dustThreshold + 1n) * -1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.checkUser(trigger.address, domain.Chain.Ethereum, client);

            t.expect(result).toEqual({ active: true, userSettings: { reminderDelayInSeconds: adapter["DEFAULT_REMINDER_DELAY_IN_SECONDS"] } });

            readContract.mockRestore();
        });
    });

    t.describe("matching", () => {
        t.test("should error when chain is not supported", async () => {
            const result = await adapter.matchTrigger({ ...trigger, chainId: domain.Chain.None }, client);

            t.expect(result).toEqual({ matched: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should call the right function with the right args", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([0n]);

            await adapter.matchTrigger(trigger, client);

            t.expect(readContract).toHaveBeenCalledWith({
                address: adapter["ROUTER_ADDRESSES"][trigger.chainId],
                abi: adapter["ROUTER_ABI"],
                functionName: "getAccountPortfolio",
                args: [trigger.address],
            });

            readContract.mockRestore();
        });

        t.test("should NOT match if he is a lender of ETH", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 1n,
                    notional: adapter["ASSETS"]["1"].dustThreshold + 1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should NOT match if it's not the right assetType", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 2n,
                    notional: adapter["ASSETS"]["1"].dustThreshold * -1n + 1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should NOT match if he is a borrower of to few ETH amount", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 1n,
                    notional: (adapter["ASSETS"]["1"].dustThreshold - 1n) * -1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should NOT match if he is a borrower of to few ETH amount", async () => {
            const readContract = t.spyOn(client, "readContract").mockResolvedValue([
                {
                    currencyId: 1n,
                    maturity: 1734048000n,
                    assetType: 1n,
                    notional: (adapter["ASSETS"]["1"].dustThreshold - 1n) * -1n,
                    storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                    storageState: 0,
                },
            ]);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });

            readContract.mockRestore();
        });

        t.test("should NOT match if  he is a borrower and maturity date is AFTER the reminder delay", async () => {
            const shouldMatchLoan = {
                currencyId: 1n,
                maturity: nowInSeconds + defaultReminderDelayInSeconds + 24 * 60 * 60,
                assetType: 1n,
                notional: (adapter["ASSETS"]["1"].dustThreshold + 1n) * -1n,
                storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                storageState: 0,
            };

            const readContract = t.spyOn(client, "readContract").mockResolvedValue([shouldMatchLoan]);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result).toEqual({
                matched: false,
            });

            readContract.mockRestore();
        });

        t.test("should match if  he is a borrower and maturity date is BEFORE the reminder delay", async () => {
            const shouldMatchLoan = {
                currencyId: 1n,
                maturity: nowInSeconds + defaultReminderDelayInSeconds - 24 * 60 * 60,
                assetType: 1n,
                notional: (adapter["ASSETS"]["1"].dustThreshold + 1n) * -1n,
                storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                storageState: 0,
            };

            const readContract = t.spyOn(client, "readContract").mockResolvedValue([shouldMatchLoan]);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result).toEqual({
                matched: true,
                dedupKey: utils.hash(64762116923627733193802365266767621221483210159693794380068657886677035590578n.toString()),
                context: {
                    loans: [
                        {
                            amount: Math.abs(Number(viem.formatUnits(shouldMatchLoan.notional, 8))),
                            symbol: adapter["ASSETS"][shouldMatchLoan.currencyId.toString()].symbol,
                            maturityDateInSecs: Number(shouldMatchLoan.maturity),
                            storageSlot: 64762116923627733193802365266767621221483210159693794380068657886677035590578n,
                        },
                    ],
                },
            });

            readContract.mockRestore();
        });

        t.test("should order by maturityDate desc the matched loans", async () => {
            const shouldMatchLoan = {
                currencyId: 1n,
                maturity: nowInSeconds + defaultReminderDelayInSeconds - 24 * 60 * 60,
                assetType: 1n,
                notional: (adapter["ASSETS"]["1"].dustThreshold + 1n) * -1n,
                storageSlot: 1234n,
                storageState: 0,
            };

            const shouldMatchLoans = [
                shouldMatchLoan,
                { ...shouldMatchLoan, maturity: shouldMatchLoan.maturity - 24 * 60 * 60, storageSlot: 4567n },
                { ...shouldMatchLoan, maturity: shouldMatchLoan.maturity + 12 * 60 * 60, storageSlot: 8910n },
            ];

            const readContract = t.spyOn(client, "readContract").mockResolvedValue(shouldMatchLoans);

            const result = await adapter.matchTrigger(trigger, client);

            t.expect(result.matched).toBeTrue();
            if (!result.matched) {
                // Only to make TS happy
                throw new Error("Should be matched");
            }
            t.expect(result?.dedupKey).toEqual(utils.hash([8910n, 1234n, 4567n].map((value) => value.toString()).join("-")));
            t.expect(result?.context.loans.map((value) => value.storageSlot)).toEqual([8910n, 1234n, 4567n]);

            readContract.mockRestore();
        });
    });

    t.describe("mapping", () => {
        t.test("should map into notification data", async () => {
            const expirationDateInSeconds = nowInSeconds + defaultReminderDelayInSeconds - 24 * 60 * 60;
            const context: notional_loan_expiration.Context = {
                loans: [
                    {
                        amount: 1.1234,
                        symbol: "ETH",
                        maturityDateInSecs: expirationDateInSeconds,
                        storageSlot: 1234n,
                    },
                ],
            };
            const data = await adapter.mapIntoNotificationData(trigger, context);

            t.expect(data).toEqual({
                chainId: domain.Chain.Ethereum,
                loans: [
                    {
                        amount: 1.1234,
                        symbol: "ETH",
                        maturityDateIso: new Date(expirationDateInSeconds * 1000),
                    },
                ],
                reminderDelayInSeconds: trigger.userSettings.reminderDelayInSeconds,
            });
        });
    });
});
