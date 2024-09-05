import * as viem from "viem";
import * as viemChains from "viem/chains";
import * as domain from "#/domain";

// TODO: use the correct network
export function createRPCClient(_network: domain.Chain = domain.Chain.Ethereum): viem.PublicClient {
    return viem.createPublicClient({
        chain: viemChains.mainnet,
        transport: viem.http(viemChains.mainnet.rpcUrls.default.http[0]),
    });
}
