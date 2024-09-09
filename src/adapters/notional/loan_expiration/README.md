# Notional Loan Expiration Adapter 

Adapter to notify the user when at least one of its Notional loans is going to expire.


## Matched Loans

Criteria to match a loan:
- The asset type should be `fCash` ([FCASH_ASSET_TYPE](https://github.com/notional-finance/contracts-v2/blob/c35bfe005e7b684fc8f383144be757a47e39f7a6/contracts/global/Constants.sol#L95))
- The amount should be negative (borrowed)
- The absolute amount should be greater than dust threshold

## Configuration
See Notional value precision [here](https://docs.notional.finance/v3-technical-docs/currency-ids-and-precision/notional-internal-precision)