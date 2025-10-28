import { createReadStream, writeFileSync, readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import path from "path";
const require = createRequire(import.meta.url);
import { loadConfig, updateStatus } from "./utils.js";

// Read CSV file and convert to JSON
async function csvToJson(filePath) {
    const csv = require("csv-parser");
    // const {csv} = await import('csv-parser');

    return new Promise((resolve, reject) => {
        const results = [];

        createReadStream(filePath)
            .pipe(csv())
            .on("data", (data) => results.push(data))
            .on("end", () => resolve(results))
            .on("error", (error) => reject(error));
    });
}

const findDuplicates = (fileName) => {
    try {
        // Check if file exists
        if (!existsSync(fileName)) {
            throw new Error(`File not found: ${fileName}`);
        }

        const inputData = JSON.parse(readFileSync(fileName, "utf8"));

        // Validate that inputData is an array
        if (!Array.isArray(inputData)) {
            throw new Error(`Expected array data, but got ${typeof inputData}`);
        }

        if (inputData.length === 0) {
            console.warn("Input data is empty");
            return 0;
        }

        // Validate that required fields exist in the data
        const sampleItem = inputData[0];
        if (!sampleItem.hasOwnProperty("Title")) {
            throw new Error('Required field "Title" not found in data');
        }
        if (!sampleItem.hasOwnProperty("Grade")) {
            throw new Error('Required field "Grade" not found in data');
        }

        // Find duplicates by combining Title and Grade
        const duplicates = findDuplicatesByFields(inputData, "Title", "Grade");
        const duplicateKeys = Object.keys(duplicates);

        // Log detailed duplicate information
        if (duplicateKeys.length > 0) {
            console.log("\n=== DUPLICATE ANALYSIS ===");
            duplicateKeys.forEach((key) => {
                const items = duplicates[key];
                console.log(`\nDuplicate found: ${key}`);
                console.log(`  Count: ${items.length}`);
                console.log(
                    `  Serials: ${items.map((item) => item.Serial || "N/A").join(", ")}`,
                );
            });
            console.log("==========================\n");
        }

        return duplicateKeys.length;
    } catch (error) {
        console.error(
            `Error finding duplicates in ${fileName}:`,
            error.message,
        );
        throw error;
    }
};

// Find duplicates by combining Title and Grade fields
// This ensures that cards with same title but different grades are not considered duplicates
function findDuplicatesByFields(arr, field1, field2) {
    try {
        if (!Array.isArray(arr)) {
            throw new Error("Input must be an array");
        }

        const grouped = arr.reduce((acc, obj, index) => {
            // Validate object structure
            if (!obj || typeof obj !== "object") {
                console.warn(`Invalid object at index ${index}, skipping`);
                return acc;
            }

            // Get field values with fallback
            const value1 = obj[field1];
            const value2 = obj[field2];

            // Skip items with missing required fields
            if (value1 === undefined || value1 === null || value1 === "") {
                console.warn(
                    `Missing or empty ${field1} at index ${index}, skipping`,
                );
                return acc;
            }
            if (value2 === undefined || value2 === null || value2 === "") {
                console.warn(
                    `Missing or empty ${field2} at index ${index}, skipping`,
                );
                return acc;
            }

            // Create composite key by combining Title and Grade
            // Normalize strings to handle case differences and extra whitespace
            const normalizedValue1 = String(value1).trim();
            const normalizedValue2 = String(value2).trim();
            const key = `${normalizedValue1} | ${normalizedValue2}`;

            if (!acc[key]) acc[key] = [];
            acc[key].push({
                ...obj,
                _originalIndex: index,
            });
            return acc;
        }, {});

        // Filter out groups with only one item (not duplicates)
        const duplicates = {};
        Object.keys(grouped).forEach((key) => {
            if (grouped[key].length > 1) {
                duplicates[key] = grouped[key];
            }
        });

        return duplicates;
    } catch (error) {
        console.error("Error in findDuplicatesByFields:", error.message);
        throw error;
    }
}

(async () => {
    console.log("🚀 Starting CSV to JSON conversion process...\n");

    const config = loadConfig();
    const stepId = "1";

    // Update status to running
    updateStatus(stepId, "running", "CSV to JSON conversion started");

    try {
        // Get file paths from config
        const inputCsvFile =
            config.pipeline.steps[stepId - 1].inputs.inputCsvFile;
        const outputJsonFile =
            config.pipeline.steps[stepId - 1].outputs.outputJsonFile;

        console.log(`📂 Input file: ${inputCsvFile}`);
        console.log(`📂 Output file: ${outputJsonFile}`);

        // Check if input CSV file exists
        if (!existsSync(inputCsvFile)) {
            throw new Error(`Input CSV file not found: ${inputCsvFile}`);
        }

        console.log(`📂 Reading CSV file: ${inputCsvFile}`);

        // Convert the CSV to JSON
        const jsonData = await csvToJson(inputCsvFile);

        // Validate converted data
        if (!Array.isArray(jsonData)) {
            throw new Error("CSV conversion did not produce an array");
        }

        if (jsonData.length === 0) {
            throw new Error("CSV file is empty or contains no valid data");
        }

        console.log(
            `✅ CSV conversion successful: ${jsonData.length} items processed`,
        );

        // Log sample data structure for verification
        console.log("\n📋 Sample data structure:");
        const sampleItem = jsonData[0];
        const keys = Object.keys(sampleItem);
        console.log(`   Fields found: ${keys.join(", ")}`);
        if (keys.includes("Title") && keys.includes("Grade")) {
            console.log(`   ✅ Required fields (Title, Grade) are present`);
        } else {
            console.warn(
                `   ⚠️  Missing required fields. Found: ${keys.join(", ")}`,
            );
        }

        // Save to JSON file
        console.log(`\n💾 Saving JSON to: ${outputJsonFile}`);
        writeFileSync(outputJsonFile, JSON.stringify(jsonData, null, 2));
        console.log("✅ JSON file saved successfully");

        // Find Duplicates with enhanced logic
        console.log(
            "\n🔍 Analyzing duplicates by Title + Grade combination...",
        );
        const numberOfDuplicates = findDuplicates(outputJsonFile);

        if (numberOfDuplicates === 0) {
            console.log("🎉 No duplicates found! Data looks clean.");
        } else {
            console.log(`⚠️  Found ${numberOfDuplicates} duplicate groups`);
            console.log(
                "📝 Review the duplicate analysis above to ensure they are intentional",
            );
            console.log(
                "💡 Tip: Duplicates are identified by matching both Title AND Grade",
            );
        }

        // Summary
        console.log("\n📊 SUMMARY:");
        console.log(`   Total items: ${jsonData.length}`);
        console.log(`   Duplicate groups: ${numberOfDuplicates}`);
        console.log(`   Output file: ${outputJsonFile}`);
        console.log("\n✨ Process completed successfully!");

        // Update status to completed
        updateStatus(
            stepId,
            "completed",
            `Successfully processed ${jsonData.length} items with ${numberOfDuplicates} duplicate groups`,
        );
    } catch (error) {
        console.error("\n❌ Error occurred during processing:");
        console.error(`   ${error.message}`, error);
        console.error("\n🔧 Troubleshooting tips:");
        console.error("   • Ensure the CSV file exists and is readable");
        console.error("   • Check CSV format and encoding");
        console.error(
            "   • Verify required columns (Title, Grade) are present",
        );
        console.error("   • Ensure sufficient disk space for output file");

        // Update status to failed
        updateStatus(stepId, "failed", error.message);

        // Log full error in development
        if (process.env.NODE_ENV === "development") {
            console.error("\nFull error details:", error);
        }

        process.exit(1);
    }
})();
