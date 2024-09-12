import type * as viem from "viem";

export enum Kind {
    // Actual kinds
    AaveV3HealthFactor = "aave_v3_health_factor",
    EnsExpiration = "ens_expiration",
    LidoStakingRewards = "lido_staking_rewards",
    RocketpoolStakingRewards = "rocketpool_staking_rewards",
    NotionalLoanExpiration = "notional_loan_expiration",
    SparkFiHealthFactor = "spark_fi_health_factor",
    MorphoAave3EthHealthFactor = "morpho_aave3_eth_health_factor",
    MorphoAave2HealthFactor = "morpho_aave2_health_factor",
    MorphoCompoundHealthFactor = "morpho_compound_health_factor",
    MorphoHealthFactor = "morpho_health_factor",

    // Test kinds
    TestIsMatching = "test_is_matching",
    TestIsNotMatching = "test_is_not_matching",
    TestIsActiveUser = "test_is_active_user",
    TestIsNotActiveUser = "test_is_not_active_user",
    TestIsNotSupportedChain = "test_is_not_supported_chain",
    TestIsRandomlyMatching = "test_is_randomly_matching",
    TestNetworked = "test_networked",
    TestUsesTriggerState = "test_uses_trigger_state",
    TestUsesMatchDedupKey = "test_uses_match_dedup_key",
    TestScale1 = "test_scale_1",
    TestScale2 = "test_scale_2",
    TestScale3 = "test_scale_3",
    TestScale4 = "test_scale_4",
    TestScale5 = "test_scale_5",
    TestScale6 = "test_scale_6",
    TestScale7 = "test_scale_7",
    TestScale8 = "test_scale_8",
    TestScale9 = "test_scale_9",
    TestScale10 = "test_scale_10",
}

export enum Chain {
    None = "0",
    Ethereum = "1",
    Optimism = "10",
    BNB = "56",
    Polygon = "137",
    Arbitrum = "42161",
    Avalanche = "43114",
    Linea = "59144",
}

export type Trigger<U = Record<string, unknown> | null, S = Record<string, unknown> | null> = {
    id: string;
    chainId: Chain;
    kind: Kind;
    address: viem.Address;
    userSettings: U;
    state: S;
    matchDedupKey: string | null;
    scheduledAt: Date;
};

export type Notification = {
    id: string;
    trigger_id: string;
    unread: true;
    address: string;
    chain_id: number;
    data: NotificationData;
    created_at: Date;
};

export type NotificationData = Record<string, unknown>;
