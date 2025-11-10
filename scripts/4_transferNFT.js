import {
    createV1,
    create,
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
    generateSigner,
    signerIdentity,
    createSignerFromKeypair,
    sol,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { loadConfig, makeSignersFromSavedWallets } from "./utils.js";

const init = (step, network) => {
    const config = loadConfig();
    const RPC_ENDPOINT = config[network].RPC_ENDPOINT;
    console.log(config[network]);

    const MINTED_NFTS_FILE = config[network].MINTED_NFTS_FILE;

    console.log(RPC_ENDPOINT, MINTED_NFTS_FILE);

    return {
        umi: createUmi(RPC_ENDPOINT).use(mplCore()),
        MINTED_NFTS_FILE: MINTED_NFTS_FILE,
        // ENHANCED_METADATA_FILE: ENHANCED_METADATA_FILE,
        // inputFile: inputFile,
    };
};

const txConfig = {
    send: { skipPreflight: true },
    confirm: { commitment: "confirmed" },
};

// Load previously minted NFTs from tracking file
const loadMintedNFTs = () => {
    if (existsSync(MINTED_NFTS_FILE)) {
        try {
            const data = readFileSync(MINTED_NFTS_FILE, "utf8");
            return JSON.parse(data);
        } catch (error) {
            console.error("Error loading minted NFTs file:", error);
            return {};
        }
    }
    return {};
};

const assetsByUserAndCollection = async (user, collectionAddress) => {
    try {
        console.log(`🔍 Fetching NFTs for user: ${user}`);
        console.log(`📁 Collection: ${collectionAddress}`);

        // Fetch assets by user and collection
        const assetsByCollection = await getAssetV1GpaBuilder(umi)
            .whereField("key", Key.AssetV1)
            .whereField("owner", user)
            .whereField(
                "updateAuthority",
                updateAuthority("Collection", [collectionAddress]),
            )
            .getDeserialized();

        console.log(
            `📊 Found ${assetsByCollection.length} NFTs in collection for user`,
        );

        const nfts = assetsByCollection.map((asset) => {
            return {
                name: asset.name,
                uri: asset.uri,
                address: asset.publicKey,
                owner: asset.owner,
            };
        });

        return nfts;
    } catch (error) {
        console.error(
            "❌ Error fetching assets by user and collection:",
            error,
        );
        return [];
    }
};

const transferNFT = async (
    signer,
    nftAddress,
    collectionPubKey,
    recipientAddress,
) => {
    try {
        console.log("📤 Using Wallet:", signer.publicKey.toString());
        umi.use(signerIdentity(signer));

        console.log("📦 Transferring Asset:", nftAddress);
        console.log("👤 Recipient:", recipientAddress);

        const tx = await transferV1(umi, {
            asset: nftAddress,
            newOwner: recipientAddress,
            collection: collectionPubKey,
        }).sendAndConfirm(umi, txConfig);

        console.log("✅ NFT Transferred Successfully!");
        const signature = base58.deserialize(tx.signature)[0];
        const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
        console.log(`🔗 Transaction: ${explorerUrl}`);
        console.log(`📄 Asset Address: ${nftAddress}`);

        return {
            success: true,
            assetAddress: nftAddress,
            signature: signature,
            explorerUrl: explorerUrl,
        };
    } catch (error) {
        console.error("❌ Error transferring NFT:", error);
        return {
            success: false,
            error: error.message || error,
        };
    }
};

const startTransfer = async (recipientAddress) => {
    if (!recipientAddress) {
        console.error(
            "❌ Please provide a recipient address for NFT transfers.",
        );
        return;
    }

    console.log("📋 Loading minted NFTs data...");
    const mintedNFTs = loadMintedNFTs();
    const mintedNFTEntries = Object.entries(mintedNFTs);

    if (mintedNFTEntries.length === 0) {
        console.error(
            "❌ No minted NFTs found in tracking file. Please mint some NFTs first.",
        );
        return;
    }

    // Extract asset addresses from minted NFTs data
    const mintedAssetAddresses = mintedNFTEntries.map(
        ([name, data]) => data.assetAddress,
    );
    console.log(
        `📊 Found ${mintedAssetAddresses.length} minted NFTs to potentially transfer`,
    );

    // Generate all required signers from saved wallets
    const {
        signer,
        collection,
        collectionUpdateAuthority,
        creator1,
        creator2,
    } = makeSignersFromSavedWallets();

    // Fetch NFTs owned by the signer in this collection
    console.log("\n� Fetching NFTs from collection...");
    const ownedNFTs = await assetsByUserAndCollection(
        signer.publicKey.toString(),
        collection.publicKey.toString(),
    );

    if (ownedNFTs.length === 0) {
        console.log("❌ No NFTs found in collection for current user.");
        return;
    }

    console.log(
        `📦 Found ${ownedNFTs.length} NFTs in collection owned by user`,
    );

    // Match owned NFTs with minted NFTs by asset address
    const nftsToTransfer = ownedNFTs.filter((ownedNFT) =>
        mintedAssetAddresses.includes(ownedNFT.address),
    );

    console.log(`🔄 NFTs to transfer: ${nftsToTransfer.length}`);

    if (nftsToTransfer.length === 0) {
        console.log(
            "❌ No matching NFTs found between owned NFTs and minted NFTs list.",
        );
        return;
    }

    let successCount = 0;
    let failureCount = 0;

    console.log("\n🚀 Starting NFT transfer process...\n");
    console.log(`👤 Recipient: ${recipientAddress}\n`);

    // Process transfers (limit to 5 for testing, remove limit for production)
    // const nftsToProcess = nftsToTransfer.slice(0, Math.min(2, nftsToTransfer.length));
    const nftsToProcess = nftsToTransfer; // For production

    for (let index = 0; index < nftsToProcess.length; index++) {
        const nft = nftsToProcess[index];

        console.log(
            `\n� Transferring NFT ${index + 1}/${nftsToProcess.length}: ${nft.name}`,
        );
        console.log(`📄 Asset Address: ${nft.address}`);

        const result = await transferNFT(
            signer,
            nft.address,
            collection.publicKey,
            recipientAddress,
        );

        if (result.success) {
            successCount++;
            console.log(
                `✅ Transfer Success! Transaction: ${result.signature}`,
            );
        } else {
            failureCount++;
            console.error(`❌ Failed to transfer: ${nft.name}`);
            console.error(`   Error: ${result.error}`);
        }

        // Add a small delay between transfers to avoid rate limiting
        if (index < nftsToProcess.length - 1) {
            console.log("⏳ Waiting 2 seconds before next transfer...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    console.log("\n📈 Transfer Summary:");
    console.log(`✅ Successfully transferred: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log(`📊 Total processed: ${successCount + failureCount}`);
    console.log(`� Recipient: ${recipientAddress}`);
};

const step = 4;
// Parse command line arguments
const args = process.argv.slice(2);
let network = "devnet";
let recipientAddress = "9c5Yb9KWmoYhcpzW5xDcCJn8UYJwcjVFrKxb8gK6rCno";

// Parse arguments
args.forEach((arg) => {
    const [key, value] = arg.split("=");
    if (key === "--network") {
        network = value;
    } else if (key === "--recipientAddress") {
        recipientAddress = value;
    }
});

// Validate arguments
if (!["mainnet", "devnet"].includes(network)) {
    console.error(
        "Invalid network specified. Must be mainnet, devnet, or testnet",
    );
    process.exit(1);
}

if (!recipientAddress) {
    console.error("Invalid recipientAddress.");
    process.exit(1);
}

const { umi, MINTED_NFTS_FILE } = init(step, network);

// Run the NFT transfer process
startTransfer(recipientAddress).catch(console.error);
