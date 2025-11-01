import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
    generateSigner,
    createSignerFromKeypair,
    signerIdentity,
    sol,
} from "@metaplex-foundation/umi";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { loadConfig, makeSignersFromSavedWallets } from "./utils.js";
import bs58 from "bs58";

const init = () => {
    const config = loadConfig();
    const RPC_ENDPOINT = config.localnet.RPC_ENDPOINT;
    return createUmi(RPC_ENDPOINT);
};

// Function to generate collection and collection update authority signers
const generateSignersAndSaveToWallets = () => {
    const signer = generateSigner(umi);
    const signerPvtKey = bs58.encode(signer.secretKey);

    const collection = generateSigner(umi);
    const collectionPvtKey = bs58.encode(collection.secretKey);

    const collectionUpdateAuthority = generateSigner(umi);
    const collectionUpdateAuthorityPvtKey = bs58.encode(
        collectionUpdateAuthority.secretKey,
    );

    const creator1 = generateSigner(umi);
    const creator1PvtKey = bs58.encode(creator1.secretKey);

    const creator2 = generateSigner(umi);
    const creator2PvtKey = bs58.encode(creator2.secretKey);

    // Save the secret keys to files or secure storage
    // writeFileSync(
    //     "wallets/collection.json",
    //     JSON.stringify(collection.secretKey),
    // );
    // writeFileSync(
    //     "wallets/collectionUpdateAuthority.json",
    //     JSON.stringify(collectionUpdateAuthority.secretKey),
    // );

    // Create folder if it doesn't exist
    if (!existsSync("wallets")) {
        mkdirSync("wallets", { recursive: true });
    }

    writeFileSync("wallets/signer.txt", signerPvtKey);
    writeFileSync("wallets/collection.txt", collectionPvtKey);
    writeFileSync(
        "wallets/collectionUpdateAuthority.txt",
        collectionUpdateAuthorityPvtKey,
    );
    writeFileSync("wallets/creator1.txt", creator1PvtKey);
    writeFileSync("wallets/creator2.txt", creator2PvtKey);

    console.log("signer Public Key:", signer.publicKey.toString());
    console.log("Collection Public Key:", collection.publicKey.toString());
    console.log(
        "Collection Update Authority Public Key:",
        collectionUpdateAuthority.publicKey.toString(),
    );
    console.log(
        "Collection creator1 Public Key:",
        creator1.publicKey.toString(),
    );
    console.log(
        "Collection creator2 Public Key:",
        creator2.publicKey.toString(),
    );
};

const start = async () => {
    try {
        // Only proceed with making signers if wallet files exist
        const walletsExist =
            existsSync("wallets/signer.txt") &&
            existsSync("wallets/collection.txt") &&
            existsSync("wallets/collectionUpdateAuthority.txt") &&
            existsSync("wallets/creator1.txt") &&
            existsSync("wallets/creator2.txt");

        if (!walletsExist) {
            console.log("Generating new wallets...");
            // generateSignersAndSaveToWallets();
        }

        console.log("Loading saved wallets...");
        makeSignersFromSavedWallets();
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

const umi = init();
start();
