import axios from "axios";
import {
    existsSync,
    mkdirSync,
    createWriteStream,
    unlinkSync,
    readFileSync,
    writeFileSync,
} from "fs";
import { loadConfig, updateStatus } from "./utils.js";
import { join } from "path";

function sanitizeFilename(fileName, options = {}) {
    const {
        replacement = "-",
        maxLength = 255,
        removeAccents = true,
        lowercase = false,
        preserveExtension = true,
        allowUnicode = true,
        trim = true,
    } = options;

    if (!fileName || typeof fileName !== "string") {
        return "unnamed-file";
    }

    let sanitized = fileName;

    // Trim whitespace
    if (trim) {
        sanitized = sanitized.trim();
    }

    // Remove accents/diacritics
    if (removeAccents) {
        sanitized = sanitized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    // Convert to lowercase if requested
    if (lowercase) {
        sanitized = sanitized.toLowerCase();
    }

    // Preserve file extension
    let extension = "";
    if (preserveExtension) {
        const lastDotIndex = sanitized.lastIndexOf(".");
        if (lastDotIndex > 0 && lastDotIndex < sanitized.length - 1) {
            const potentialExtension = sanitized.slice(lastDotIndex);
            // Basic extension validation (1-10 characters after dot)
            if (/^\.[a-zA-Z0-9]{1,10}$/.test(potentialExtension)) {
                extension = potentialExtension;
                sanitized = sanitized.slice(0, lastDotIndex);
            }
        }
    }

    // Define unsafe characters pattern
    const unsafeCharsPattern = allowUnicode
        ? /[<>:"/\\|?*[\]{}%#&+=~`!@$^',();\s]/g
        : /[^a-zA-Z0-9\u00C0-\u017F\._-]/g;

    // Replace unsafe characters
    sanitized = sanitized
        .replace(unsafeCharsPattern, replacement)
        // Replace multiple consecutive replacement characters with single one
        .replace(new RegExp(`\\${replacement}+`, "g"), replacement)
        // Remove leading/trailing replacement characters
        .replace(new RegExp(`^\\${replacement}+|\\${replacement}+$`, "g"), "");

    // Truncate if too long
    const maxNameLength = maxLength - extension.length;
    if (sanitized.length > maxNameLength) {
        sanitized = sanitized.substring(0, maxNameLength);

        // Ensure we don't end with a replacement character after truncation
        if (sanitized.endsWith(replacement)) {
            sanitized = sanitized.slice(0, -replacement.length);
        }
    }

    // Handle case where everything was removed
    if (!sanitized) {
        sanitized = "file";
    }

    return sanitized + extension;
}

// Some metadata sanitization to ensure all required fields are present
const sanitizeMetadataJson = (
    inputFile,
    outPutFile,
    failedFile,
    reportFile,
) => {
    console.log(`🧹 Starting metadata sanitization process...`);
    console.log(`📂 Input file: ${inputFile}`);
    console.log(`📂 Output file: ${outPutFile}`);
    console.log(`📂 Output file: ${failedFile}`);
    console.log(`📂 Output file: ${reportFile}`);

    let rawData, items;
    const sanitizedItems = [];
    const failedSerials = [];
    const errorDetails = {
        fileRead: 0,
        jsonParse: 0,
        validation: 0,
        fileWrite: 0,
    };

    // Read and parse JSON file with error handling
    try {
        console.log(`📖 Reading metadata from file: ${inputFile}`);
        rawData = readFileSync(inputFile, "utf8");
        console.log(
            `✅ Successfully read ${rawData.length} characters from file`,
        );
    } catch (error) {
        errorDetails.fileRead++;
        console.error(`❌ Failed to read input file: ${inputFile}`);
        console.error(`📋 File read error details:`, error.message);
        throw new Error(`Failed to read input file: ${error.message}`);
    }

    try {
        console.log(`🔄 Parsing JSON data...`);
        items = JSON.parse(rawData);

        if (!Array.isArray(items)) {
            throw new Error(
                "❌ JSON data is not an array. Expected an array of metadata objects.",
            );
        }

        console.log(
            `✅ Successfully parsed JSON. Found ${items.length} items to process`,
        );
    } catch (error) {
        errorDetails.jsonParse++;
        console.error(`❌ Failed to parse JSON from file: ${inputFile}`);
        console.error(`📋 JSON parse error details:`, error.message);

        if (error instanceof SyntaxError) {
            console.error(
                `📋 This appears to be a JSON syntax error. Please validate the JSON format.`,
            );
        }

        throw new Error(`Failed to parse JSON: ${error.message}`);
    }

    console.log(`🔍 Starting validation of ${items.length} metadata items...`);
    let processedCount = 0;
    const validationErrors = {
        missingFields: [],
        missingTraits: [],
        invalidProperties: [],
        processingErrors: [],
    };

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        processedCount++;

        try {
            // Show progress every 100 items or for the last item
            if (processedCount % 100 === 0 || processedCount === items.length) {
                console.log(
                    `📊 Progress: ${processedCount}/${items.length} (${Math.round((processedCount / items.length) * 100)}%)`,
                );
            }

            // Safely extract grading ID with error handling
            let gradingId = "unknown";
            let fileName = "unknown-item";

            try {
                if (item.attributes && Array.isArray(item.attributes)) {
                    const gradingIdAttr = item.attributes.find(
                        (attr) => attr && attr.trait_type === "Grading ID",
                    );
                    gradingId = gradingIdAttr?.value || `item-${i + 1}`;
                } else {
                    gradingId = `item-${i + 1}`;
                }
                fileName = sanitizeFilename(
                    `${item.name || "unnamed"}-${gradingId}-front`,
                );
            } catch (error) {
                console.warn(
                    `⚠️  Warning: Could not extract grading ID for item ${i + 1}:`,
                    error.message,
                );
                fileName = `item-${i + 1}`;
                gradingId = `item-${i + 1}`;
            }

            // Validate required top-level fields
            const requiredFields = [
                "name",
                "description",
                "image",
                "animation_url",
                "external_url",
                "attributes",
                "properties",
            ];
            const missingFields = requiredFields.filter(
                (field) => !item[field],
            );

            if (missingFields.length > 0) {
                const errorMsg = `Item ${fileName} (index: ${i + 1}) is missing required fields: ${missingFields.join(", ")}`;
                console.log(`❌ ${errorMsg}`);
                validationErrors.missingFields.push({
                    fileName,
                    index: i + 1,
                    missing: missingFields,
                });
                failedSerials.push({
                    serial: fileName,
                    reason: `Missing fields: ${missingFields.join(", ")}`,
                    index: i + 1,
                });
                continue;
            }

            // Validate attributes array and required traits
            try {
                if (!Array.isArray(item.attributes)) {
                    throw new Error("Attributes field is not an array");
                }

                const requiredTraits = [
                    "Front Image",
                    "Back Image",
                    "Serial Number",
                    "Type",
                    "Category",
                    "Year",
                    "Vault1",
                    "Vault2",
                    "Vault1 Location",
                    "Vault2 Location",
                    "Vault1 ID",
                    "Vault2 ID",
                    "Grading ID",
                    "Grading Company",
                    "Autographed",
                    "The Grade",
                    "GradeNum",
                ];
                const itemTraits = item.attributes
                    .filter(
                        (attr) =>
                            attr && typeof attr === "object" && attr.trait_type,
                    )
                    .map((attr) => attr.trait_type);

                const missingTraits = requiredTraits.filter(
                    (trait) => !itemTraits.includes(trait),
                );

                if (missingTraits.length > 0) {
                    const errorMsg = `Item ${fileName} (index: ${i + 1}) is missing traits: ${missingTraits.join(", ")}`;
                    console.log(`❌ ${errorMsg}`);
                    validationErrors.missingTraits.push({
                        fileName,
                        index: i + 1,
                        missing: missingTraits,
                    });
                    failedSerials.push({
                        serial: fileName,
                        reason: `Missing traits: ${missingTraits.join(", ")}`,
                        index: i + 1,
                    });
                    continue;
                }
            } catch (error) {
                const errorMsg = `Item ${fileName} (index: ${i + 1}) has invalid attributes: ${error.message}`;
                console.log(`❌ ${errorMsg}`);
                validationErrors.missingTraits.push({
                    fileName,
                    index: i + 1,
                    error: error.message,
                });
                failedSerials.push({
                    serial: fileName,
                    reason: `Invalid attributes: ${error.message}`,
                    index: i + 1,
                });
                continue;
            }

            // Validate properties.files array
            try {
                if (!item.properties || typeof item.properties !== "object") {
                    throw new Error(
                        "Properties field is missing or not an object",
                    );
                }

                if (
                    !Array.isArray(item.properties.files) ||
                    item.properties.files.length === 0
                ) {
                    throw new Error(
                        "Properties.files is not an array or is empty",
                    );
                }

                const invalidFiles = item.properties.files.filter(
                    (file, fileIndex) => {
                        if (!file || typeof file !== "object") {
                            console.warn(
                                `⚠️  File at index ${fileIndex} is not an object`,
                            );
                            return true;
                        }
                        if (!file.uri || !file.type) {
                            console.warn(
                                `⚠️  File at index ${fileIndex} missing uri or type`,
                            );
                            return true;
                        }
                        return false;
                    },
                );

                if (invalidFiles.length > 0) {
                    throw new Error(
                        `${invalidFiles.length} files have missing uri or type properties`,
                    );
                }
            } catch (error) {
                const errorMsg = `Item ${fileName} (index: ${i + 1}) has invalid properties: ${error.message}`;
                console.log(`❌ ${errorMsg}`);
                validationErrors.invalidProperties.push({
                    fileName,
                    index: i + 1,
                    error: error.message,
                });
                failedSerials.push({
                    serial: fileName,
                    reason: `Invalid properties: ${error.message}`,
                    index: i + 1,
                });
                continue;
            }

            // If all checks pass, add to sanitized items
            sanitizedItems.push(item);
        } catch (itemError) {
            // Catch any unexpected errors during item processing
            const errorMsg = `Unexpected error processing item ${i + 1}: ${itemError.message}`;
            console.error(`❌ ${errorMsg}`);
            validationErrors.processingErrors.push({
                index: i + 1,
                error: itemError.message,
            });
            failedSerials.push({
                serial: `item-${i + 1}`,
                reason: `Processing error: ${itemError.message}`,
                index: i + 1,
            });
            errorDetails.validation++;
        }
    }

    console.log(`\n📊 Validation Summary:`);
    console.log(`✅ Successfully validated: ${sanitizedItems.length} items`);
    console.log(`❌ Failed validation: ${failedSerials.length} items`);
    console.log(
        `📈 Success rate: ${Math.round((sanitizedItems.length / items.length) * 100)}%`,
    );

    // Display error category breakdown
    if (
        Object.keys(validationErrors).some(
            (key) => validationErrors[key].length > 0,
        )
    ) {
        console.log(`\n🔍 Error Breakdown:`);
        if (validationErrors.missingFields.length > 0) {
            console.log(
                `   📋 Missing required fields: ${validationErrors.missingFields.length} items`,
            );
        }
        if (validationErrors.missingTraits.length > 0) {
            console.log(
                `   🏷️  Missing required traits: ${validationErrors.missingTraits.length} items`,
            );
        }
        if (validationErrors.invalidProperties.length > 0) {
            console.log(
                `   📁 Invalid properties: ${validationErrors.invalidProperties.length} items`,
            );
        }
        if (validationErrors.processingErrors.length > 0) {
            console.log(
                `   ⚠️  Processing errors: ${validationErrors.processingErrors.length} items`,
            );
        }
    }

    // Write failed items to JSON file with error handling
    try {
        const failedOutputPath = failedFile;
        console.log(`\n💾 Saving failed items to: ${failedOutputPath}`);
        writeFileSync(failedOutputPath, JSON.stringify(failedSerials, null, 2));
        console.log(
            `✅ Successfully saved ${failedSerials.length} failed items details`,
        );

        // Save detailed validation report
        const validationReportPath = reportFile;
        const validationReport = {
            timestamp: new Date().toISOString(),
            inputFile,
            outputFile: outPutFile,
            totalItems: items.length,
            successfulItems: sanitizedItems.length,
            failedItems: failedSerials.length,
            successRate: Math.round(
                (sanitizedItems.length / items.length) * 100,
            ),
            errorBreakdown: validationErrors,
            errorDetails,
        };

        writeFileSync(
            validationReportPath,
            JSON.stringify(validationReport, null, 2),
        );
        console.log(
            `📊 Detailed validation report saved to: ${validationReportPath}`,
        );
    } catch (error) {
        errorDetails.fileWrite++;
        console.error(`❌ Failed to save failed items file:`, error.message);
        console.warn(
            `⚠️  Continuing with sanitized data write despite failed items save error`,
        );
    }

    // Write sanitized items to output file with error handling
    try {
        console.log(`\n💾 Saving sanitized metadata to: ${outPutFile}`);

        // Create output directory if needed
        const outputDir = outPutFile.substring(0, outPutFile.lastIndexOf("/"));
        if (outputDir && !existsSync(outputDir)) {
            console.log(`📁 Creating output directory: ${outputDir}`);
            mkdirSync(outputDir, { recursive: true });
        }

        writeFileSync(outPutFile, JSON.stringify(sanitizedItems, null, 2));
        console.log(
            `✅ Successfully saved ${sanitizedItems.length} sanitized items`,
        );
    } catch (error) {
        errorDetails.fileWrite++;
        console.error(
            `❌ Critical error: Failed to write sanitized data to output file:`,
            error.message,
        );
        throw new Error(`Failed to write output file: ${error.message}`);
    }

    console.log(`\n🎉 Metadata sanitization completed successfully!`);
    console.log(
        `📊 Final statistics: ${sanitizedItems.length}/${items.length} items passed validation`,
    );

    return {
        totalItems: items.length,
        successfulItems: sanitizedItems.length,
        failedItems: failedSerials.length,
        successRate: Math.round((sanitizedItems.length / items.length) * 100),
        errorDetails,
    };
};

const start = async (inputFile, outputFile, failedFile, reportFile) => {
    console.log(
        `🚀 Starting metadata sanitization script at ${new Date().toISOString()}`,
    );

    try {
        const result = sanitizeMetadataJson(
            inputFile,
            outputFile,
            failedFile,
            reportFile,
        );

        console.log(`\n🏁 Script completed successfully!`);
        console.log(
            `📊 Summary: ${result.successfulItems}/${result.totalItems} items processed (${result.successRate}% success rate)`,
        );

        if (result.failedItems > 0) {
            console.log(
                `⚠️  ${result.failedItems} items failed validation - check data/99_failed-psa.json for details`,
            );
            console.log(`📋 Detailed report available at: ${failedFile}`);
        }
    } catch (error) {
        console.error(`\n💥 Critical error during metadata sanitization:`);
        console.error(`📋 Error type: ${error.constructor.name}`);
        console.error(`📋 Error message: ${error.message}`);
        console.error(`📋 Timestamp: ${new Date().toISOString()}`);

        if (error.stack) {
            console.error(`📋 Stack trace:`, error.stack);
        }

        console.error(`\n🔧 Troubleshooting tips:`);
        console.error(`   1. Verify that the input file exists: ${inputFile}`);
        console.error(`   2. Check that the input file contains valid JSON`);
        console.error(
            `   3. Ensure you have write permissions to the data/ directory`,
        );
        console.error(
            `   4. Verify the JSON structure matches expected metadata format`,
        );
    }
};

(async () => {
    console.log("🚀 Sanitizing generated metadata...\n");

    const config = loadConfig();
    const stepId = "3";

    // Update status to running
    updateStatus(stepId, "running", "CSV to JSON conversion started");
    try {
        const inputFile = config.pipeline.steps[stepId - 1].inputs.inputFile;
        const outputFile = config.pipeline.steps[stepId - 1].outputs.outputFile;
        const failedFile = config.pipeline.steps[stepId - 1].outputs.failedFile;
        const reportFile = config.pipeline.steps[stepId - 1].outputs.reportFile;

        start(inputFile, outputFile, failedFile, reportFile);
        updateStatus(stepId, "completed", `Successfully santized metadata`);
    } catch (error) {
        console.error(`\n💀 FATAL ERROR - Process terminating`, error);
        updateStatus(stepId, "failed", error.message);
        process.exit(1); // Error exit code
    }
})();
