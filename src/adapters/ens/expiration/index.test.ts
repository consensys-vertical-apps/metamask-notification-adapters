import * as t from "bun:test";
import * as uuid from "uuid";
import * as ens_expiration from "#/adapters/ens/expiration";
import * as errors from "#/adapters/errors";
import * as utils from "#/adapters/utils";
import * as domain from "#/domain";
import * as testutils from "#/testutils";

t.describe("ens_expiration adapter", () => {
    const adapter = new ens_expiration.Adapter();
    const client = testutils.createRPCClient();
    const defaultReminderDelayInSeconds = 60 * 60 * 24 * 7;
    const nowInSeconds = Date.now() / 1000;
    const blockNumber = 20868505n;

    const trigger: domain.Trigger<ens_expiration.UserSettings, ens_expiration.State> = {
        id: uuid.v4(),
        chainId: domain.Chain.Ethereum,
        kind: domain.Kind.EnsExpiration,
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        userSettings: { reverseEnsName: "vitalik.eth", reminderDelayInSeconds: defaultReminderDelayInSeconds },
        state: null,
        matchDedupKey: null,
        scheduledAt: new Date(),
    };

    t.describe("check user", () => {
        t.test("should handle not supported chain", async () => {
            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.None, client, blockNumber);
            t.expect(result).toEqual({ active: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should call with the right args", async () => {
            const getEnsName = t.spyOn(client, "getEnsName").mockResolvedValue(null);

            await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client, blockNumber);

            t.expect(getEnsName).toHaveBeenCalledWith({
                address: "0x12Dec026d5826F95bA23957529B36a386E085583",
                blockNumber,
            });

            getEnsName.mockRestore();
        });

        t.test("should NOT handle user WITHOUT a reverse name", async () => {
            const getEnsName = t.spyOn(client, "getEnsName").mockResolvedValue(null);

            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client, blockNumber);

            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });

            getEnsName.mockRestore();
        });

        t.test("should NOT handle user WITHOUT a first level reverse name", async () => {
            const getEnsName = t.spyOn(client, "getEnsName").mockResolvedValue("test.linea.eth");

            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client, blockNumber);

            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });

            getEnsName.mockRestore();
        });

        t.test("should NOT handle user WITH a subdomain reverse name", async () => {
            const getEnsName = t.spyOn(client, "getEnsName").mockResolvedValue("slasha.vitalik.eth");

            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client, blockNumber);

            t.expect(result).toEqual({ active: false, error: new errors.NotActiveUserError() });

            getEnsName.mockRestore();
        });

        t.test("should handle user WITH a first level reverse name", async () => {
            const getEnsName = t.spyOn(client, "getEnsName").mockResolvedValue("vitalik.eth");

            const result = await adapter.checkUser("0x12Dec026d5826F95bA23957529B36a386E085583", domain.Chain.Ethereum, client, blockNumber);

            t.expect(result).toEqual({
                active: true,
                userSettings: { reverseEnsName: "vitalik.eth", reminderDelayInSeconds: adapter["DEFAULT_REMINDER_DELAY_IN_SECONDS"] },
            });

            getEnsName.mockRestore();
        });
    });

    t.describe("matching", () => {
        t.test("should error when chain is not supported", async () => {
            const result = await adapter.matchTrigger({ ...trigger, chainId: domain.Chain.None }, client, blockNumber);

            t.expect(result).toEqual({ matched: false, error: new errors.NotSupportedChainError() });
        });

        t.test("should error when ENS resolve an other address", async () => {
            const getEnsAddress = t.spyOn(client, "getEnsAddress").mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046");

            const result = await adapter.matchTrigger(trigger, client, blockNumber);

            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });

            getEnsAddress.mockRestore();
        });

        t.test("should error when ENS do not resolve a address anymore", async () => {
            const getEnsAddress = t.spyOn(client, "getEnsAddress").mockResolvedValue(null);

            const result = await adapter.matchTrigger(trigger, client, blockNumber);

            t.expect(result).toEqual({ matched: false, error: new errors.NotActiveUserError() });

            getEnsAddress.mockRestore();
        });

        t.test("should match when expiration date is BEFORE the reminder delay", async () => {
            // Mock the readContract method to return the expiration 1 day before the reminder delay
            const expirationDateInSeconds = nowInSeconds + defaultReminderDelayInSeconds - 24 * 60 * 60;
            const getEnsAddress = t.spyOn(client, "getEnsAddress").mockResolvedValue(trigger.address);
            const readContract = t.spyOn(client, "readContract").mockResolvedValue(expirationDateInSeconds);

            const expirationDateIso = new Date(expirationDateInSeconds * 1000).toISOString();

            const result = await adapter.matchTrigger(trigger, client, blockNumber);

            t.expect(result).toEqual({
                matched: true,
                dedupKey: utils.hash(`${trigger.userSettings.reverseEnsName}-${expirationDateIso}`),
                context: { reverseEnsName: trigger.userSettings.reverseEnsName, expirationDateIso },
            });

            readContract.mockRestore();
            getEnsAddress.mockRestore();
        });

        t.test("should NOT match when expiration date is AFTER the reminder delay", async () => {
            // Mock the readContract method to return the expiration 1 day after the reminder delay
            const expirationDateInSeconds = nowInSeconds + defaultReminderDelayInSeconds + 24 * 60 * 60;
            const getEnsAddress = t.spyOn(client, "getEnsAddress").mockResolvedValue(trigger.address);
            const readContract = t.spyOn(client, "readContract").mockResolvedValue(expirationDateInSeconds);

            const result = await adapter.matchTrigger(trigger, client, blockNumber);

            t.expect(result).toEqual({
                matched: false,
            });

            readContract.mockRestore();
            getEnsAddress.mockRestore();
        });
    });

    t.describe("mapping", () => {
        t.test("should map into notification data", async () => {
            const expirationDateInSeconds = nowInSeconds + defaultReminderDelayInSeconds - 24 * 60 * 60;
            const context: ens_expiration.Context = {
                reverseEnsName: trigger.userSettings.reverseEnsName,
                expirationDateIso: new Date(expirationDateInSeconds * 1000).toISOString(),
            };
            const data = await adapter.mapIntoNotificationData(trigger, context);

            t.expect(data).toEqual({
                chainId: domain.Chain.Ethereum,
                reverseEnsName: context.reverseEnsName,
                expirationDateIso: context.expirationDateIso,
                reminderDelayInSeconds: trigger.userSettings.reminderDelayInSeconds,
            });
        });
    });
});
