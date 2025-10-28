// Split metadata into individual files for each card
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig, updateStatus, sanitizeFilename } from "./utils.js";

const main = (inputFilePath, outputDir) => {
    try {
        const inputData = JSON.parse(readFileSync(inputFilePath));

        for (let index = 0; index < inputData.length; index++) {
            const item = inputData[index];
            const gradingId = item.attributes.find(
                (attr) => attr.trait_type === "Grading ID",
            )?.value;
            const fileName = `${item.name}-${gradingId}`;
            const sanitizedFileName = sanitizeFilename(fileName);

            const outputFilePath = join(outputDir, `${sanitizedFileName}.json`);
            writeFileSync(outputFilePath, JSON.stringify(item, null, 2));
            console.log(
                `Wrote metadata for Pokemon ${fileName} to ${outputFilePath}`,
            );
        }
        console.log("All metadata files have been created successfully.");
    } catch (error) {
        console.error("Error processing metadata:", error);
    }
};

(async () => {
    const config = loadConfig();
    const stepId = "6";

    // Update status to running
    updateStatus(stepId, "running", "Image Downloading started");

    const inputFilePath =
        config.pipeline.steps[stepId - 1].inputs.inputFilePath;
    const outputDir = config.pipeline.steps[stepId - 1].outputs.outputDir; // Directory to save individual metadata files

    // Create output directory if it doesn't exist
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    try {
        main(inputFilePath, outputDir);
        updateStatus(stepId, "completed", `Successfully downloaded all images`);
    } catch (error) {
        console.error(error);
        updateStatus(stepId, "failed", error.message);
        process.exit(1); // Error exit code
    }
})();
