import {
    createV1,
    mplCore,
    fetchAssetV1,
    transferV1,
    createCollectionV1,
    getAssetV1GpaBuilder,
    Key,
    updateAuthority,
    pluginAuthorityPair,
    ruleSet,
} from "@metaplex-foundation/mpl-core";
import {
    signerIdentity,
    createSignerFromKeypair,
    sol,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { loadConfig, makeSignersFromSavedWallets } from "./utils.js";

const init = () => {
    const config = loadConfig();
    const RPC_ENDPOINT = config.mainnet.RPC_ENDPOINT;
    return createUmi(RPC_ENDPOINT).use(mplCore());
};

const txConfig = {
    send: { skipPreflight: true },
    confirm: { commitment: "confirmed" },
};

// Create NFT Collection. Will be done only ONCE
const createCollection = async () => {
    // Generate all required signers from saved wallets
    const {
        signer,
        collection,
        collectionUpdateAuthority,
        creator1,
        creator2,
    } = makeSignersFromSavedWallets();

    console.log("Using Wallet:", signer.publicKey.toString());
    umi.use(signerIdentity(signer));

    const metadata = {
        name: "Ready Cards",
        uri: "https://devnet.irys.xyz/HiwqHK3eW1PGUtWQ3fEWbmGHfpxvpd2EFTLmCuHWYSUg",
        collection: collection,
        updateAuthority: collectionUpdateAuthority,
    };

    console.log("Creating Collection...");
    const tx = await createCollectionV1(umi, {
        name: metadata.name,
        uri: metadata.uri,
        collection: metadata.collection,
        updateAuthority: metadata.updateAuthority.publicKey,
        plugins: [
            pluginAuthorityPair({
                type: "Royalties",
                data: {
                    basisPoints: 500,
                    creators: [
                        {
                            address: creator1.publicKey,
                            percentage: 20,
                        },
                        {
                            address: creator2.publicKey,
                            percentage: 80,
                        },
                    ],
                    ruleSet: ruleSet("None"), // Compatibility rule set
                },
            }),
        ],
    }).sendAndConfirm(umi, txConfig);

    console.log("\Collection Created1");
    const signature = base58.deserialize(tx.signature)[0];

    console.log("\Collection Created");
    console.log("View Transaction on Solana Explorer");
    console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.log("\n");
    console.log("View NFT on Metaplex Explorer");
    console.log(
        `https://explorer.solana.com/address/${collection.publicKey}?cluster=devnet`,
    );
};

const umi = init();
createCollection();
