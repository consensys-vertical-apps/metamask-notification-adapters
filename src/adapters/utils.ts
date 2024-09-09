export function hash(data: Bun.BlobOrStringOrBuffer): string {
    const hasher = new Bun.CryptoHasher("md5");
    return hasher.update(data).digest("hex");
}
