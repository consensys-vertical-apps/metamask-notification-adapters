import * as viem from "viem";
import * as viemchains from "viem/chains";
import validate from "zod";
import * as domain from "#/domain";

const schema = validate.object({
    RPC_URLS: validate.preprocess((v) => JSON.parse(v as string), validate.record(validate.nativeEnum(domain.Chain), validate.string().url())),
});

const vars = schema.parse(process.env);

const RPC_CONFIG: Partial<Record<domain.Chain, { chain: viem.Chain; url: string }>> = {
    [domain.Chain.Ethereum]: {
        chain: viemchains.mainnet,
        url: vars.RPC_URLS[domain.Chain.Ethereum] || viemchains.mainnet.rpcUrls.default.http[0],
    },
    [domain.Chain.Optimism]: {
        chain: viemchains.optimism,
        url: vars.RPC_URLS[domain.Chain.Optimism] || viemchains.optimism.rpcUrls.default.http[0],
    },
    [domain.Chain.BNB]: {
        chain: viemchains.bsc,
        url: vars.RPC_URLS[domain.Chain.BNB] || viemchains.bsc.rpcUrls.default.http[0],
    },
    [domain.Chain.Polygon]: {
        chain: viemchains.polygon,
        url: vars.RPC_URLS[domain.Chain.Polygon] || viemchains.polygon.rpcUrls.default.http[0],
    },
    [domain.Chain.Arbitrum]: {
        chain: viemchains.arbitrum,
        url: vars.RPC_URLS[domain.Chain.Arbitrum] || viemchains.arbitrum.rpcUrls.default.http[0],
    },
    [domain.Chain.Avalanche]: {
        chain: viemchains.avalanche,
        url: vars.RPC_URLS[domain.Chain.Avalanche] || viemchains.avalanche.rpcUrls.default.http[0],
    },
    [domain.Chain.Linea]: {
        chain: viemchains.linea,
        url: vars.RPC_URLS[domain.Chain.Linea] || viemchains.linea.rpcUrls.default.http[0],
    },
};

export function createRPCClient(chain: domain.Chain = domain.Chain.Ethereum): viem.PublicClient {
    const args = RPC_CONFIG[chain];
    if (!args) {
        throw new Error(`Unsupported chain: ${chain}`);
    }

    return viem.createPublicClient({ chain: args.chain, transport: viem.http(args.url) });
}
