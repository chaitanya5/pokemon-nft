import axios from "axios";
import {
    existsSync,
    mkdirSync,
    createWriteStream,
    unlinkSync,
    readFileSync,
    writeFileSync,
    statSync,
} from "fs";
import { join } from "path";
import { loadConfig, updateStatus, sanitizeFilename } from "./utils.js";

/**
 * Downloads an image with advanced error handling and retry logic
 * @param {string} url - The URL to download from
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Download result object
 */
async function downloadImageAdvanced(url, options = {}) {
    const {
        filename = null,
        folder = "./images",
        timeout = 10000,
        retries = 3,
    } = options;

    // Input validation
    if (!url || typeof url !== "string") {
        throw new Error("❌ Invalid URL: URL must be a non-empty string");
    }

    if (!filename || typeof filename !== "string") {
        throw new Error(
            "❌ Invalid filename: Filename must be a non-empty string",
        );
    }

    // Validate URL format
    try {
        new URL(url);
    } catch (urlError) {
        throw new Error(`❌ Invalid URL format: ${url} - ${urlError.message}`);
    }

    console.log(
        `🔄 Starting download: ${filename} from ${url.substring(0, 80)}...`,
    );

    // Create folder with error handling
    try {
        if (!existsSync(folder)) {
            mkdirSync(folder, { recursive: true });
            console.log(`📁 Created download folder: ${folder}`);
        }
    } catch (folderError) {
        throw new Error(
            `❌ Failed to create download folder '${folder}': ${folderError.message}`,
        );
    }

    // Check if file already exists with any common image extension
    const possibleFilenames = [
        `${filename}.jpg`,
        `${filename}.jpeg`,
        `${filename}.png`,
        `${filename}.webp`,
        `${filename}.gif`,
    ];

    try {
        const existingFile = possibleFilenames.find((fname) => {
            const fullPath = join(folder, fname);
            return existsSync(fullPath);
        });

        if (existingFile) {
            const existingPath = join(folder, existingFile);
            console.log(
                `✅ File already exists, skipping download: ${existingPath}`,
            );
            return {
                success: true,
                filepath: existingPath,
                filename: existingFile,
                skipped: true,
                reason: "File already exists",
            };
        }
    } catch (checkError) {
        console.warn(
            `⚠️  Error checking existing files: ${checkError.message}`,
        );
        // Continue with download attempt
    }

    // Track errors and attempts for better reporting
    const downloadAttempts = [];
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        const attemptStart = Date.now();
        let filepath = ""; // Declare filepath in broader scope

        try {
            console.log(
                `🔄 Attempt ${attempt}/${retries} - Downloading ${filename}...`,
            );

            const response = await axios({
                method: "GET",
                url: url,
                responseType: "stream",
                timeout: timeout,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                    Accept: "image/*,*/*",
                    "Accept-Encoding": "gzip, deflate, br",
                },
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 400,
            });

            // Enhanced response validation
            if (!response || !response.data) {
                throw new Error("❌ Empty response received from server");
            }

            if (response.status < 200 || response.status >= 300) {
                throw new Error(
                    `❌ HTTP ${response.status} ${response.statusText || "Unknown Error"}`,
                );
            }

            console.log(
                `📡 Response received: ${response.status} ${response.statusText || "OK"}`,
            );
            console.log(
                `📊 Content-Type: ${response.headers["content-type"] || "Unknown"}`,
            );

            // Check content length if available
            const contentLength = response.headers["content-length"];
            if (contentLength) {
                const sizeKB = (parseInt(contentLength) / 1024).toFixed(2);
                console.log(`📏 Content-Length: ${sizeKB} KB`);

                if (parseInt(contentLength) === 0) {
                    throw new Error(
                        "❌ Server returned empty file (Content-Length: 0)",
                    );
                }
            }

            // Enhanced content validation
            const contentDisposition = response.headers["content-disposition"];
            const contentType = response.headers["content-type"] || "";

            // Check for forced download headers
            if (contentDisposition && /attachment/i.test(contentDisposition)) {
                throw new Error(
                    "❌ Server forcing download - may not be a direct image link",
                );
            }

            // Validate content type for images
            if (
                contentType &&
                !contentType.startsWith("image/") &&
                !contentType.includes("octet-stream")
            ) {
                console.warn(
                    `⚠️  Unexpected content type: ${contentType} (proceeding anyway)`,
                );
            }

            // Check for error responses disguised as 200
            if (
                contentType.includes("text/html") ||
                contentType.includes("application/json")
            ) {
                throw new Error(
                    `❌ Server returned ${contentType} instead of image - likely an error page`,
                );
            }

            // // If server suggests a filename via Content-Disposition
            // if (contentDisposition && contentDisposition.includes('filename=')) {
            //     const matches = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            //     if (matches && matches[1]) {
            //         let serverFilename = matches[1].replace(/['"]/g, '');
            //         // Decode URL-encoded filenames
            //         serverFilename = decodeURIComponent(serverFilename);
            //         finalFilename = serverFilename;
            //         console.log(`Server suggested filename: ${serverFilename}`);
            //     }
            // }

            // Determine file extension with fallbacks
            let extension = getExtensionFromContentType(contentType);
            if (!extension) {
                extension = getExtensionFromUrl(url);
                console.log(`📝 Extension from URL: ${extension}`);
            } else {
                console.log(`📝 Extension from Content-Type: ${extension}`);
            }

            // Generate final filename and path
            const finalFilename = `${filename}.${extension}`;
            filepath = join(folder, finalFilename);

            console.log(`💾 Target file: ${filepath}`);

            // Double-check if file exists (race condition protection)
            if (existsSync(filepath)) {
                console.log(
                    `✅ File created during processing, skipping: ${filepath}`,
                );
                return {
                    success: true,
                    filepath,
                    filename: finalFilename,
                    skipped: true,
                    reason: "File created during processing",
                };
            }

            // Create write stream with error handling
            const writer = createWriteStream(filepath);
            let bytesWritten = 0;

            // Track download progress
            response.data.on("data", (chunk) => {
                bytesWritten += chunk.length;
            });

            response.data.pipe(writer);

            // Enhanced promise with detailed error handling
            await new Promise((resolve, reject) => {
                writer.on("finish", () => {
                    const sizeKB = (bytesWritten / 1024).toFixed(2);
                    console.log(
                        `✅ Download completed: ${sizeKB} KB written to ${filepath}`,
                    );
                    resolve();
                });

                writer.on("error", (writeError) => {
                    console.error(`❌ File write error: ${writeError.message}`);
                    reject(
                        new Error(`File write failed: ${writeError.message}`),
                    );
                });

                response.data.on("error", (streamError) => {
                    console.error(`❌ Stream error: ${streamError.message}`);
                    reject(
                        new Error(
                            `Download stream error: ${streamError.message}`,
                        ),
                    );
                });

                // Handle response errors
                response.data.on("aborted", () => {
                    reject(new Error("❌ Download aborted by server"));
                });

                // Timeout for the writing process
                const writeTimeout = setTimeout(() => {
                    reject(new Error("❌ Download write timeout"));
                }, timeout + 5000);

                writer.on("finish", () => clearTimeout(writeTimeout));
                writer.on("error", () => clearTimeout(writeTimeout));
            });

            // Validate downloaded file
            try {
                if (!existsSync(filepath)) {
                    throw new Error("❌ File was not created successfully");
                }

                const stats = statSync(filepath);
                if (stats.size === 0) {
                    throw new Error("❌ Downloaded file is empty");
                }

                const downloadTime = (
                    (Date.now() - attemptStart) /
                    1000
                ).toFixed(2);
                const finalSizeKB = (stats.size / 1024).toFixed(2);

                console.log(
                    `🎉 Download successful: ${finalFilename} (${finalSizeKB} KB in ${downloadTime}s)`,
                );

                return {
                    success: true,
                    filepath,
                    filename: finalFilename,
                    size: stats.size,
                    sizeKB: finalSizeKB,
                    downloadTime: parseFloat(downloadTime),
                    attempts: attempt,
                };
            } catch (validationError) {
                throw new Error(
                    `❌ File validation failed: ${validationError.message}`,
                );
            }
        } catch (error) {
            const attemptTime = ((Date.now() - attemptStart) / 1000).toFixed(2);
            lastError = error;

            // Categorize error types for better handling
            let errorCategory = "Unknown";
            let shouldRetry = true;

            if (error.code === "ENOTFOUND") {
                errorCategory = "DNS/Network";
            } else if (error.code === "ECONNREFUSED") {
                errorCategory = "Connection Refused";
            } else if (
                error.code === "ETIMEDOUT" ||
                error.message.includes("timeout")
            ) {
                errorCategory = "Timeout";
            } else if (
                error.response &&
                error.response.status >= 400 &&
                error.response.status < 500
            ) {
                errorCategory = "Client Error";
                shouldRetry =
                    error.response.status === 429 ||
                    error.response.status === 408; // Only retry on rate limit or timeout
            } else if (error.response && error.response.status >= 500) {
                errorCategory = "Server Error";
            } else if (
                error.message.includes("write") ||
                error.message.includes("ENOSPC")
            ) {
                errorCategory = "File System";
                shouldRetry = false; // Don't retry disk/permission issues
            }

            // Record attempt details
            downloadAttempts.push({
                attempt,
                error: error.message,
                category: errorCategory,
                time: attemptTime,
                shouldRetry,
            });

            console.error(
                `❌ Attempt ${attempt}/${retries} failed (${attemptTime}s): ${errorCategory} - ${error.message}`,
            );

            // Clean up partial files
            try {
                if (filepath && existsSync(filepath)) {
                    unlinkSync(filepath);
                    console.log(`🗑️  Cleaned up partial file: ${filepath}`);
                }
            } catch (cleanupError) {
                console.warn(
                    `⚠️  Could not clean up partial file: ${cleanupError.message}`,
                );
            }

            // Determine if we should continue retrying
            if (attempt < retries && shouldRetry) {
                const backoffDelay = Math.min(
                    1000 * Math.pow(2, attempt - 1),
                    10000,
                ); // Exponential backoff, max 10s
                console.log(
                    `⏳ Retrying in ${backoffDelay / 1000}s... (${errorCategory})`,
                );

                await new Promise((resolve) =>
                    setTimeout(resolve, backoffDelay),
                );
            } else if (!shouldRetry) {
                console.error(
                    `🛑 Error type '${errorCategory}' is not retryable, stopping attempts`,
                );
                break;
            }
        }
    }

    // Enhanced error reporting for final failure
    const totalAttempts = downloadAttempts.length;
    const errorSummary = downloadAttempts
        .map((a) => `${a.attempt}: ${a.category}`)
        .join(", ");

    console.error(
        `💥 All ${totalAttempts} download attempts failed for ${filename}`,
    );
    console.error(`📊 Attempt summary: ${errorSummary}`);

    throw new Error(
        `❌ Download failed after ${totalAttempts} attempts. Last error: ${lastError.message}. URL: ${url.substring(0, 100)}...`,
    );
}

function getExtensionFromUrl(url) {
    const match = url.match(/\.(jpe?g|png|gif|bmp|webp|svg)$/i);
    return match ? match[1].toLowerCase() : "jpg";
}

function getExtensionFromContentType(contentType) {
    if (!contentType) return null;

    const typeMap = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/svg+xml": "svg",
        "application/octet-stream": "bin",
        "application/pdf": "pdf",
        "text/plain": "txt",
    };

    return typeMap[contentType.split(";")[0].trim()]; // Remove charset etc.
}

/**
 * Main processing function with comprehensive error handling
 */
const processImageDownloads = async (inputFile, outputFile) => {
    const startTime = Date.now();

    console.log("🚀 ===== POKEMON IMAGE DOWNLOAD PROCESS STARTED =====");
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    console.log(`📂 Input file: ${inputFile}`);
    console.log(`📤 Output file: ${outputFile}`);

    // Statistics tracking
    const stats = {
        total: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        frontImages: { success: 0, failed: 0, skipped: 0 },
        backImages: { success: 0, failed: 0, skipped: 0 },
        errors: [],
    };

    try {
        // Read and validate input file
        let inputData;
        try {
            if (!existsSync(inputFile)) {
                throw new Error(`Input file not found: ${inputFile}`);
            }

            const fileContent = readFileSync(inputFile, "utf8");
            if (!fileContent.trim()) {
                throw new Error("Input file is empty");
            }

            inputData = JSON.parse(fileContent);
        } catch (parseError) {
            throw new Error(
                `Failed to read/parse input file: ${parseError.message}`,
            );
        }

        // Validate input data structure
        if (!Array.isArray(inputData)) {
            throw new Error(
                `Input data must be an array, got ${typeof inputData}`,
            );
        }

        if (inputData.length === 0) {
            throw new Error("Input data array is empty");
        }

        stats.total = inputData.length;
        console.log(`✅ Loaded ${stats.total} metadata items for processing\n`);

        let outputData = [];

        // Process each item with comprehensive error handling
        for (let index = 0; index < inputData.length; index++) {
            const itemStartTime = Date.now();
            stats.processed++;

            console.log(
                `\n🔄 ===== PROCESSING ITEM ${index + 1}/${stats.total} =====`,
            );

            try {
                const item = inputData[index];

                // Validate item structure
                if (!item || typeof item !== "object") {
                    throw new Error("Item is not a valid object");
                }

                if (!item.attributes || !Array.isArray(item.attributes)) {
                    throw new Error("Item missing attributes array");
                }

                // Preserve original data
                outputData[index] = { ...item };

                // Extract itemName and gradingId safely
                const gradingId =
                    item.attributes.find(
                        (attr) => attr.trait_type === "Grading ID",
                    )?.value || `item_${index}`;
                const itemName = item.name;

                console.log(`📋 Item: ${itemName}`);
                console.log(`🆔 Grading ID: ${gradingId}`);

                // Extract image URLs with validation
                const frontImageAttr = item.attributes.find(
                    (attr) => attr.trait_type === "Front Image",
                );
                const backImageAttr = item.attributes.find(
                    (attr) => attr.trait_type === "Back Image",
                );

                const frontImageUrl = frontImageAttr?.value;
                const backImageUrl = backImageAttr?.value;

                console.log(
                    `🖼️  Front Image URL: ${frontImageUrl ? "Found" : "Missing"}`,
                );
                console.log(
                    `🖼️  Back Image URL: ${backImageUrl ? "Found" : "Missing"}`,
                );

                // Initialize download results
                let frontResult = { success: false };
                let backResult = { success: false };
                let itemSuccess = true;

                // Download front image
                if (
                    frontImageUrl &&
                    frontImageUrl !== "N/A" &&
                    frontImageUrl.startsWith("http")
                ) {
                    try {
                        console.log(`⬇️  Downloading front image...`);
                        const frontFileName = sanitizeFilename(
                            `${itemName}-${gradingId}-front`,
                        );

                        frontResult = await downloadImageAdvanced(
                            frontImageUrl,
                            {
                                filename: frontFileName,
                                folder: "./images",
                                timeout: 10000,
                                retries: 3,
                            },
                        );

                        if (frontResult.success) {
                            if (frontResult.skipped) {
                                stats.frontImages.skipped++;
                                console.log(
                                    `⏭️  Front image skipped: ${frontResult.reason}`,
                                );
                            } else {
                                stats.frontImages.success++;
                                console.log(
                                    `✅ Front image downloaded successfully`,
                                );
                            }
                        }
                    } catch (frontError) {
                        stats.frontImages.failed++;
                        itemSuccess = false;
                        console.error(
                            `❌ Front image download failed: ${frontError.message}`,
                        );
                        stats.errors.push({
                            index,
                            gradingId,
                            type: "Front Image Download",
                            error: frontError.message,
                            url: frontImageUrl.substring(0, 100),
                        });
                    }
                } else {
                    console.log(
                        `⚠️  No valid front image URL (${frontImageUrl || "undefined"})`,
                    );
                    stats.frontImages.skipped++;
                }

                // Download back image
                if (
                    backImageUrl &&
                    backImageUrl !== "N/A" &&
                    backImageUrl.startsWith("http")
                ) {
                    try {
                        console.log(`⬇️  Downloading back image...`);
                        const backFileName = sanitizeFilename(
                            `${itemName}-${gradingId}-back`,
                        );

                        backResult = await downloadImageAdvanced(backImageUrl, {
                            filename: backFileName,
                            folder: "./images",
                            timeout: 10000,
                            retries: 3,
                        });

                        if (backResult.success) {
                            if (backResult.skipped) {
                                stats.backImages.skipped++;
                                console.log(
                                    `⏭️  Back image skipped: ${backResult.reason}`,
                                );
                            } else {
                                stats.backImages.success++;
                                console.log(
                                    `✅ Back image downloaded successfully`,
                                );
                            }
                        }
                    } catch (backError) {
                        stats.backImages.failed++;
                        // Don't mark item as failed if only back image fails
                        console.error(
                            `❌ Back image download failed: ${backError.message}`,
                        );
                        stats.errors.push({
                            index,
                            gradingId,
                            type: "Back Image Download",
                            error: backError.message,
                            url: backImageUrl.substring(0, 100),
                        });
                    }
                } else {
                    console.log(
                        `⚠️  No valid back image URL (${backImageUrl || "undefined"})`,
                    );
                    stats.backImages.skipped++;
                }

                // Update metadata with local file paths
                try {
                    console.log(`🔄 Updating metadata with local paths...`);

                    // Update front image references
                    if (frontResult.success && frontResult.filepath) {
                        outputData[index].image = frontResult.filepath;
                        outputData[index].animation_url = frontResult.filepath;

                        // Update front image attribute
                        const frontAttr = outputData[index].attributes.find(
                            (attr) => attr.trait_type === "Front Image",
                        );
                        if (frontAttr) {
                            frontAttr.value = frontResult.filepath;
                        }
                    }

                    // Update back image reference
                    if (backResult.success && backResult.filepath) {
                        const backAttr = outputData[index].attributes.find(
                            (attr) => attr.trait_type === "Back Image",
                        );
                        if (backAttr) {
                            backAttr.value = backResult.filepath;
                        }
                    }

                    // Update properties.files array safely
                    if (!outputData[index].properties) {
                        outputData[index].properties = {};
                    }

                    const files = [];
                    if (frontResult.success && frontResult.filepath) {
                        files.push({
                            uri: frontResult.filepath,
                            type: "image/jpeg",
                            size: frontResult.size || 0,
                        });
                    }
                    if (backResult.success && backResult.filepath) {
                        files.push({
                            uri: backResult.filepath,
                            type: "image/jpeg",
                            size: backResult.size || 0,
                        });
                    }

                    outputData[index].properties.files = files;

                    if (itemSuccess) {
                        stats.successful++;
                    } else {
                        stats.failed++;
                    }

                    const processingTime = (
                        (Date.now() - itemStartTime) /
                        1000
                    ).toFixed(2);
                    console.log(
                        `✅ Item ${index + 1} processed in ${processingTime}s`,
                    );
                } catch (updateError) {
                    console.error(
                        `❌ Error updating metadata for item ${index + 1}: ${updateError.message}`,
                    );
                    stats.errors.push({
                        index,
                        gradingId,
                        type: "Metadata Update",
                        error: updateError.message,
                    });
                    stats.failed++;
                }
            } catch (itemError) {
                console.error(
                    `❌ Critical error processing item ${index + 1}: ${itemError.message}`,
                );
                stats.errors.push({
                    index,
                    gradingId: `item_${index}`,
                    type: "Item Processing",
                    error: itemError.message,
                });
                stats.failed++;

                // Preserve original item even if processing failed
                outputData[index] = inputData[index];
            }
        }

        // Write results and generate comprehensive report
        console.log("\n📊 ===== PROCESSING COMPLETE =====");

        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const successRate = ((stats.successful / stats.total) * 100).toFixed(1);

        console.log(`⏱️  Total processing time: ${processingTime} seconds`);
        console.log(`📈 Success rate: ${successRate}%`);
        console.log(`\n📋 DETAILED STATISTICS:`);
        console.log(`   📊 Total items: ${stats.total}`);
        console.log(`   ✅ Successfully processed: ${stats.successful}`);
        console.log(`   ❌ Failed to process: ${stats.failed}`);
        console.log(`   ⏭️  Skipped: ${stats.skipped}`);
        console.log(`\n🖼️  IMAGE DOWNLOAD RESULTS:`);
        console.log(
            `   📸 Front Images - Success: ${stats.frontImages.success}, Failed: ${stats.frontImages.failed}, Skipped: ${stats.frontImages.skipped}`,
        );
        console.log(
            `   📸 Back Images - Success: ${stats.backImages.success}, Failed: ${stats.backImages.failed}, Skipped: ${stats.backImages.skipped}`,
        );

        // Write output file with error handling
        try {
            // Ensure output directory exists
            const outputDir = outputFile.substring(
                0,
                outputFile.lastIndexOf("/"),
            );
            if (outputDir && !existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
                console.log(`📁 Created output directory: ${outputDir}`);
            }

            writeFileSync(outputFile, JSON.stringify(outputData, null, 2));

            const outputStats = statSync(outputFile);
            const outputSizeKB = (outputStats.size / 1024).toFixed(2);

            console.log(
                `\n✅ Successfully wrote ${outputData.length} items to: ${outputFile}`,
            );
            console.log(`📊 Output file size: ${outputSizeKB} KB`);
        } catch (writeError) {
            throw new Error(
                `Failed to write output file: ${writeError.message}`,
            );
        }

        // Write error report if there were any errors
        if (stats.errors.length > 0) {
            const errorFile = "data/download_errors.json";
            try {
                const errorReport = {
                    timestamp: new Date().toISOString(),
                    totalErrors: stats.errors.length,
                    processingStats: stats,
                    errors: stats.errors,
                };

                writeFileSync(errorFile, JSON.stringify(errorReport, null, 2));
                console.log(
                    `\n⚠️  ${stats.errors.length} errors occurred during processing`,
                );
                console.log(`📝 Error details saved to: ${errorFile}`);

                // Show summary of error types
                const errorTypes = {};
                stats.errors.forEach((error) => {
                    errorTypes[error.type] = (errorTypes[error.type] || 0) + 1;
                });

                console.log(`📊 Error breakdown:`);
                Object.entries(errorTypes).forEach(([type, count]) => {
                    console.log(`   ${type}: ${count}`);
                });
            } catch (errorWriteError) {
                console.error(
                    `❌ Could not write error report: ${errorWriteError.message}`,
                );
            }
        }

        console.log(`\n🎉 Image download process completed!`);
        console.log(`📁 Downloaded images saved to: ./images`);
        console.log(`📄 Updated metadata saved to: ${outputFile}`);

        return {
            success: true,
            stats,
            processingTime: parseFloat(processingTime),
            outputFile,
        };
    } catch (error) {
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

        console.error(`\n💥 ===== CRITICAL ERROR =====`);
        console.error(`❌ Error: ${error.message}`);
        console.error(`⏱️  Failed after: ${processingTime} seconds`);
        console.error(`📅 Error time: ${new Date().toISOString()}`);

        if (error.stack) {
            console.error(`\n📍 Stack Trace:`);
            console.error(error.stack);
        }

        console.error(`\n🔧 TROUBLESHOOTING TIPS:`);
        console.error(`   1. Check if input file exists and is valid JSON`);
        console.error(`   2. Verify internet connection for image downloads`);
        console.error(
            `   3. Ensure sufficient disk space in ./images directory`,
        );
        console.error(
            `   4. Check file permissions for input/output directories`,
        );
        console.error(`   5. Validate image URLs are accessible`);

        throw error;
    }
};

// Execute the main process
(async () => {
    console.log("🚀 Downloading images...\n");

    const config = loadConfig();
    const stepId = "4";

    // Update status to running
    updateStatus(stepId, "running", "Image Downloading started");

    try {
        const inputFile = config.pipeline.steps[stepId - 1].inputs.inputFile;
        const outputFile = config.pipeline.steps[stepId - 1].outputs.outputFile;

        await processImageDownloads(inputFile, outputFile);
        updateStatus(stepId, "completed", `Successfully downloaded all images`);
    } catch (error) {
        console.error(`\n💀 FATAL ERROR - Process terminating`, error);
        updateStatus(stepId, "failed", error.message);
        process.exit(1); // Error exit code
    }
})();
