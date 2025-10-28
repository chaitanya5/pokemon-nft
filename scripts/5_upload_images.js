import { readFileSync, writeFileSync, existsSync } from "fs";
import { basename, extname } from "path";
import {
    loadConfig,
    updateStatus,
    uploadFile,
    isFileAvailableInBucket,
    getS3URL,
} from "./utils.js";

const main = async (
    inputData,
    inputFolder,
    outputFilePath,
    remoteFolderPath,
    numberOfImagesToUpload,
) => {
    try {
        let outputData = [];

        // Initialize statistics
        let stats = {
            total: inputData.length,
            processed: 0,
            skipped: 0,
            uploaded: 0,
            errors: 0,
            bucketChecks: 0,
        };

        for (let index = 0; index < numberOfImagesToUpload; index++) {
            const item = inputData[index];
            // console.log("item", item, inputData);
            outputData[index] = item; // Preserve original data
            const gradingId = item.attributes.find(
                (attr) => attr.trait_type === "Grading ID",
            )?.value;
            console.log(
                `Processing item ${index + 1}/${inputData.length} - Grading ID: ${gradingId}`,
            );

            // Extract front and back image URLs from attributes
            const frontImageLocalUrl = item.attributes.find(
                (attr) => attr.trait_type === "Front Image",
            )?.value;
            const backImageLocalUrl = item.attributes.find(
                (attr) => attr.trait_type === "Back Image",
            )?.value;

            let frontResultS3Url = "empty";
            let backResultS3Url = "empty";

            // Process front image
            if (frontImageLocalUrl) {
                const frontFileName = basename(frontImageLocalUrl);
                const frontS3Key = `${remoteFolderPath}/${frontFileName}`;

                // Check if file exists in S3 bucket
                stats.bucketChecks++;
                const existsInBucket =
                    await isFileAvailableInBucket(frontS3Key);

                if (existsInBucket) {
                    // File exists in bucket but not in local tracking - update tracking
                    frontResultS3Url = getS3URL(frontS3Key);
                    stats.skipped++;
                } else {
                    // File doesn't exist anywhere - upload it
                    try {
                        console.log(
                            `⬆️  Uploading front image: ${frontFileName}`,
                        );
                        frontResultS3Url = await uploadFile(
                            frontImageLocalUrl.startsWith("images")
                                ? frontImageLocalUrl
                                : `${inputFolder}/${frontImageLocalUrl}`,
                            remoteFolderPath,
                        );
                        console.log(
                            "✅ Front image upload successful:",
                            frontResultS3Url,
                        );
                        stats.uploaded++;
                    } catch (error) {
                        console.error(
                            `❌ Error uploading front image for item ${index + 1}:`,
                            error.message,
                        );
                        stats.errors++;
                    }
                }
            } else {
                console.log(
                    `⚠️  No front image URL for item at index ${index}`,
                );
            }

            // Process back image
            if (backImageLocalUrl) {
                const backFileName = basename(backImageLocalUrl);
                const backS3Key = `${remoteFolderPath}/${backFileName}`;

                // Check if file exists in S3 bucket
                stats.bucketChecks++;
                const existsInBucket = await isFileAvailableInBucket(backS3Key);

                if (existsInBucket) {
                    // File exists in bucket but not in local tracking - update tracking
                    backResultS3Url = getS3URL(backS3Key);
                    stats.skipped++;
                } else {
                    // File doesn't exist anywhere - upload it
                    try {
                        console.log(
                            `⬆️  Uploading back image: ${backFileName}`,
                        );
                        backResultS3Url = await uploadFile(
                            backImageLocalUrl.startsWith("images")
                                ? backImageLocalUrl
                                : `${inputFolder}/${backImageLocalUrl}`,
                            remoteFolderPath,
                        );
                        console.log(
                            "✅ Back image upload successful:",
                            backResultS3Url,
                        );
                        stats.uploaded++;
                    } catch (error) {
                        console.error(
                            `❌ Error uploading back image for item ${index + 1}:`,
                            error.message,
                        );
                        stats.errors++;
                    }
                }
            } else {
                console.log(`⚠️  No back image URL for item at index ${index}`);
            }

            // Update output data with remote file paths if uploads were successful
            if (frontResultS3Url != "empty") {
                outputData[index].image = frontResultS3Url;
                outputData[index].animation_url = frontResultS3Url;
                outputData[index].attributes.find(
                    (attr) => attr.trait_type === "Front Image",
                ).value = frontResultS3Url;
            }
            if (backResultS3Url != "empty") {
                outputData[index].attributes.find(
                    (attr) => attr.trait_type === "Back Image",
                ).value = backResultS3Url;
            }

            outputData[index].properties.files = [
                { uri: frontResultS3Url, type: "image/jpeg" },
                { uri: backResultS3Url, type: "image/jpeg" },
            ];

            stats.processed++;
            console.log(
                `Finished processing item ${index + 1}/${inputData.length}`,
            );
            console.log(
                `Progress: Processed ${stats.processed}/${stats.total}, Uploaded ${stats.uploaded}, Skipped ${stats.skipped}, Errors ${stats.errors}`,
            );
        }

        // Write updated metadata to new file
        writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2));
        console.log(
            "Updated metadata with S3 image paths written to",
            outputFilePath,
        );

        // Print final statistics
        console.log("\n📊 ===== UPLOAD STATISTICS =====");
        console.log(
            `📋 Total items processed: ${stats.processed}/${stats.total}`,
        );
        console.log(`⬆️  Images uploaded: ${stats.uploaded}`);
        console.log(`⏭️  Images skipped (total): ${stats.skipped}`);
        console.log(`🔍 S3 bucket checks performed: ${stats.bucketChecks}`);
        console.log(`❌ Errors encountered: ${stats.errors}`);
        console.log("================================\n");
    } catch (error) {
        console.error("Upload process failed:", error);
        if (typeof stats !== "undefined") {
            console.log("\n=== PARTIAL STATISTICS ===");
            console.log(`Items processed before error: ${stats.processed}`);
            console.log(`Images uploaded: ${stats.uploaded}`);
            console.log(`Images skipped: ${stats.skipped}`);
            console.log(`Errors: ${stats.errors}`);
            console.log("===========================\n");
        }
    }
};

// Main execution
(async () => {
    console.log("🚀 Uploading images...\n");

    const config = loadConfig();
    const stepId = "5";

    // Update status to running
    updateStatus(stepId, "running", "Image uploading started");
    try {
        const inputFile = config.pipeline.steps[stepId - 1].inputs.inputFile;
        const outputFilePath =
            config.pipeline.steps[stepId - 1].outputs.outputFilePath;
        const remoteFolderPath =
            config.pipeline.steps[stepId - 1].outputs.remoteFolderPath;
        const inputFolder = config.paths.images;

        const inputData = JSON.parse(readFileSync(inputFile));

        // console.log("inputData", inputData);

        console.log(
            "🚀 Starting image upload process with S3 bucket verification...\n",
        );

        // const numberOfImagesToUpload = 2;
        const numberOfImagesToUpload = inputData.length;

        await main(
            inputData,
            inputFolder,
            outputFilePath,
            remoteFolderPath,
            numberOfImagesToUpload,
        );
        console.log("\n🎉 Image upload process completed successfully!");
        updateStatus(stepId, "completed", "Image uploading started");
    } catch (error) {
        console.error("\n💥 Fatal error in main execution:", error);
        updateStatus(stepId, "failed", "Image uploading failed");
        process.exit(1);
    }
})();
