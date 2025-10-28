import {
    createReadStream,
    writeFileSync,
    readFileSync,
    existsSync,
    statSync,
} from "fs";

import path from "path";
import { loadConfig, updateStatus } from "./utils.js";

// Validate required data fields for processing
const validateItemData = (item, index) => {
    const errors = [];

    if (!item.Serial) errors.push(`Missing Serial at index ${index}`);
    if (!item.Title) errors.push(`Missing Title at index ${index}`);
    if (!item.Grade) errors.push(`Missing Grade at index ${index}`);
    if (!item.Category) errors.push(`Missing Category at index ${index}`);

    return errors;
};

// Function which finds the pokemon from the dataFile using serial and grading company
const fetchMetadata = (inputSerial, inputGradingCompany, dataFile) => {
    try {
        // Validate input parameters
        if (!inputSerial) {
            throw new Error("Input serial is required");
        }
        if (!inputGradingCompany) {
            throw new Error("Grading company is required");
        }
        if (!dataFile) {
            throw new Error("Data file path is required");
        }

        // Check if data file exists
        if (!existsSync(dataFile)) {
            throw new Error(`Data file not found: ${dataFile}`);
        }

        console.log(
            `🔍 Searching for Serial ${inputSerial} (${inputGradingCompany}) in ${dataFile}`,
        );

        // Read and parse the data file with error handling
        let data;
        try {
            const fileContent = readFileSync(dataFile, "utf8");
            if (!fileContent.trim()) {
                throw new Error("Data file is empty");
            }
            data = JSON.parse(fileContent);
        } catch (parseError) {
            throw new Error(
                `Failed to parse JSON from ${dataFile}: ${parseError.message}`,
            );
        }

        // Validate data structure
        if (!Array.isArray(data)) {
            throw new Error(
                `Data file must contain an array, got ${typeof data}`,
            );
        }

        if (data.length === 0) {
            console.warn(`⚠️  Data file ${dataFile} is empty`);
            return null;
        }

        console.log(`📊 Loaded ${data.length} records from data file`);

        // Find all items matching the serial
        const matchedItems = data.filter((item) => {
            try {
                return (
                    item &&
                    item.serial &&
                    item.serial.toString() === inputSerial.toString()
                );
            } catch (error) {
                console.warn(
                    `⚠️  Error comparing serial for item:`,
                    error.message,
                );
                return false;
            }
        });

        console.log(
            `🔍 Found ${matchedItems.length} items with matching serial ${inputSerial}`,
        );

        if (matchedItems.length === 0) {
            console.log(`❌ No items found with serial ${inputSerial}`);
            return null; // No match found
        }

        // From the matched items, find the one matching the grading company
        const finalMatch = matchedItems.find((item) => {
            try {
                const { gradingCompany } = parseCardTitle(item.title);
                console.log(
                    `   - Item Title: "${item.title}" => Extracted Company: ${gradingCompany}`,
                );

                // Find Grading company from the Title.
                if (!gradingCompany || typeof gradingCompany !== "string") {
                    console.warn(
                        `⚠️  Invalid grading company field for item with serial ${inputSerial}`,
                    );
                    return false;
                }

                if (
                    gradingCompany.toUpperCase() ===
                    inputGradingCompany.toUpperCase()
                ) {
                    return true;
                }
            } catch (error) {
                console.error(
                    `❌ Error matching grading company for serial ${inputSerial}:`,
                    error.message,
                );
                return false;
            }
        });

        if (finalMatch) {
            console.log(
                `✅ Found matching item for Serial ${inputSerial} with ${inputGradingCompany}`,
            );

            // Validate the found item has required fields
            if (
                !finalMatch.images ||
                !Array.isArray(finalMatch.images) ||
                finalMatch.images.length === 0
            ) {
                console.warn(
                    `⚠️  Found item for Serial ${inputSerial} but it has no images`,
                );
                return null;
            }

            return finalMatch;
        } else {
            console.log(
                `❌ No items found for Serial ${inputSerial} with grading company ${inputGradingCompany}`,
            );
            return null;
        }
    } catch (error) {
        console.error(
            `❌ Error in fetchMetadata for Serial ${inputSerial}:`,
            error.message,
        );
        throw error; // Re-throw to be handled by caller
    }
};

// Generates Metadata
const generateMetadata = async (
    inputFileName,
    dataFileName,
    outputFileName,
    failedPsaFileName,
) => {
    console.log(`\n🚀 Starting metadata generation process...`);
    console.log(`📂 Input file: ${inputFileName}`);
    console.log(`📝 Output file: ${outputFileName}`);
    console.log(`⚠️  Failed items file: ${failedPsaFileName}\n`);

    // Validate input file exists
    if (!existsSync(inputFileName)) {
        throw new Error(`Input file not found: ${inputFileName}`);
    }

    let inputData;
    try {
        const fileContent = readFileSync(inputFileName, "utf8");
        inputData = JSON.parse(fileContent);
    } catch (error) {
        throw new Error(`Failed to read or parse input file: ${error.message}`);
    }

    // Validate input data
    if (!Array.isArray(inputData)) {
        throw new Error(`Input data must be an array, got ${typeof inputData}`);
    }

    if (inputData.length === 0) {
        throw new Error("Input data is empty");
    }

    console.log(
        `✅ Successfully loaded ${inputData.length} items from input file`,
    );

    const failedSerials = [];
    const outputData = [];
    const processingStats = {
        total: inputData.length,
        processed: 0,
        successful: 0,
        failed: 0,
        psaSuccess: 0,
        psaFallback: 0,
        nonPsaSuccess: 0,
        validationErrors: 0,
    };

    console.log(`\n📊 Processing ${processingStats.total} items...\n`);

    // for (let index = 0; index < 2; index++) {
    for (let index = 0; index < inputData.length; index++) {
        const item = inputData[index];
        processingStats.processed++;

        console.log(`\n🔄 Processing item ${index + 1}/${inputData.length}`);
        console.log(`📋 Serial: ${item.Serial || "N/A"}`);
        console.log(
            `🏷️  Title: ${item.Title ? item.Title.substring(0, 50) + "..." : "N/A"}`,
        );

        // Validate item data
        const validationErrors = validateItemData(item, index);
        if (validationErrors.length > 0) {
            console.error(`❌ Validation failed for item ${index + 1}:`);
            validationErrors.forEach((error) => console.error(`   • ${error}`));
            failedSerials.push({
                serial: item.Serial || `index_${index}`,
                reason: "Validation failed",
                errors: validationErrors,
            });
            processingStats.validationErrors++;
            continue;
        }

        // Safely extract card name with error handling - CRITICAL PARSING
        let gradingCompany, gradeScore, grade;

        try {
            console.log(`🔍 Parsing title: "${item.Title}"`);
            const gradeDetails = parseCardTitle(item.Title);

            gradingCompany = gradeDetails.gradingCompany;
            gradeScore = gradeDetails.gradeScore;
            grade = gradeDetails.grade;

            // CRITICAL: Validate that parsing was successful
            if (!gradingCompany || gradingCompany === null) {
                throw new Error(
                    `PARSING FAILED: Could not extract grading company from title "${item.Title}"`,
                );
            }

            if (!gradeScore || gradeScore === null) {
                throw new Error(
                    `PARSING FAILED: Could not extract grade score from title "${item.Title}"`,
                );
            }

            if (!grade || grade === null) {
                throw new Error(
                    `PARSING FAILED: Could not extract grade from title "${item.Title}"`,
                );
            }

            console.log(`✅ Parsing successful:`);
            console.log(`   📛 Name: ${item.Title}`);
            console.log(`   🏢 Company: ${gradingCompany}`);
            console.log(`   🔢 Grade Score: ${gradeScore}`);
            console.log(`   ⭐ Grade: ${grade}`);
        } catch (parseError) {
            console.error(`\n💥 CRITICAL PARSING ERROR 💥`);
            console.error(`❌ Failed to parse title for item ${index + 1}`);
            console.error(`📋 Serial: ${item.Serial}`);
            console.error(`🏷️  Title: "${item.Title}"`);
            console.error(`❌ Error: ${parseError.message}`);
            console.error(`📊 Processing Statistics at failure:`);
            console.error(
                `   - Items processed: ${processingStats.processed}/${processingStats.total}`,
            );
            console.error(`   - Successful: ${processingStats.successful}`);
            console.error(`   - Failed: ${processingStats.failed}`);
            console.error(`\n🔧 DEBUGGING INFORMATION:`);
            console.error(`   - Item Index: ${index}`);
            console.error(`   - Item Object:`, JSON.stringify(item, null, 2));
            console.error(`\n🚨 SCRIPT TERMINATED DUE TO PARSING FAILURE`);

            // Throw error to terminate the entire process
            throw new Error(
                `CRITICAL PARSING FAILURE at item ${index + 1} (Serial: ${item.Serial}): ${parseError.message}`,
            );
        }

        // Find the year from the title with validation
        let year;
        try {
            const yearMatch = item.Title.match(/\b(19|20)\d{2}\b/);
            year = yearMatch ? parseInt(yearMatch[0]) : "Unknown";
            if (year !== "Unknown" && (year < 1900 || year > 2030)) {
                console.warn(
                    `⚠️  Suspicious year detected: ${year} for Serial ${item.Serial}`,
                );
            }
        } catch (error) {
            console.warn(
                `⚠️  Error extracting year for ${item.Serial}:`,
                error.message,
            );
            year = "Unknown";
        }

        // Extract serial number safely
        let serialNumber;
        try {
            const serialMatch = item.Title.match(/#\d+/);
            serialNumber = serialMatch ? serialMatch[0] : item.Serial || "N/A";
        } catch (error) {
            console.warn(
                `⚠️  Error extracting serial number for ${item.Serial}:`,
                error.message,
            );
            serialNumber = item.Serial || "N/A";
        }

        // Initialize metadata variables
        let description,
            frontImage,
            backImage,
            fairMarketValue,
            attributes,
            properties;

        try {
            console.log(`🔍 Fetching metadata for Serial ${item.Serial}...`);
            const foundPokemonData = fetchMetadata(
                item.Serial,
                gradingCompany,
                dataFileName,
            );

            if (!foundPokemonData) {
                // If no data was found at all, record failure
                failedSerials.push({
                    serial: item.Serial,
                    reason: "No data found in data file",
                    gradingCompany: gradingCompany,
                    title: item.Title?.substring(0, 50) + "...",
                    timestamp: new Date().toISOString(),
                });
                processingStats.failed++;
                console.log(
                    `❌ No data found for Serial ${item.Serial} - added to failed list`,
                );
                continue;
            }

            // Validate found data structure
            if (
                !foundPokemonData.images ||
                !Array.isArray(foundPokemonData.images)
            ) {
                throw new Error(
                    "Found data has invalid or missing images array",
                );
            }

            if (foundPokemonData.images.length === 0) {
                throw new Error("Found data has empty images array");
            }

            if (
                foundPokemonData.price === undefined ||
                foundPokemonData.price === null
            ) {
                throw new Error("Found data has missing price field");
            }

            // Extract image URLs with validation
            frontImage = foundPokemonData.images[0];
            if (!frontImage || typeof frontImage !== "string") {
                throw new Error("Invalid front image URL");
            }

            // Validate front image URL format
            if (!frontImage.startsWith("http")) {
                console.warn(
                    `⚠️  Front image URL may be invalid: ${frontImage}`,
                );
            }

            backImage = foundPokemonData.images[1] || null;
            if (backImage && !backImage.startsWith("http")) {
                console.warn(`⚠️  Back image URL may be invalid: ${backImage}`);
            }

            fairMarketValue = foundPokemonData.price || 0;

            description =
                item.Title || `Pokemon card with serial ${item.Serial}`;
            console.log(
                `✅ Successfully extracted metadata for Serial ${item.Serial}`,
            );
            console.log(`🖼️  Front Image: ${frontImage.substring(0, 60)}...`);
            console.log(
                `🖼️  Back Image: ${backImage ? backImage.substring(0, 60) + "..." : "None"}`,
            );
        } catch (metadataError) {
            console.error(
                `❌ Error processing metadata for Serial ${item.Serial}:`,
                metadataError.message,
            );
            failedSerials.push({
                serial: item.Serial,
                reason: "Metadata processing error",
                gradingCompany: gradingCompany,
                title: item.Title?.substring(0, 50) + "...",
                error: metadataError.message,
                timestamp: new Date().toISOString(),
            });
            processingStats.failed++;
            continue;
        }
        // Construct the metadata object with validation
        try {
            console.log(
                `🔧 Constructing metadata for Serial ${item.Serial}...`,
            );

            // Prepare files array for properties
            const files = [];
            if (frontImage) {
                files.push({
                    uri: frontImage,
                    type: "image/jpg",
                });
            }
            if (backImage) {
                files.push({
                    uri: backImage,
                    type: "image/jpg",
                });
            }

            // Construct metadata with safe fallbacks
            const metadata = {
                name: item.Title,
                description:
                    description ||
                    item.Title ||
                    `Pokemon card with serial ${item.Serial}`,
                image: frontImage,
                animation_url: frontImage,
                external_url: "https://ready.cards/",
                attributes: [
                    {
                        trait_type: "Front Image",
                        value: frontImage || "N/A",
                    },
                    {
                        trait_type: "Back Image",
                        value: backImage || "N/A",
                    },
                    {
                        trait_type: "Serial Number",
                        value: serialNumber || "N/A",
                    },
                    {
                        trait_type: "Type",
                        value: "Card",
                    },
                    {
                        trait_type: "Category",
                        value: item.Category || "Unknown",
                    },
                    {
                        trait_type: "Year",
                        value: year || "Unknown",
                    },
                    {
                        trait_type: "Vault1",
                        value: "PSA",
                    },
                    {
                        trait_type: "Vault2",
                        value: "Fanatics",
                    },
                    {
                        trait_type: "Vault1 Location",
                        value: "600 Ships Landing Way New Castle, DE 19720",
                    },
                    {
                        trait_type: "Vault2 Location",
                        value: "7560 SW Durham Rd, ID 2065088 Tigard, OR 97224",
                    },
                    {
                        trait_type: "Vault1 ID",
                        value: "104740717",
                    },
                    {
                        trait_type: "Vault2 ID",
                        value: "2065088",
                    },
                    {
                        trait_type: "Grading ID",
                        value: item.Serial || "N/A",
                    },
                    {
                        trait_type: "Grading Company",
                        value: gradingCompany || "Unknown",
                    },
                    {
                        trait_type: "Autographed",
                        value: "false",
                    },
                    {
                        trait_type: "The Grade",
                        value: grade || "N/A",
                    },
                    {
                        trait_type: "GradeNum",
                        value: gradeScore || 0,
                    },
                    {
                        trait_type: "Fair Market Value",
                        value: fairMarketValue || 0,
                    },
                ],
                properties: {
                    files: files,
                    category: "image",
                },
            };

            // Validate the constructed metadata
            if (!metadata.name || !metadata.description || !metadata.image) {
                throw new Error(
                    "Metadata is missing required fields (name, description, or image)",
                );
            }

            outputData.push(metadata);
            processingStats.successful++;
            console.log(
                `✅ Metadata created and added successfully for Serial ${item.Serial}`,
            );
        } catch (constructionError) {
            console.error(
                `❌ Error constructing metadata for Serial ${item.Serial}:`,
                constructionError.message,
            );
            failedSerials.push({
                serial: item.Serial,
                reason: "Metadata construction error",
                gradingCompany: gradingCompany,
                title: item.Title?.substring(0, 50) + "...",
                error: constructionError.message,
                timestamp: new Date().toISOString(),
            });
            processingStats.failed++;
            continue;
        }
    }

    // Final processing summary
    console.log("\n📊 PROCESSING COMPLETE 📊");
    console.log(`✅ Successfully processed: ${processingStats.successful}`);
    console.log(`❌ Failed to process: ${processingStats.failed}`);
    console.log(`⚠️  Validation errors: ${processingStats.validationErrors}`);
    console.log(`📊 Total input items: ${processingStats.total}`);

    // Write output file with error handling
    try {
        if (outputData.length > 0) {
            // Ensure output directory exists
            const outputDir = outputFileName.substring(
                0,
                outputFileName.lastIndexOf("/"),
            );
            if (outputDir && !existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
                console.log(`📁 Created output directory: ${outputDir}`);
            }

            writeFileSync(outputFileName, JSON.stringify(outputData, null, 2));
            console.log(
                `✅ Successfully wrote ${outputData.length} metadata items to: ${outputFileName}`,
            );

            // Calculate output file size
            const stats = statSync(outputFileName);
            const fileSizeKB = (stats.size / 1024).toFixed(2);
            console.log(`📊 Output file size: ${fileSizeKB} KB`);
        } else {
            console.log("⚠️  No successful metadata items to write");
        }
    } catch (writeError) {
        console.error(
            `❌ Failed to write output file ${outputFileName}:`,
            writeError.message,
        );
        throw writeError;
    }

    // Write failed items file with error handling
    try {
        if (failedSerials.length > 0) {
            // Ensure failed file directory exists
            const failedDir = failedPsaFileName.substring(
                0,
                failedPsaFileName.lastIndexOf("/"),
            );
            if (failedDir && !existsSync(failedDir)) {
                mkdirSync(failedDir, { recursive: true });
                console.log(`📁 Created failed items directory: ${failedDir}`);
            }

            writeFileSync(
                failedPsaFileName,
                JSON.stringify(failedSerials, null, 2),
            );
            console.log(
                `📝 Wrote ${failedSerials.length} failed items to: ${failedPsaFileName}`,
            );
        } else {
            console.log("🎉 No failed items - all processing was successful!");
        }
    } catch (failedWriteError) {
        console.error(
            `❌ Failed to write failed items file ${failedPsaFileName}:`,
            failedWriteError.message,
        );
        // Don't throw here as the main processing was successful
    }

    // Return processing statistics
    return {
        total: processingStats.total,
        successful: processingStats.successful,
        failed: processingStats.failed,
        validationErrors: processingStats.validationErrors,
        outputFile: outputFileName,
        failedFile: failedPsaFileName,
        outputCount: outputData.length,
        failedCount: failedSerials.length,
    };
};

function parseCardTitle(title) {
    // Input validation
    if (!title || typeof title !== "string") {
        throw new Error(
            `Invalid title input: Expected string, got ${typeof title}. Value: ${title}`,
        );
    }

    if (title.trim().length === 0) {
        throw new Error("Title is empty or contains only whitespace");
    }

    console.log(`🔍 Attempting to parse title: "${title}"`);

    const patterns = [
        // Pattern 1: With card number and grading with condition
        {
            name: "Card number + Company + Score + Condition",
            regex: /^(.*?#[A-Z\d]+)\s+([A-Z]{2,4})\s+(\d+(?:\.\d+)?)\s+([A-Z][A-Z\s\-+]+)$/,
            handler: (match) => ({
                name: match[1].trim(),
                gradingCompany: match[2],
                grade: `${match[2]} ${match[3]} ${match[4]}`,
                gradeScore: match[3],
            }),
        },
        // Pattern 2: With card number and grading score only
        {
            name: "Card number + Company + Score",
            regex: /^(.*?#[A-Z\d]+)\s+([A-Z]{2,4})\s+(\d+(?:\.\d+)?)$/,
            handler: (match) => ({
                name: match[1].trim(),
                gradingCompany: match[2],
                grade: `${match[2]} ${match[3]}`,
                gradeScore: match[3],
            }),
        },
        // Pattern 3: Without card number but with grading and condition
        {
            name: "Name + Company + Score + Condition",
            regex: /^(.+?)\s+([A-Z]{2,4})\s+(\d+(?:\.\d+)?)\s+([A-Z][A-Z\s\-+]+)$/,
            handler: (match) => ({
                name: match[1].trim(),
                gradingCompany: match[2],
                grade: `${match[2]} ${match[3]} ${match[4]}`,
                gradeScore: match[3],
            }),
        },
        // Pattern 4: Without card number but with grading score only
        {
            name: "Name + Company + Score",
            regex: /^(.+?)\s+([A-Z]{2,4})\s+(\d+(?:\.\d+)?)$/,
            handler: (match) => ({
                name: match[1].trim(),
                gradingCompany: match[2],
                grade: `${match[2]} ${match[3]}`,
                gradeScore: match[3],
            }),
        },
        // Pattern 5: Authentic grades (CGC AUTH)
        {
            name: "Authentic/Qualified grades",
            regex: /^(.+?)\s+([A-Z]{2,4})\s+(AUTH|AUTHENTIC|QUALIFIED)$/i,
            handler: (match) => ({
                name: match[1].trim(),
                gradingCompany: match[2],
                grade: `${match[2]} ${match[3].toUpperCase()}`,
                gradeScore: match[3].toUpperCase(),
            }),
        },
    ];

    // Try each pattern
    for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        console.log(`   🔍 Trying pattern ${i + 1}: ${pattern.name}`);

        const match = title.match(pattern.regex);
        if (match) {
            console.log(`   ✅ Pattern ${i + 1} matched!`);
            console.log(`   📝 Regex match groups:`, match);

            try {
                const result = pattern.handler(match);
                console.log(`   🎯 Extracted data:`, result);

                // Validate the extracted data
                if (
                    !result.gradingCompany ||
                    result.gradingCompany.trim().length === 0
                ) {
                    throw new Error(
                        `Pattern ${i + 1} matched but failed to extract grading company`,
                    );
                }

                return result;
            } catch (handlerError) {
                throw new Error(
                    `Pattern ${i + 1} matched but handler failed: ${handlerError.message}`,
                );
            }
        } else {
            console.log(`   ❌ Pattern ${i + 1} did not match`);
        }
    }

    // If we reach here, no pattern matched
    console.error(`❌ NO PATTERNS MATCHED for title: "${title}"`);
    console.error(`🔍 Attempted patterns:`);
    patterns.forEach((pattern, index) => {
        console.error(`   ${index + 1}. ${pattern.name}: ${pattern.regex}`);
    });

    throw new Error(
        `Failed to parse title "${title}" - no regex patterns matched. This title format is not supported by current parsing logic.`,
    );
}

const start = async (inputFile, dataFile, outputFile, failedFile) => {
    const startTime = Date.now();
    console.log(`\n🚀 ===== POKEMON METADATA GENERATION STARTED =====`);
    console.log(`📅 Started at: ${new Date().toISOString()}`);

    try {
        console.log(`\n📁 FILE CONFIGURATION:`);
        console.log(`   📋 Input: ${inputFile}`);
        console.log(`   📊 Data Source: ${dataFile}`);
        console.log(`   📤 Output: ${outputFile}`);
        console.log(`   ❌ Failed Items: ${failedFile}`);

        // Validate all required files exist
        const requiredFiles = [
            { path: inputFile, type: "Input file" },
            { path: dataFile, type: "Data source file" },
        ];

        for (const file of requiredFiles) {
            if (!existsSync(file.path)) {
                throw new Error(`${file.type} not found: ${file.path}`);
            }

            // Check file size and readability
            try {
                const stats = statSync(file.path);
                if (stats.size === 0) {
                    throw new Error(`${file.type} is empty: ${file.path}`);
                }
                console.log(
                    `✅ ${file.type} validated (${(stats.size / 1024).toFixed(2)} KB): ${file.path}`,
                );
            } catch (statError) {
                throw new Error(
                    `Cannot access ${file.type} ${file.path}: ${statError.message}`,
                );
            }
        }

        console.log(`\n⏳ Starting metadata generation process...`);

        // Generate metadata
        const results = await generateMetadata(
            inputFile,
            dataFile,
            outputFile,
            failedFile,
        );

        // Calculate processing time
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

        // Display final results
        console.log(`\n🎉 ===== METADATA GENERATION COMPLETED =====`);
        console.log(`⏱️  Total execution time: ${processingTime} seconds`);
        console.log(`📅 Completed at: ${new Date().toISOString()}`);
        console.log(`\n📊 FINAL STATISTICS:`);
        console.log(`   📋 Total items processed: ${results.total}`);
        console.log(`   ✅ Successfully generated: ${results.successful}`);
        console.log(`   ❌ Failed to generate: ${results.failed}`);
        console.log(`   ⚠️  Validation errors: ${results.validationErrors}`);
        console.log(
            `   📈 Success rate: ${((results.successful / results.total) * 100).toFixed(1)}%`,
        );
        console.log(`\n📁 OUTPUT FILES:`);
        console.log(
            `   ✅ Metadata file: ${results.outputFile} (${results.outputCount} items)`,
        );
        console.log(
            `   ❌ Failed items file: ${results.failedFile} (${results.failedCount} items)`,
        );

        // Performance summary
        const itemsPerSecond = (results.total / (processingTime || 1)).toFixed(
            2,
        );
        console.log(`\n⚡ PERFORMANCE:`);
        console.log(`   🚀 Processing speed: ${itemsPerSecond} items/second`);

        if (results.failed > 0) {
            console.log(
                `\n⚠️  WARNING: ${results.failed} items failed processing.`,
            );
            console.log(
                `   📝 Check the failed items file for details: ${results.failedFile}`,
            );
        } else {
            console.log(`\n🎊 PERFECT RUN: All items processed successfully!`);
        }

        console.log(`\n🏁 Process completed successfully!`);
        return results;
    } catch (error) {
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

        console.error(`\n💥 ===== CRITICAL ERROR =====`);
        console.error(`❌ Error: ${error.message}`);
        console.error(`⏱️  Failed after: ${processingTime} seconds`);
        console.error(`📅 Error time: ${new Date().toISOString()}`);

        // Special handling for parsing failures
        if (
            error.message.includes("CRITICAL PARSING FAILURE") ||
            error.message.includes("PARSING FAILED")
        ) {
            console.error(`\n🚨 PARSING ERROR DETAILS:`);
            console.error(
                `   📄 This is a title parsing error - the script cannot extract grading information`,
            );
            console.error(
                `   🔧 The parseCardTitle() function needs to be updated to handle this title format`,
            );
            console.error(
                `   📝 Check the title format and add appropriate regex patterns`,
            );

            console.error(`\n🔍 PARSING TROUBLESHOOTING:`);
            console.error(
                `   1. Check if the title follows expected format: [Name] [Company] [Score] [Condition]`,
            );
            console.error(
                `   2. Verify grading company abbreviation (PSA, CGC, BGS, etc.)`,
            );
            console.error(
                `   3. Ensure grade score is numeric (e.g., 10, 9.5)`,
            );
            console.error(
                `   4. Check if condition text follows standard format (GEM MINT, NM-MT, etc.)`,
            );
            console.error(
                `   5. Look for special cases like AUTH, AUTHENTIC, QUALIFIED grades`,
            );

            console.error(`\n📋 CURRENT SUPPORTED PATTERNS:`);
            console.error(`   1. "Card Name #123 PSA 10 GEM MINT"`);
            console.error(`   2. "Card Name #123 PSA 10"`);
            console.error(`   3. "Card Name PSA 10 GEM MINT"`);
            console.error(`   4. "Card Name PSA 10"`);
            console.error(`   5. "Card Name CGC AUTH"`);
        }

        if (error.stack) {
            console.error(`\n📍 Stack Trace:`);
            console.error(error.stack);
        }

        console.error(`\n🔧 GENERAL TROUBLESHOOTING TIPS:`);
        console.error(`   1. Verify all input files exist and are readable`);
        console.error(`   2. Check JSON format validity in input files`);
        console.error(`   3. Ensure sufficient disk space for output files`);
        console.error(
            `   4. Verify file permissions for input/output directories`,
        );
        console.error(`   5. Check if data source file has correct structure`);

        // Try to provide more specific guidance based on error message
        if (error.message.includes("not found")) {
            console.error(
                `   📁 Missing file error - check file paths and existence`,
            );
        } else if (error.message.includes("JSON")) {
            console.error(`   📊 JSON parsing error - validate file format`);
        } else if (error.message.includes("permission")) {
            console.error(
                `   🔒 Permission error - check file/directory permissions`,
            );
        }
        throw error; // Re-throw for process exit handling
    }
};

// Main execution with top-level error handling
(async () => {
    const config = loadConfig();
    const stepId = "2";
    updateStatus(stepId, "running", "Metadata generation started");

    try {
        // Get file paths from config
        const inputFile = config.pipeline.steps[stepId - 1].inputs.inputFile;
        const dataFile = config.pipeline.steps[stepId - 1].inputs.dataFile;
        const outputFile = config.pipeline.steps[stepId - 1].outputs.outputFile;
        const failedFile = config.pipeline.steps[stepId - 1].outputs.failedFile;

        await start(inputFile, dataFile, outputFile, failedFile);
        updateStatus(stepId, "completed", `Successfully metadata generated`);
    } catch (error) {
        console.error(`\n💀 FATAL ERROR - Process terminating`, error);
        updateStatus(stepId, "failed", error.message);
        process.exit(1); // Error exit code
    }
})();
