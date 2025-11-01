import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair } from "@metaplex-foundation/umi";
import fs from "fs";
import bs58 from "bs58";
import { join, basename, extname, resolve } from "path";

// Load configuration and pipeline steps
export const loadConfig = () => {
    try {
        const configPath = resolve("config.json");
        if (!fs.existsSync(configPath)) {
            throw new Error("config.json not found");
        }
        const configData = fs.readFileSync(configPath, "utf8");
        return JSON.parse(configData);
    } catch (error) {
        console.error("❌ Error loading config:", error.message);
        process.exit(1);
    }
};

// Create UMI instance with config
const createUmiInstance = () => {
    const config = loadConfig();
    return createUmi(config.localnet.RPC_ENDPOINT);
};

export const makeSignersFromSavedWallets = () => {
    try {
        const umi = createUmiInstance();

        // Read wallet files
        const signerSecretKey = fs
            .readFileSync("wallets/signer.txt", "utf-8")
            .trim();
        const collectionSecretKey = fs
            .readFileSync("wallets/collection.txt", "utf-8")
            .trim();
        const collectionUpdateAuthoritySecretKey = fs
            .readFileSync("wallets/collectionUpdateAuthority.txt", "utf-8")
            .trim();
        const creator1 = fs
            .readFileSync("wallets/creator1.txt", "utf-8")
            .trim();
        const creator2 = fs
            .readFileSync("wallets/creator2.txt", "utf-8")
            .trim();

        // Create keypairs
        const signerKeyPair = umi.eddsa.createKeypairFromSecretKey(
            new Uint8Array(bs58.decode(signerSecretKey)),
        );
        const collectionKeyPair = umi.eddsa.createKeypairFromSecretKey(
            new Uint8Array(bs58.decode(collectionSecretKey)),
        );
        const collectionUpdateAuthorityKeyPair =
            umi.eddsa.createKeypairFromSecretKey(
                new Uint8Array(bs58.decode(collectionUpdateAuthoritySecretKey)),
            );
        const creator1KeyPair = umi.eddsa.createKeypairFromSecretKey(
            new Uint8Array(bs58.decode(creator1)),
        );
        const creator2KeyPair = umi.eddsa.createKeypairFromSecretKey(
            new Uint8Array(bs58.decode(creator2)),
        );

        // Create signers
        const signerSigner = createSignerFromKeypair(umi, signerKeyPair);
        const collectionSigner = createSignerFromKeypair(
            umi,
            collectionKeyPair,
        );
        const collectionUpdateAuthoritySigner = createSignerFromKeypair(
            umi,
            collectionUpdateAuthorityKeyPair,
        );
        const creator1Signer = createSignerFromKeypair(umi, creator1KeyPair);
        const creator2Signer = createSignerFromKeypair(umi, creator2KeyPair);

        console.log(
            "Loaded Signer Public Key:",
            signerSigner.publicKey.toString(),
        );
        console.log(
            "Loaded Collection Public Key:",
            collectionSigner.publicKey.toString(),
        );
        console.log(
            "Loaded Collection Update Authority Public Key:",
            collectionUpdateAuthoritySigner.publicKey.toString(),
        );
        console.log(
            "Loaded creator1 Public Key:",
            creator1Signer.publicKey.toString(),
        );
        console.log(
            "Loaded creator2 Public Key:",
            creator2Signer.publicKey.toString(),
        );

        return {
            signer: signerSigner,
            collection: collectionSigner,
            collectionUpdateAuthority: collectionUpdateAuthoritySigner,
            creator1: creator1Signer,
            creator2: creator2Signer,
        };
    } catch (error) {
        console.error("Error loading wallets:", error);
        throw error;
    }
};
