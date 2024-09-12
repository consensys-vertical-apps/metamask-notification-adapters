import * as errors from "#/adapters/errors";
import type * as types from "#/adapters/types";
import * as domain from "#/domain";
import type * as viem from "viem";
import * as utils from "#/adapters/utils";
import { fetch } from "bun";

/**
 * @see https://blue-api.morpho.org/graphql
 */

export type UserSettings = {
    healthFactorThreshold: number;
};

export type State = {
    previousMarketIds: viem.Hex[];
    lastUpdateBlock: bigint;
};

export type Context = {
    loans: Loan[];
};

type Loan = {
    amountInUsd: bigint;
    healthFactor: number;
    marketid: viem.Hex;
};

export class Adapter implements types.IContractAdapter<UserSettings, State, Context> {
    private readonly USD_DUST_THRESHOLD: number = 0.001; // USD, adjust as needed

    private readonly MORPHO_GRAPHQL_ENDPOINT: string = 'https://blue-api.morpho.org/graphql';

    private readonly CHAIN_AVAILABLE: Partial<Record<domain.Chain, boolean>> = {
        [domain.Chain.Ethereum]: true,
    };

    public async checkUser(address: viem.Address, chainId: domain.Chain, _: viem.PublicClient): Promise<types.UserCheckResult<UserSettings>> {
        const available = this.CHAIN_AVAILABLE[chainId] ?? false;
        if (!available) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        const response = await fetch(
            this.MORPHO_GRAPHQL_ENDPOINT, 
            {
                method: 'POST', 
                body: JSON.stringify({ 
                    query: `
                        query getUserPositions {
                            userByAddress(chainId: ${chainId}, address: "${address}") {
                                marketPositions {
                                    market {
                                        uniqueKey
                                    }
                                }
                            }
                        }
                    ` 
                }) 
            }
        )

        const result = await response.json();

        if (!result.data) {
            return { active: false };
        }

        if (!result.data.userByAddress || result.data.userByAddress.marketPositions?.length === 0) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        return { active: true, userSettings: { healthFactorThreshold: 1.1 } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, publicClient: viem.PublicClient): Promise<types.MatchResult<State, Context>> {
        const available = this.CHAIN_AVAILABLE[trigger.chainId] ?? false;
        if (!available) {
            return { matched: false, error: new errors.NotSupportedChainError() };
        }

        const response = await fetch(
            this.MORPHO_GRAPHQL_ENDPOINT, 
            {
                method: 'POST', 
                body: JSON.stringify({ 
                    query: `
                        query getUserPositions{
                            userByAddress(
                                chainId: ${trigger.chainId}
                                address: "${trigger.address}"
                            ) {
                                marketPositions {
                                    id
                                    market {
                                        uniqueKey
                                    }
                                    borrowAssetsUsd
                                    healthFactor
                                }
                            }
                        }
                    ` 
                }) 
            }
        )

        const result = await response.json();

        if (!result.data) {
            return { matched: false };
        }

        if (!result.data.userByAddress || result.data.userByAddress.marketPositions?.length === 0) {
            return { matched: false, error: new errors.NotActiveUserError() };
        }

        // Get the user's active loans with enough amount
        const loans: Loan[] = [];
        for (const marketId of state.previousMarketIds) {
            const loan = await this.getUserMarketInfo(marketId, ca, irmAddress, trigger.address, publicClient);

            const isDustPosition = loan.borrowAssetsUserInUsd <= this.USD_DUST_THRESHOLD;
            if (isDustPosition) {
                continue;
            }

            loans.push({
                amountInUsd: loan.borrowAssetsUserInUsd,
                healthFactor: loan.healthFactor ?? 0n,
                marketid: marketId,
            });
        }

        // get the loans that have less than the health factor threshold
        const riskOfliquidatationLoans = loans.filter((loan) => {
            return loan.healthFactor < trigger.userSettings.healthFactorThreshold;
        });

        // if the user doesn't have at least one loan that will expire before the reminder delay
        if (riskOfliquidatationLoans.length === 0) {
            return { matched: false };
        }

        return { matched: true, dedupKey: this.makeDedupKey(riskOfliquidatationLoans), context: { loans: riskOfliquidatationLoans } };
    }

    public async mapIntoNotificationData(trigger: domain.Trigger<UserSettings, State>, context: Context): Promise<domain.NotificationData> {
        return {
            chainId: trigger.chainId,
            loans: context.loans,
            healthFactorThreshold: trigger.userSettings.healthFactorThreshold,
        };
    }

    private makeDedupKey(loans: Loan[]): string {
        const sorted = loans.sort((a, b) => a.marketid.localeCompare(b.marketid));
        const joined = sorted.map((loan) => loan.marketid.toString()).join("-");
        return utils.hash(joined);
    }
    

