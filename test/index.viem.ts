import * as viem from 'viem';
import * as viemChain from 'viem/chains';

/// -----------------------------------------------
/// -------------------- TYPES --------------------
/// -----------------------------------------------
type MarketParams = {
  loanToken: viem.Address;
  collateralToken: viem.Address;
  oracle: viem.Address;
  irm: viem.Address;
  lltv: bigint;
};

type MarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};
type PositionUser = {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
};

/// ---------------------------------------------------
/// -------------------- CONSTANTS --------------------
/// ---------------------------------------------------
// Main contract address for MorphoBlue. Update this value according to the deployed contract.
const INITIAL_BLOCK_NUMBER = 20691652n;
const MORPHO_ADDRESS: viem.Address = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
const IRM_ADDRESS: viem.Address = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC';

const MORPHO_ABI = viem.parseAbi([
  'function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
]);
const BLUE_ORACLE_ABI = viem.parseAbi(['function price() external view returns (uint256)']);
const BLUE_IRM_ABI = viem.parseAbi([
  'function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)',
]);

const ORACLE_PRICE_SCALE = 10n ** BigInt(36)
const WAD = BigInt(1e18)
const VIRTUAL_ASSETS = 1n;
const VIRTUAL_SHARES = BigInt(1e6);

/// -----------------------------------------------
/// -------------------- UTILS --------------------
/// -----------------------------------------------
const mulDivDown = (x: bigint, y: bigint, d: bigint): bigint => (x * y) / d;
const wMulDown = (x: bigint, y: bigint): bigint => mulDivDown(x, y, WAD);
const wDivDown = (x: bigint, y: bigint): bigint => mulDivDown(x, WAD, y);
const mulDivUp = (x: bigint, y: bigint, d: bigint): bigint => (x * y + (d - 1n)) / d;

const wTaylorCompounded = (x: bigint, n: bigint): bigint => {
  const firstTerm = x * n;
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
  return firstTerm + secondTerm + thirdTerm;
};

const toAssetsDown = (shares: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
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

function accrueInterests(lastBlockTimestamp: bigint, marketState: MarketState, borrowRate: bigint): MarketState {
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

/**
 * Fetches and calculates user position data for a given market.
 */
async function fetchData(id: viem.Hex, user: viem.Address, client: viem.PublicClient) {
  const block = await client.getBlock();

  const [marketParamsRes, marketStateRes, positionRes] = await client.multicall({
    contracts: [
      {
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: 'idToMarketParams',
        args: [id],
      },
      {
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: 'market',
        args: [id],
      },
      {
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: 'position',
        args: [id, user],
      },
    ],
  });

  if (marketParamsRes.error || marketStateRes.error || positionRes.error) {
    throw new Error('Error fetching data');
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
    address: IRM_ADDRESS,
    abi: BLUE_IRM_ABI,
    functionName: 'borrowRateView',
    args: [marketParams, marketState],
  });

  const marketStateUpdated = accrueInterests(BigInt(block.timestamp), marketState, borrowRate);

  const supplyAssetsUser = toAssetsDown(
    position.supplyShares,
    marketStateUpdated.totalSupplyAssets,
    marketStateUpdated.totalSupplyShares,
  );

  const borrowAssetsUser = toAssetsUp(
    position.borrowShares,
    marketStateUpdated.totalBorrowAssets,
    marketStateUpdated.totalBorrowShares,
  );

  const collateralAssetUser = position.collateral;

  const collateralPrice = await client.readContract({
    address: marketParams.oracle,
    abi: BLUE_ORACLE_ABI,
    functionName: 'price',
  });

  const maxBorrow = wMulDown(mulDivDown(position.collateral, collateralPrice, ORACLE_PRICE_SCALE), marketParams.lltv);

  const healthFactor = borrowAssetsUser === 0n ? undefined : wDivDown(maxBorrow, borrowAssetsUser);

  return {
    supplyAssetsUser,
    collateralAssetUser,
    borrowAssetsUser,
    healthFactor,
  };
}

/**
 * Get all marketIds that a user interacted with since a given block.
 * And filter the ones that are still active.
 */
async function getUserActiveMarketIds(client: viem.PublicClient, user: viem.Address, previousMarketIds: viem.Hex[] = [], lastUpdateBlock: bigint = INITIAL_BLOCK_NUMBER): Promise<viem.Hex[]> {
    // Get all borrow events for the user since the previous update
    const borrowEvents = await client.getLogs({
        address: MORPHO_ADDRESS,
        event: viem.parseAbiItem(
        'event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)',
        ),
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
    const positions = await client.multicall({contracts: marketIds.map((marketId) => ({
        address: MORPHO_ADDRESS,
        abi: MORPHO_ABI,
        functionName: 'position',
        args: [marketId, user],
    }))});

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


/// ----------------------------------------------
/// -------------------- MAIN --------------------
/// ----------------------------------------------

async function run() {
  const client = viem.createPublicClient({
    transport: viem.http('https://mainnet.infura.io/v3/615fa5dcf6ed49f3b2a34f4246f0bc92'),
    batch: { multicall: true },
    chain: viemChain.mainnet,
  });

  const user = '0xF76702af4EfCEDeB64DbB4A59093ec8e124fcE13'; // edouard0x.eth
  
  const marketIds = await getUserActiveMarketIds(client, user);
  await Promise.allSettled(
    marketIds.map(async (market) => {
      try {
        const { supplyAssetsUser, collateralAssetUser, borrowAssetsUser, healthFactor } = await fetchData(
          market,
          user,
          client,
        );
        console.log('MarketId:', market);
        console.log('Supply Assets User:   ', supplyAssetsUser);
        console.log('Collateral Asset User:', collateralAssetUser);
        console.log('Borrow Assets User:   ', borrowAssetsUser);
        console.log('Health Factor:        ', healthFactor ? viem.formatUnits(healthFactor, 18) : '-');
      } catch (error) {
        console.error(`Error fetching data for marketId: ${market}`, error);
        return null;
      }
    }),
  );
}

run().then(() => process.exit(0));
