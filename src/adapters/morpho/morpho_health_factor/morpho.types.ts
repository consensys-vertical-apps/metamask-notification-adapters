import type * as viem from "viem";

export type MarketParams = {
    loanToken: viem.Address;
    collateralToken: viem.Address;
    oracle: viem.Address;
    irm: viem.Address;
    lltv: bigint;
};

export type MarketState = {
    totalSupplyAssets: bigint;
    totalSupplyShares: bigint;
    totalBorrowAssets: bigint;
    totalBorrowShares: bigint;
    lastUpdate: bigint;
    fee: bigint;
};

export type PositionUser = {
    supplyShares: bigint;
    borrowShares: bigint;
    collateral: bigint;
};