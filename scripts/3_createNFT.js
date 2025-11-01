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
    const inputFile = config.pipeline.steps[step - 1].inputs.inputFile;
    const ENHANCED_METADATA_FILE = config[network].ENHANCED_METADATA_FILE;

    console.log(RPC_ENDPOINT, MINTED_NFTS_FILE, ENHANCED_METADATA_FILE);

    return {
        umi: createUmi(RPC_ENDPOINT).use(mplCore()),
        MINTED_NFTS_FILE: MINTED_NFTS_FILE,
        ENHANCED_METADATA_FILE: ENHANCED_METADATA_FILE,
        inputFile: inputFile,
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

// Save minted NFT to tracking file
const saveMintedNFT = (nftName, mintData) => {
    try {
        console.log("MINTED_NFTS_FILE", MINTED_NFTS_FILE);
        const mintedNFTs = loadMintedNFTs();
        mintedNFTs[nftName] = {
            ...mintData,
            timestamp: new Date().toISOString(),
        };
        // if (!existsSync(folder)) {
        //     mkdirSync(folder, { recursive: true });
        //     console.log(`📁 Created download folder: ${folder}`);
        // }
        writeFileSync(MINTED_NFTS_FILE, JSON.stringify(mintedNFTs, null, 2));
        console.log(`✅ Saved minted NFT: ${nftName}`);
    } catch (error) {
        console.error("Error saving minted NFT:", error);
    }
};

// Check if NFT is already minted
const isNFTMinted = (nftName, mintedNFTs) => {
    return mintedNFTs.hasOwnProperty(nftName);
};

// Load enhanced metadata file (original metadata + asset addresses)
const loadEnhancedMetadata = () => {
    if (existsSync(ENHANCED_METADATA_FILE)) {
        try {
            const data = readFileSync(ENHANCED_METADATA_FILE, "utf8");
            return JSON.parse(data);
        } catch (error) {
            console.error("Error loading enhanced metadata file:", error);
            return [];
        }
    }
    return [];
};

// Save enhanced metadata file
const saveEnhancedMetadata = (enhancedNFTs) => {
    try {
        writeFileSync(
            ENHANCED_METADATA_FILE,
            JSON.stringify(enhancedNFTs, null, 2),
        );
        console.log(
            `✅ Saved enhanced metadata file with ${enhancedNFTs.length} NFTs`,
        );
    } catch (error) {
        console.error("Error saving enhanced metadata file:", error);
    }
};

// Add asset address to NFT metadata
const addAssetAddressToMetadata = (originalMetadata, assetAddress) => {
    return {
        ...originalMetadata,
        assetAddress: assetAddress,
    };
};

const mintNFT = async (nftdata, originalNFTData) => {
    try {
        const signer = nftdata.signer;
        console.log("Using Wallet:", signer.publicKey.toString());
        umi.use(signerIdentity(signer));

        // Create an asset in the collection
        const asset = generateSigner(umi);

        console.log("3. Creating Asset:", asset.publicKey.toString());
        const tx = await createV1(umi, {
            name: nftdata.name,
            uri: nftdata.uri,
            asset: asset,
            collection: nftdata.collection.publicKey,
            authority: nftdata.updateAuthority,
        }).sendAndConfirm(umi, txConfig);

        console.log("✅ NFT Created Successfully!");
        const signature = base58.deserialize(tx.signature)[0];
        const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
        console.log(`🔗 Transaction: ${explorerUrl}`);
        console.log(`📄 Asset Address: ${asset.publicKey.toString()}`);

        // Save minted NFT data immediately after successful creation
        const mintData = {
            assetAddress: asset.publicKey.toString(),
            ownerAddress: signer.publicKey.toString(),
            transactionSignature: signature,
            explorerUrl: explorerUrl,
            uri: nftdata.uri,
            collectionAddress: nftdata.collection.publicKey.toString(),
        };

        saveMintedNFT(nftdata.sanitizedFilename, mintData);

        // Create enhanced metadata with asset address
        const enhancedMetadata = addAssetAddressToMetadata(
            originalNFTData,
            asset.publicKey.toString(),
        );

        return {
            success: true,
            assetAddress: asset.publicKey.toString(),
            signature: signature,
            explorerUrl: explorerUrl,
            enhancedMetadata: enhancedMetadata,
        };
    } catch (error) {
        console.error("❌ Error minting NFT:", error);
        return {
            success: false,
            error: error.message || error,
        };
    }
};

const createNFT = async (numberOfNFTsToMint) => {
    if (!existsSync(inputFile)) {
        console.error(
            "Please provide metadata input file (5_metadata_with_S3_and_metadata_urls.json).",
        );
        return;
    }

    console.log("📋 Loading NFT metadata...");
    const nfts = JSON.parse(readFileSync(inputFile));
    console.log(`📊 Total NFTs to process: ${nfts.length}`);

    // Load previously minted NFTs
    console.log("📂 Loading minted NFTs tracking data...");
    const mintedNFTs = loadMintedNFTs();
    const mintedCount = Object.keys(mintedNFTs).length;
    console.log(`✅ Found ${mintedCount} already minted NFTs`);

    // Filter out already minted NFTs
    const unmintedNFTs = nfts.filter(
        (nft) => !isNFTMinted(nft.sanitizedFilename, mintedNFTs),
    );
    console.log(`🔄 NFTs remaining to mint: ${unmintedNFTs.length}`);

    if (unmintedNFTs.length === 0) {
        console.log("🎉 All NFTs have already been minted!");
        return;
    }

    // Generate all required signers from saved wallets
    const {
        signer,
        collection,
        collectionUpdateAuthority,
        creator1,
        creator2,
    } = makeSignersFromSavedWallets();

    // Load existing enhanced metadata (if any)
    let enhancedMetadataList = loadEnhancedMetadata();
    console.log(
        `📄 Loaded ${enhancedMetadataList.length} existing enhanced metadata entries`,
    );

    let successCount = 0;
    let failureCount = 0;

    console.log("\n🚀 Starting NFT minting process...\n");

    // Process only first 2 NFTs for testing (remove this limit for production)
    const nftsToProcess = unmintedNFTs.slice(
        0,
        Math.min(numberOfNFTsToMint, unmintedNFTs.length),
    );
    // For production, use: const nftsToProcess = unmintedNFTs;

    for (let index = 0; index < nftsToProcess.length; index++) {
        const asset = nftsToProcess[index];

        console.log(
            `\n📦 Processing NFT ${index + 1}/${nftsToProcess.length}: ${asset.name}`,
        );

        const nftdata = {
            name: asset.name,
            sanitizedFilename: asset.sanitizedFilename,
            uri: asset.metadata_url,
            signer: signer,
            collection: collection,
            updateAuthority: collectionUpdateAuthority,
        };

        const result = await mintNFT(nftdata, asset);

        if (result.success) {
            successCount++;
            console.log(`✅ Success! Asset: ${result.assetAddress}`);

            // Add the enhanced metadata to the list
            enhancedMetadataList.push(result.enhancedMetadata);

            // Save the enhanced metadata file after each successful mint
            saveEnhancedMetadata(enhancedMetadataList);
        } else {
            failureCount++;
            console.error(`❌ Failed to mint: ${asset.name}`);
            console.error(`   Error: ${result.error}`);
        }

        // Add a small delay between mints to avoid rate limiting
        if (index < nftsToProcess.length - 1) {
            console.log("⏳ Waiting 2 seconds before next mint...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    console.log("\n📈 Minting Summary:");
    console.log(`✅ Successfully minted: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log(`📊 Total processed: ${successCount + failureCount}`);
    console.log(`📂 Tracking file: ${MINTED_NFTS_FILE}`);
    console.log(`📄 Enhanced metadata file: ${ENHANCED_METADATA_FILE}`);
    console.log(
        `📋 Total enhanced metadata entries: ${enhancedMetadataList.length}`,
    );
};

const step = 3;

// Parse command line arguments
const args = process.argv.slice(2);
let network = "devnet";
let numberOfNFTsToMint = 1;

// Parse arguments
args.forEach((arg) => {
    const [key, value] = arg.split("=");
    if (key === "--network") {
        network = value;
    } else if (key === "--count") {
        numberOfNFTsToMint = parseInt(value);
    }
});

// Validate arguments
if (!["mainnet", "devnet", "testnet"].includes(network)) {
    console.error(
        "Invalid network specified. Must be mainnet, devnet, or testnet",
    );
    process.exit(1);
}

if (
    isNaN(numberOfNFTsToMint) ||
    numberOfNFTsToMint < 1 ||
    numberOfNFTsToMint > 100
) {
    console.error("Invalid NFT count. Must be between 1 and 100");
    process.exit(1);
}

const { umi, MINTED_NFTS_FILE, ENHANCED_METADATA_FILE, inputFile } = init(
    step,
    network,
);

// Run the NFT creation process
createNFT(numberOfNFTsToMint).catch((error) => {
    console.error("Error creating NFTs:", error);
    process.exit(1);
});
