import * as aave_v3_health_factor from "#/adapters/aave/v3_health_factor";
import * as ens_expiration from "#/adapters/ens/expiration";
import * as lido_staking_rewards from "#/adapters/lido/staking_rewards";
import * as notional_loan_expiration from "#/adapters/notional/loan_expiration";
import * as rocketpool_staking_rewards from "#/adapters/rocketpool/staking_rewards";
import * as spark_fi_health_factor from "#/adapters/spark_fi/health_factor";
import * as test_is_active_user from "#/adapters/test/is_active_user";
import * as test_is_matching from "#/adapters/test/is_matching";
import * as test_is_not_active_user from "#/adapters/test/is_not_active_user";
import * as test_is_not_matching from "#/adapters/test/is_not_matching";
import * as test_is_not_supported_chain from "#/adapters/test/is_not_supported_chain";
import * as test_uses_match_dedup_key from "#/adapters/test/uses_match_dedup_key";
import * as test_uses_trigger_state from "#/adapters/test/uses_trigger_state";
import type * as types from "#/adapters/types";
import * as morpho_aave3_eth_health_factor from "#/adapters/morpho/aave3_eth_health_factor";
import * as morpho_aave2_health_factor from "#/adapters/morpho/aave2_health_factor";
import * as morpho_compound_health_factor from "#/adapters/morpho/compound_health_factor";
import * as morpho_health_factor from "#/adapters/morpho/morpho_health_factor";
import * as domain from "#/domain";

export const CONTRACT_ADAPTERS: types.ContractAdapters = {
    // Actual adapters
    [domain.Kind.AaveV3HealthFactor]: new aave_v3_health_factor.Adapter(),
    [domain.Kind.EnsExpiration]: new ens_expiration.Adapter(),
    [domain.Kind.LidoStakingRewards]: new lido_staking_rewards.Adapter(),
    [domain.Kind.NotionalLoanExpiration]: new notional_loan_expiration.Adapter(),
    [domain.Kind.RocketpoolStakingRewards]: new rocketpool_staking_rewards.Adapter(),
    [domain.Kind.SparkFiHealthFactor]: new spark_fi_health_factor.Adapter(),

    // Test adapters
    [domain.Kind.TestIsMatching]: new test_is_matching.Adapter(),
    [domain.Kind.TestIsNotMatching]: new test_is_not_matching.Adapter(),
    [domain.Kind.TestIsActiveUser]: new test_is_active_user.Adapter(),
    [domain.Kind.TestIsNotActiveUser]: new test_is_not_active_user.Adapter(),
    [domain.Kind.TestIsNotSupportedChain]: new test_is_not_supported_chain.Adapter(),
    [domain.Kind.TestUsesMatchDedupKey]: new test_uses_match_dedup_key.Adapter(),
    [domain.Kind.TestUsesTriggerState]: new test_uses_trigger_state.Adapter(),
    [domain.Kind.MorphoAave3EthHealthFactor]: new morpho_aave3_eth_health_factor.Adapter(),
    [domain.Kind.MorphoAave2HealthFactor]: new morpho_aave2_health_factor.Adapter(),
    [domain.Kind.MorphoCompoundHealthFactor]: new morpho_compound_health_factor.Adapter(),
    [domain.Kind.MorphoHealthFactor]: new morpho_health_factor.Adapter(),
};
