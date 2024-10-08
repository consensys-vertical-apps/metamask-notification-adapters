import * as viem from "viem";
import * as errors from "#/adapters/errors";
import type * as types from "#/adapters/types";
import * as utils from "#/adapters/utils";
import * as domain from "#/domain";

export type UserSettings = {
    reverseEnsName: string;
    reminderDelayInSeconds: number;
};

export type State = null;

export type Context = {
    reverseEnsName: string;
    expirationDateIso: string;
};

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    private readonly ENS_REGISTRAR_ADDRESS = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85";

    private readonly ENS_REGISTRAR_ABI = viem.parseAbi(["function nameExpires(uint256 id) view returns (uint256)"]);

    private readonly DEFAULT_REMINDER_DELAY_IN_SECONDS = 7 * 24 * 60 * 60; // 1 week

    // check if the user address reverse to a valid ENS domain
    public async checkUser(address: viem.Address, chainId: domain.Chain, client: viem.PublicClient, blockNumber: bigint): Promise<types.UserCheckResult<UserSettings>> {
        if (chainId !== domain.Chain.Ethereum) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        const reverseEnsName = await client.getEnsName({ address, blockNumber });

        // if the user doesn't have a reverse ENS name, it's not an active user
        if (!reverseEnsName) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        // if the reverse ENS name is not a second level domain, it's not an active user
        const labels = reverseEnsName.split(".");
        if (labels.length !== 2 && labels[1] !== "eth") {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        return { active: true, userSettings: { reverseEnsName, reminderDelayInSeconds: this.DEFAULT_REMINDER_DELAY_IN_SECONDS } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, client: viem.PublicClient, blockNumber: bigint): Promise<types.MatchResult<State, Context>> {
        // check if the chain is supported
        if (trigger.chainId !== domain.Chain.Ethereum) {
            return { matched: false, error: new errors.NotSupportedChainError() };
        }

        // check if the trigger address is still the resolved address of the ENS
        const resolvedAddress = await client.getEnsAddress({ name: trigger.userSettings.reverseEnsName, blockNumber });
        if (!resolvedAddress || viem.getAddress(resolvedAddress) !== viem.getAddress(trigger.address)) {
            return { matched: false, error: new errors.NotActiveUserError() };
        }

        // get ENS token id
        const ensName = trigger.userSettings.reverseEnsName;
        const label = ensName.split(".")[0];
        const tokenId = BigInt(viem.keccak256(viem.toHex(label)));

        // get expiration date
        const expirationDate = await client.readContract({
            address: this.ENS_REGISTRAR_ADDRESS,
            abi: this.ENS_REGISTRAR_ABI,
            functionName: "nameExpires",
            args: [tokenId],
            blockNumber,
        });

        // get delay before expiration
        const expirationDateInSeconds = Number(expirationDate);
        const expirationDateInMs = expirationDateInSeconds * 1000;
        const timeBeforeExpirationInSeconds = (expirationDateInMs - Date.now()) / 1000;

        // check if the expiration date is close enough, if so, return a match
        if (timeBeforeExpirationInSeconds < trigger.userSettings.reminderDelayInSeconds) {
            const expirationDateIso = new Date(expirationDateInMs).toISOString();

            return {
                matched: true,
                dedupKey: this.makeDedupKey(trigger.userSettings.reverseEnsName, expirationDateIso),
                context: { reverseEnsName: trigger.userSettings.reverseEnsName, expirationDateIso },
            };
        }

        return { matched: false };
    }

    public async mapIntoNotificationData(trigger: domain.Trigger<UserSettings, State>, context: Context): Promise<domain.NotificationData> {
        return {
            chainId: trigger.chainId,
            reverseEnsName: context.reverseEnsName,
            expirationDateIso: context.expirationDateIso,
            reminderDelayInSeconds: trigger.userSettings.reminderDelayInSeconds,
        };
    }

    private makeDedupKey(reverseEnsName: string, expirationDateIso: string): string {
        return utils.hash(`${reverseEnsName}-${expirationDateIso}`);
    }
}
