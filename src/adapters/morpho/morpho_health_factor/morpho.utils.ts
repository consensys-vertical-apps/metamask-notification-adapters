/**
 * @See https://docs.morpho.org/morpho/tutorials/track-positions
 */
import type { MarketState } from "./morpho.types";

export const ORACLE_PRICE_SCALE = 10n ** BigInt(36);
export const WAD = BigInt(1e18);
export const VIRTUAL_ASSETS = 1n;
export const VIRTUAL_SHARES = BigInt(1e6);

export function  accrueInterests(lastBlockTimestamp: bigint, marketState: MarketState, borrowRate: bigint): MarketState {
    const elapsed = lastBlockTimestamp - marketState.lastUpdate;

    // Early return if no time has elapsed since the last update
    if (elapsed === 0n || marketState.totalBorrowAssets === 0n) {
        return marketState;
    }

    // Calculate interest
    const interest = wMulDown(marketState.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed));

    // Prepare updated market state with new totals
    const marketWithNewTotal = {
        ...marketState,
        totalBorrowAssets: marketState.totalBorrowAssets + interest,
        totalSupplyAssets: marketState.totalSupplyAssets + interest,
    };

    // Early return if there's no fee
    if (marketWithNewTotal.fee === 0n) {
        return marketWithNewTotal;
    }

    // Calculate fee and feeShares if the fee is not zero
    const feeAmount = wMulDown(interest, marketWithNewTotal.fee);
    const feeShares = toSharesDown(feeAmount, marketWithNewTotal.totalSupplyAssets - feeAmount, marketWithNewTotal.totalSupplyShares);

    // Return final market state including feeShares
    return {
        ...marketWithNewTotal,
        totalSupplyShares: marketWithNewTotal.totalSupplyShares + feeShares,
    };
}

export function mulDivDown(x: bigint, y: bigint, d: bigint): bigint {
    return (x * y) / d;
}

export function wMulDown(x: bigint, y: bigint): bigint {
    return mulDivDown(x, y, WAD);
}

export function wDivDown(x: bigint, y: bigint): bigint {
    return mulDivDown(x, WAD, y);
}

export function mulDivUp(x: bigint, y: bigint, d: bigint): bigint {
    return (x * y + (d - 1n)) / d;
}

export function wTaylorCompounded(x: bigint, n: bigint): bigint {
    const firstTerm = x * n;
    const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
    const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
    return firstTerm + secondTerm + thirdTerm;
}

export function toSharesDown(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
    return mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
}

export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
    return mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
}