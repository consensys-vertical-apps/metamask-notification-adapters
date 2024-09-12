import { formatUnits, isAddress, type Provider, ZeroAddress, getDefaultProvider } from 'ethers';
import { type MorphoBlue, MorphoBlue__factory, BlueOracle__factory, BlueIrm__factory } from 'ethers-types';

/// -----------------------------------------------
/// -------------------- TYPES --------------------
/// -----------------------------------------------

type MarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

type MarketParams = {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
};
type PositionUser = {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
};

interface Contracts {
  morphoBlue: MorphoBlue;
}

/// ---------------------------------------------------
/// -------------------- CONSTANTS --------------------
/// ---------------------------------------------------

// User address to track. This should be replaced with the target address you're interested in.
const user = '0xF76702af4EfCEDeB64DbB4A59093ec8e124fcE13';

// Market IDs to monitor. These should be updated based on the markets you wish to track.
const wstETHUSDC = '0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc';

const whitelistedIds = [wstETHUSDC];

// Main contract address for MorphoBlue. Update this value according to the deployed contract.
const MORPHO_ADDRESS = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

const IRM_ADDRESS = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC';
const pow10 = (exponant: bigint | number) => 10n ** BigInt(exponant);
const ORACLE_PRICE_SCALE = pow10(36);
const WAD = pow10(18);
const VIRTUAL_ASSETS = 1n;
const VIRTUAL_SHARES = 10n ** 6n;
const MAX_UINT256 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');

/// -----------------------------------------------
/// -------------------- UTILS --------------------
/// -----------------------------------------------

const wMulDown = (x: bigint, y: bigint): bigint => mulDivDown(x, y, WAD);
const wDivDown = (x: bigint, y: bigint): bigint => mulDivDown(x, WAD, y);
const mulDivDown = (x: bigint, y: bigint, d: bigint): bigint => (x * y) / d;
const mulDivUp = (x: bigint, y: bigint, d: bigint): bigint => (x * y + (d - 1n)) / d;

const wTaylorCompounded = (x: bigint, n: bigint): bigint => {
  const firstTerm = x * n;
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
  return firstTerm + secondTerm + thirdTerm;
};

export const toAssetsDown = (shares: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
  return mulDivDown(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
};

/// @dev Calculates the value of `shares` quoted in assets, rounding down.
const toSharesDown = (assets: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
  return mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
};

/// @dev Calculates the value of `shares` quoted in assets, rounding up.
const toAssetsUp = (shares: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
  return mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
};

/// ---------------------------------------------------
/// -------------------- FUNCTIONS --------------------
/// ---------------------------------------------------

const accrueInterests = (lastBlockTimestamp: bigint, marketState: MarketState, borrowRate: bigint) => {
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
  const feeShares = toSharesDown(
    feeAmount,
    marketWithNewTotal.totalSupplyAssets - feeAmount,
    marketWithNewTotal.totalSupplyShares,
  );

  // Return final market state including feeShares
  return {
    ...marketWithNewTotal,
    totalSupplyShares: marketWithNewTotal.totalSupplyShares + feeShares,
  };
};

const morphoContracts = async (provider: Provider) => {
  if (!isAddress(MORPHO_ADDRESS)) throw new Error('MORPHO_ADDRESS unset');
  const morphoBlue = MorphoBlue__factory.connect(MORPHO_ADDRESS, provider);
  return { morphoBlue };
};

/**
 * Fetches and calculates user position data for a given market.
 * @param {Contracts} contracts - The initialized contract instances.
 * @param {string} id - The market ID to fetch data for.
 * @param {string} user - The user address to fetch position for.
 * @param {Provider} [provider] - The ethers provider.
 * Returns total supply assets, total borrow assets, user's supply assets, user's collateral assets, user's borrow assets, health factor, health status, supply APY and borrow APY.
 */
const fetchData = async ({ morphoBlue }: Contracts, id: string, user: string, provider: Provider) => {
  const block = await provider.getBlock('latest');

  if (!block) throw new Error('Failed to fetch block');

  const [marketParams_, marketState_, position_] = await Promise.all([
    morphoBlue.idToMarketParams(id),
    morphoBlue.market(id),
    morphoBlue.position(id, user),
  ]);

  const marketParams: MarketParams = {
    loanToken: marketParams_.loanToken,
    collateralToken: marketParams_.collateralToken,
    oracle: marketParams_.oracle,
    irm: marketParams_.irm,
    lltv: marketParams_.lltv,
  };

  let marketState: MarketState = {
    totalSupplyAssets: marketState_.totalSupplyAssets,
    totalSupplyShares: marketState_.totalSupplyShares,
    totalBorrowAssets: marketState_.totalBorrowAssets,
    totalBorrowShares: marketState_.totalBorrowShares,
    lastUpdate: marketState_.lastUpdate,
    fee: marketState_.fee,
  };

  const position: PositionUser = {
    supplyShares: position_.supplyShares,
    borrowShares: position_.borrowShares,
    collateral: position_.collateral,
  };

  const irm = BlueIrm__factory.connect(IRM_ADDRESS, provider);
  const borrowRate = IRM_ADDRESS !== ZeroAddress ? await irm.borrowRateView(marketParams, marketState) : 0n;

  marketState = accrueInterests(BigInt(block.timestamp), marketState, borrowRate);

  const borrowAssetsUser = toAssetsUp(
    position.borrowShares,
    marketState.totalBorrowAssets,
    marketState.totalBorrowShares,
  );

  const supplyAssetsUser = toAssetsDown(
    position.supplyShares,
    marketState.totalSupplyAssets,
    marketState.totalSupplyShares,
  );

  const collateralAssetUser = position.collateral;

  const oracle = BlueOracle__factory.connect(marketParams_.oracle, provider);

  const collateralPrice = await oracle.price();

  const maxBorrow = wMulDown(mulDivDown(position.collateral, collateralPrice, ORACLE_PRICE_SCALE), marketParams_.lltv);

  const healthFactor = borrowAssetsUser === 0n ? MAX_UINT256 : wDivDown(maxBorrow, borrowAssetsUser);

  return {
    supplyAssetsUser,
    collateralAssetUser,
    borrowAssetsUser,
    healthFactor,
  };
};

/// ----------------------------------------------
/// -------------------- MAIN --------------------
/// ----------------------------------------------

const run = async () => {
  const provider = getDefaultProvider('https://mainnet.infura.io/v3/615fa5dcf6ed49f3b2a34f4246f0bc92');
  const contracts = await morphoContracts(provider);

  await Promise.allSettled(
    whitelistedIds.map(async (market) => {
      try {
        const { supplyAssetsUser, collateralAssetUser, borrowAssetsUser, healthFactor } = await fetchData(
          contracts,
          market,
          user,
          provider,
        );
        console.log('MarketId:', market);
        console.log('Supply Assets User:   ', supplyAssetsUser);
        console.log('Collateral Asset User:', collateralAssetUser);
        console.log('Borrow Assets User:   ', borrowAssetsUser);
        console.log('Health Factor:        ', formatUnits(healthFactor.toString()));
      } catch (error) {
        console.error(`Error fetching data for marketId: ${market}`, error);
        return null;
      }
    }),
  );
};

run().then(() => process.exit(0));
