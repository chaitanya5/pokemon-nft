import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, basename, extname } from "path";
import {
    loadConfig,
    updateStatus,
    uploadFile,
    isFileAvailableInBucket,
    sanitizeFilename,
    getS3URL,
} from "./utils.js";

const main = async (
    inputDir,
    inputFilePath,
    remoteFolderPath,
    outputFilePath,
) => {
    // Loop through metadata folders and upload each file to S3
    console.log(
        "🚀 Starting metadata upload process with S3 bucket verification...",
    );

    try {
        const inputData = JSON.parse(readFileSync(inputFilePath));
        let outputData = [];

        // Initialize statistics (removed local tracking)
        let stats = {
            total: inputData.length,
            processed: 0,
            skipped: 0,
            uploaded: 0,
            errors: 0,
            bucketChecks: 0,
        };

        console.log("inputData.length", inputData.length);
        for (let index = 0; index < inputData.length; index++) {
            const item = inputData[index];
            outputData[index] = item; // Preserve original data

            console.log(
                `\n🔄 Processing item ${index + 1}/${inputData.length}`,
            );

            const gradingId = item.attributes.find(
                (attr) => attr.trait_type === "Grading ID",
            )?.value;
            const fileName = `${item.name}-${gradingId}`;
            const sanitizedFileName = sanitizeFilename(fileName);
            const localFilePath = join(inputDir, `${sanitizedFileName}.json`);

            console.log(`📋 Item: ${item.name}`);
            console.log(`🆔 Grading ID: ${gradingId}`);
            console.log(`📄 Local file: ${localFilePath}`);

            let resultS3Url = "empty";

            // Check if local metadata file exists
            if (localFilePath && existsSync(localFilePath)) {
                // Generate S3 key for this file
                const s3Key = `${remoteFolderPath}/${sanitizedFileName}.json`;

                // Check if file already exists in S3 bucket
                stats.bucketChecks++;
                console.log(`🔍 Checking S3 bucket for: ${s3Key}`);

                const existsInBucket = await isFileAvailableInBucket(s3Key);

                if (existsInBucket) {
                    // File already exists in bucket - skip upload
                    resultS3Url = getS3URL(s3Key);
                    console.log(
                        `🪣 Metadata already exists in bucket, using URL: ${resultS3Url}`,
                    );
                    stats.skipped++;
                } else {
                    // File doesn't exist in bucket - upload it
                    try {
                        console.log(
                            `⬆️  Uploading metadata file: ${sanitizedFileName}.json`,
                        );
                        resultS3Url = await uploadFile(
                            localFilePath,
                            remoteFolderPath,
                        );
                        console.log(
                            "✅ Metadata upload successful:",
                            resultS3Url,
                        );
                        stats.uploaded++;
                    } catch (error) {
                        console.error(
                            `❌ Error uploading metadata for item ${index + 1} (${item.name}):`,
                            error.message,
                        );
                        stats.errors++;
                    }
                }
            } else {
                console.log(
                    `❌ No metadata file found for item at index ${index}: ${localFilePath}`,
                );
                stats.errors++;
            }

            if (resultS3Url != "empty") {
                outputData[index].metadata_url = resultS3Url;
            }

            stats.processed++;
            console.log(
                `Processing item ${index + 1}/${inputData.length} - ${item.name}`,
            );
            console.log(
                `Progress: Processed ${stats.processed}/${stats.total}, Uploaded ${stats.uploaded}, Skipped ${stats.skipped}, Errors ${stats.errors}`,
            );
        }
        console.log("All metadata files processing completed.");

        writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2));
        console.log(`Wrote metadata for all Pokemons to ${outputFilePath}`);

        // Print final statistics
        console.log("\n📊 ===== METADATA UPLOAD STATISTICS =====");
        console.log(
            `📋 Total items processed: ${stats.processed}/${stats.total}`,
        );
        console.log(`⬆️  Metadata files uploaded: ${stats.uploaded}`);
        console.log(
            `🪣 Metadata files skipped (exists in bucket): ${stats.skipped}`,
        );
        console.log(`🔍 S3 bucket checks performed: ${stats.bucketChecks}`);
        console.log(`❌ Errors encountered: ${stats.errors}`);
        console.log(`📄 Output file: ${outputFilePath}`);
        console.log("==========================================\n");
    } catch (error) {
        console.error("❌ Error uploading metadata files:", error);
        if (typeof stats !== "undefined") {
            console.log("\n📊 === PARTIAL METADATA STATISTICS ===");
            console.log(`📋 Items processed before error: ${stats.processed}`);
            console.log(`⬆️  Metadata files uploaded: ${stats.uploaded}`);
            console.log(`🪣 Metadata files skipped: ${stats.skipped}`);
            console.log(`🔍 S3 bucket checks: ${stats.bucketChecks}`);
            console.log(`❌ Errors: ${stats.errors}`);
            console.log("======================================\n");
        }
        throw error;
    }
};

// Main execution
(async () => {
    console.log("🚀 Uploading metadata...\n");

    const config = loadConfig();
    const stepId = "7";

    // Update status to running
    updateStatus(stepId, "running", "Image uploading started");
    try {
        // Configuration
        const inputDir = config.pipeline.steps[stepId - 1].inputs.inputDir; // Directory to read individual metadata files
        const inputFilePath =
            config.pipeline.steps[stepId - 1].inputs.inputFilePath; // Input file with all metadata
        const outputFilePath =
            config.pipeline.steps[stepId - 1].outputs.outputFilePath;
        const remoteFolderPath =
            config.pipeline.steps[stepId - 1].outputs.remoteFolderPath; // Remote folder in S3 to upload metadata files

        await main(inputDir, inputFilePath, remoteFolderPath, outputFilePath);

        console.log("\n🎉 Metadata upload process completed successfully!");
        updateStatus(stepId, "completed", "Metadata uploading completed");
    } catch (error) {
        console.error("\n💥 Fatal error in main execution:", error);
        updateStatus(stepId, "failed", "Image uploading failed");
        process.exit(1);
    }
})();
