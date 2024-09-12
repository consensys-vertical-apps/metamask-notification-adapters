import * as errors from "#/adapters/errors";
import type * as types from "#/adapters/types";
import * as domain from "#/domain";
import * as viem from "viem";
import * as utils from "#/adapters/utils";
import type { MarketParams, MarketState, PositionUser } from "./morpho.types";
import { accrueInterests, mulDivDown, ORACLE_PRICE_SCALE, toAssetsUp, wDivDown, wMulDown } from "./morpho.utils";

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
    private readonly SECONDS_IN_THREE_MONTHS: bigint = BigInt(3 * 30 * 24 * 60 * 60);
    private readonly MAX_BLOCK_IN_PAST_BY_CHAIN: Partial<Record<domain.Chain, bigint>> = {
        [domain.Chain.Ethereum]: this.SECONDS_IN_THREE_MONTHS / 12n,
    };
    private readonly USD_DUST_THRESHOLD: number = 0.001; // USD, adjust as needed
    private readonly MORPHO_ADDRESSES: Partial<Record<domain.Chain, viem.Address>> = {
        [domain.Chain.Ethereum]: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    };
    private readonly IRM_ADDRESS: Partial<Record<domain.Chain, viem.Address>> = {
        [domain.Chain.Ethereum]: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    };

    private readonly MORPHO_ABI = viem.parseAbi([
        "function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
        "function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
        "function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
    ]);
    private readonly BLUE_ORACLE_ABI = viem.parseAbi(["function price() external view returns (uint256)"]);
    private readonly BLUE_IRM_ABI = viem.parseAbi([
        "function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)",
    ]);

    public async checkUser(address: viem.Address, chainId: domain.Chain, publicClient: viem.PublicClient): Promise<types.UserCheckResult<UserSettings>> {
        const ca = this.MORPHO_ADDRESSES[chainId];
        if (!ca) {
            return { active: false, error: new errors.NotSupportedChainError() };
        }

        const currentBlockNumber = await publicClient.getBlockNumber();
        const updateBlock = currentBlockNumber - (this.MAX_BLOCK_IN_PAST_BY_CHAIN[chainId] ?? 0n);

        const markets = await this.getUserActiveMarketIds(publicClient, ca, address, [], updateBlock);

        if (markets.length === 0) {
            return { active: false, error: new errors.NotActiveUserError() };
        }

        return { active: true, userSettings: { healthFactorThreshold: 1.1 } };
    }

    public async matchTrigger(trigger: domain.Trigger<UserSettings, State>, publicClient: viem.PublicClient): Promise<types.MatchResult<State, Context>> {
        const ca = this.MORPHO_ADDRESSES[trigger.chainId];
        const irmAddress = this.IRM_ADDRESS[trigger.chainId];
        if (!ca || !irmAddress) {
            return { matched: false, error: new errors.NotSupportedChainError() };
        }

        let state = trigger.state;
        if (state === undefined) {
            const currentBlockNumber = await publicClient.getBlockNumber();
            const updateBlock = currentBlockNumber - (this.MAX_BLOCK_IN_PAST_BY_CHAIN[trigger.chainId] ?? 0n);
            state = {
                previousMarketIds: [],
                lastUpdateBlock: updateBlock,
            };
        }

        state.previousMarketIds = await this.getUserActiveMarketIds(publicClient, ca, trigger.address, state.previousMarketIds, state.lastUpdateBlock);

        // check if the user is active
        if (state.previousMarketIds.length === 0) {
            return { matched: false, error: new errors.NotActiveUserError(), state: state };
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

    /**
     * Get all marketIds that a user interacted with since a given block.
     * And filter the ones that are still active.
     */
    private async getUserActiveMarketIds(
        client: viem.PublicClient,
        morphoAddress: viem.Address,
        user: viem.Address,
        previousMarketIds: viem.Hex[],
        lastUpdateBlock: bigint,
    ): Promise<viem.Hex[]> {
        // Get all borrow events for the user since the previous update
        const borrowEvents = await client.getLogs({
            address: morphoAddress,
            event: viem.parseAbiItem("event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)"),
            args: {
                receiver: user,
            },
            fromBlock: lastUpdateBlock,
        });

        // Extract the marketIds from the events
        const newMarketIds = borrowEvents.map((event) => event.args.id).filter((id): id is viem.Hex => !!id);

        // Merge the old and new marketIds
        const marketIds = [...previousMarketIds, ...newMarketIds];

        // Get all positions for the user in those markets
        const positions = await client.multicall({
            contracts: marketIds.map((marketId) => ({
                address: morphoAddress,
                abi: this.MORPHO_ABI,
                functionName: "position",
                args: [marketId, user],
            })),
        });

        // Filter the marketIds where the user has still a borrow share
        const stillActiveMarketIds: viem.Hex[] = [];
        for (let i = 0; i < marketIds.length; i++) {
            const marketId = marketIds[i];
            const borrowShare = positions[i]?.result?.[1] ?? 0n;

            if (borrowShare > 0n) {
                stillActiveMarketIds.push(marketId);
            }
        }

        return stillActiveMarketIds;
    }

    /**
     * Fetches and calculates user position data for a given market.
     * 
     * @See https://docs.morpho.org/morpho/tutorials/track-positions
     */
    private async getUserMarketInfo(id: viem.Hex, morphoAddress: viem.Address, irmAddress: viem.Address, user: viem.Address, client: viem.PublicClient) {
        const block = await client.getBlock();

        const [marketParamsRes, marketStateRes, positionRes] = await client.multicall({
            contracts: [
                {
                    address: morphoAddress,
                    abi: this.MORPHO_ABI,
                    functionName: "idToMarketParams",
                    args: [id],
                },
                {
                    address: morphoAddress,
                    abi: this.MORPHO_ABI,
                    functionName: "market",
                    args: [id],
                },
                {
                    address: morphoAddress,
                    abi: this.MORPHO_ABI,
                    functionName: "position",
                    args: [id, user],
                },
            ],
        });

        if (marketParamsRes.error || marketStateRes.error || positionRes.error) {
            throw new Error("Error fetching data");
        }

        const marketParams: MarketParams = {
            loanToken: marketParamsRes.result[0],
            collateralToken: marketParamsRes.result[1],
            oracle: marketParamsRes.result[2],
            irm: marketParamsRes.result[3],
            lltv: marketParamsRes.result[4],
        };

        const marketState: MarketState = {
            totalSupplyAssets: marketStateRes.result[0],
            totalSupplyShares: marketStateRes.result[1],
            totalBorrowAssets: marketStateRes.result[2],
            totalBorrowShares: marketStateRes.result[3],
            lastUpdate: marketStateRes.result[4],
            fee: marketStateRes.result[5],
        };

        const position: PositionUser = {
            supplyShares: positionRes.result[0],
            borrowShares: positionRes.result[1],
            collateral: positionRes.result[2],
        };

        const borrowRate = await client.readContract({
            address: irmAddress,
            abi: this.BLUE_IRM_ABI,
            functionName: "borrowRateView",
            args: [marketParams, marketState],
        });

        const marketStateUpdated = accrueInterests(BigInt(block.timestamp), marketState, borrowRate);

        const borrowAssetsUser = toAssetsUp(position.borrowShares, marketStateUpdated.totalBorrowAssets, marketStateUpdated.totalBorrowShares);

        const collateralPrice = await client.readContract({
            address: marketParams.oracle,
            abi: this.BLUE_ORACLE_ABI,
            functionName: "price",
        });

        const maxBorrow = wMulDown(mulDivDown(position.collateral, collateralPrice, ORACLE_PRICE_SCALE), marketParams.lltv);

        const healthFactor = Number(borrowAssetsUser === 0n ? undefined : wDivDown(maxBorrow, borrowAssetsUser));

        return {
            borrowAssetsUserInUsd: borrowAssetsUser / BigInt(1e6),
            healthFactor,
        };
    }
}
