import * as viem from "viem";
import * as viemChains from "viem/chains";

export function createRPCClient() {
    return viem.createPublicClient({
        chain: viemChains.mainnet,
        transport: viem.http(viemChains.mainnet.rpcUrls.default.http[0]),
    });
}
