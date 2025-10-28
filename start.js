#!/usr/bin/env node

import { spawn } from "child_process";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import path from "path";

// ANSI color codes for better UI
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
};

// Load configuration and pipeline steps
const loadConfig = () => {
    try {
        const configPath = path.resolve("config.json");
        if (!existsSync(configPath)) {
            throw new Error("config.json not found");
        }
        const configData = readFileSync(configPath, "utf8");
        return JSON.parse(configData);
    } catch (error) {
        console.error("❌ Error loading config:", error.message);
        process.exit(1);
    }
};

const config = loadConfig();
const PIPELINE_STEPS = config.pipeline.steps.map((step) => ({
    id: step.id,
    name: step.name,
    script: step.script,
    description: step.description,
    icon: step.icon,
    inputs: step.inputs,
    outputs: step.outputs,
    args: [], // Will be loaded from config per script
}));

class NFTMetadataCLI {
    constructor() {
        this.rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        this.completedSteps = new Set();
        this.loadStepStatus();
    }

    // Load step status from status.json
    loadStepStatus() {
        try {
            const statusPath = config.paths.status;
            if (existsSync(statusPath)) {
                const statusData = JSON.parse(readFileSync(statusPath, "utf8"));
                Object.keys(statusData).forEach((stepId) => {
                    if (statusData[stepId].status === "completed") {
                        this.completedSteps.add(stepId);
                    }
                });
            }
        } catch (error) {
            console.warn(`⚠️  Could not load step status: ${error.message}`);
        }
    }

    // Update status file
    updateStepStatus(stepId, status, message = "") {
        try {
            const statusPath = config.paths.status;
            let statusData = {};
            if (existsSync(statusPath)) {
                statusData = JSON.parse(readFileSync(statusPath, "utf8"));
            }

            const step = PIPELINE_STEPS.find((s) => s.id === stepId);
            statusData[stepId] = {
                status: status,
                message: message,
                timestamp: new Date().toISOString(),
                step_name: step ? step.name : `Step ${stepId}`,
            };

            writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
            console.log(`📝 Status updated: ${stepId} -> ${status}`);
        } catch (error) {
            console.warn(`⚠️  Could not update status: ${error.message}`);
        }
    }

    // Utility methods
    log(message, color = "reset") {
        console.log(`${colors[color]}${message}${colors.reset}`);
    }

    logHeader(message) {
        console.log("\n" + "=".repeat(60));
        this.log(message, "cyan");
        console.log("=".repeat(60));
    }

    logSuccess(message) {
        this.log(`✅ ${message}`, "green");
    }

    logError(message) {
        this.log(`❌ ${message}`, "red");
    }

    logWarning(message) {
        this.log(`⚠️  ${message}`, "yellow");
    }

    logInfo(message) {
        this.log(`ℹ️  ${message}`, "blue");
    }

    // Check if required files exist
    checkInputFiles(step) {
        const missingFiles = [];
        if (step.inputs) {
            Object.values(step.inputs).forEach((file) => {
                if (!existsSync(file)) {
                    missingFiles.push(file);
                }
            });
        }
        return missingFiles;
    }

    // Run a pipeline step
    async runStep(step) {
        this.logHeader(`${step.icon} Running Step ${step.id}: ${step.name}`);
        this.logInfo(step.description);

        // Update status to running
        this.updateStepStatus(step.id, "running", `${step.name} started`);

        // Check prerequisites
        const missingFiles = this.checkInputFiles(step);
        if (missingFiles.length > 0) {
            this.logWarning("Missing input files:");
            missingFiles.forEach((file) => console.log(`  - ${file}`));

            const proceed = await this.askQuestion(
                "Do you want to continue anyway? (y/N): ",
            );
            if (!proceed.toLowerCase().startsWith("y")) {
                this.logInfo("Step skipped.");
                this.updateStepStatus(
                    step.id,
                    "skipped",
                    "User chose to skip due to missing files",
                );
                return false;
            }
        }

        console.log("\n" + "-".repeat(40));
        this.logInfo(`Executing: node ${step.script}`);
        console.log("-".repeat(40));

        return new Promise((resolve) => {
            const child = spawn("node", [step.script], {
                stdio: "inherit",
                cwd: process.cwd(),
            });

            child.on("close", (code) => {
                console.log("\n" + "-".repeat(40));
                if (code === 0) {
                    this.logSuccess(`Step ${step.id} completed successfully!`);
                    this.completedSteps.add(step.id);
                    resolve(true);
                } else {
                    this.logError(
                        `Step ${step.id} failed with exit code ${code}`,
                    );
                    resolve(false);
                }
            });

            child.on("error", (error) => {
                this.logError(
                    `Failed to start step ${step.id}: ${error.message}`,
                );
                resolve(false);
            });
        });
    }

    // Interactive question helper
    askQuestion(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer.trim());
            });
        });
    }

    // Display main menu
    displayMainMenu() {
        console.clear();
        this.logHeader("🎴 NFT Metadata Generation Pipeline");

        console.log("\nAvailable Actions:");
        console.log("1️⃣   Run Step");
        console.log("2️⃣   View Pipeline Status");
        console.log("3️⃣   View Step Details");
        console.log("4️⃣   Check Prerequisites");
        console.log("5️⃣   View Step Status History");
        console.log("0️⃣   Exit");

        console.log("\n" + "─".repeat(60));
    }

    // Display pipeline steps
    displaySteps(highlightCompleted = true) {
        console.log("\nPipeline Steps:");
        PIPELINE_STEPS.forEach((step, index) => {
            const status = this.completedSteps.has(step.id) ? "✅" : "⏳";
            const color =
                this.completedSteps.has(step.id) && highlightCompleted
                    ? "green"
                    : "reset";
            this.log(`${status} ${step.id}. ${step.icon} ${step.name}`, color);

            // Show input/output files if detailed view
            if (!highlightCompleted) {
                if (step.inputs) {
                    Object.entries(step.inputs).forEach(([key, file]) => {
                        const exists = existsSync(file);
                        const fileStatus = exists ? "✅" : "❌";
                        console.log(`     ${fileStatus} Input ${key}: ${file}`);
                    });
                }
                if (step.outputs) {
                    Object.entries(step.outputs).forEach(([key, file]) => {
                        console.log(`     📁 Output ${key}: ${file}`);
                    });
                }
            }
        });
    }

    // View step details
    async viewStepDetails() {
        console.log("\nSelect a step to view details:");
        PIPELINE_STEPS.forEach((step) => {
            console.log(`${step.id}. ${step.icon} ${step.name}`);
        });

        const choice = await this.askQuestion(
            "\nEnter step number (or press Enter to go back): ",
        );
        if (!choice) return;

        const step = PIPELINE_STEPS.find((s) => s.id === choice);
        if (!step) {
            this.logError("Invalid step number!");
            await this.askQuestion("Press Enter to continue...");
            return;
        }

        console.clear();
        this.logHeader(`${step.icon} Step ${step.id}: ${step.name}`);

        this.logInfo(`Description: ${step.description}`);
        this.logInfo(`Script: ${step.script}`);

        console.log("\nInput Files:");
        if (step.inputs) {
            Object.entries(step.inputs).forEach(([key, file]) => {
                const exists = existsSync(file);
                const status = exists ? "✅" : "❌";
                console.log(`  ${status} ${key}: ${file}`);
            });
        }

        console.log("\nOutput Files/Directories:");
        if (step.outputs) {
            Object.entries(step.outputs).forEach(([key, file]) => {
                console.log(`  📁 ${key}: ${file}`);
            });
        }

        const completed = this.completedSteps.has(step.id);
        console.log(`\nStatus: ${completed ? "✅ Completed" : "⏳ Pending"}`);

        await this.askQuestion("\nPress Enter to continue...");
    }

    // Check prerequisites for all steps
    async checkPrerequisites() {
        console.clear();
        this.logHeader("🔍 Prerequisites Check");

        let allGood = true;

        PIPELINE_STEPS.forEach((step) => {
            console.log(`\n${step.icon} Step ${step.id}: ${step.name}`);
            const missingFiles = this.checkInputFiles(step);

            if (missingFiles.length === 0) {
                this.logSuccess("All input files are available");
            } else {
                allGood = false;
                this.logWarning("Missing input files:");
                missingFiles.forEach((file) => console.log(`  - ${file}`));
            }
        });

        console.log("\n" + "─".repeat(60));
        if (allGood) {
            this.logSuccess("All prerequisites are satisfied! 🎉");
        } else {
            this.logWarning(
                "Some prerequisites are missing. Check the details above.",
            );
        }

        await this.askQuestion("\nPress Enter to continue...");
    }

    // Run single step
    async runSingleStep() {
        console.log("\nSelect a step to run:");
        this.displaySteps(false);

        const choice = await this.askQuestion(
            "\nEnter step number (or press Enter to go back): ",
        );
        if (!choice) return;

        const step = PIPELINE_STEPS.find((s) => s.id === choice);
        if (!step) {
            this.logError("Invalid step number!");
            await this.askQuestion("Press Enter to continue...");
            return;
        }

        await this.runStep(step);
        await this.askQuestion("\nPress Enter to continue...");
    }

    // Run multiple steps

    // View pipeline status
    async viewStatus() {
        console.clear();
        this.logHeader("📊 Pipeline Status");

        const totalSteps = PIPELINE_STEPS.length;
        const completedCount = this.completedSteps.size;
        const progressPercent = Math.round((completedCount / totalSteps) * 100);

        console.log(
            `\nProgress: ${completedCount}/${totalSteps} steps completed (${progressPercent}%)`,
        );

        // Simple progress bar
        const barLength = 40;
        const filledLength = Math.round(
            (completedCount / totalSteps) * barLength,
        );
        const bar =
            "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
        console.log(`[${bar}] ${progressPercent}%`);

        this.displaySteps(true);

        await this.askQuestion("\nPress Enter to continue...");
    }

    // View step status history
    async viewStepStatusHistory() {
        console.clear();
        this.logHeader("📋 Step Status History");

        try {
            const statusPath = config.paths.status;
            if (!existsSync(statusPath)) {
                this.logInfo(
                    "No status history found. Run some pipeline steps first.",
                );
                await this.askQuestion("\nPress Enter to continue...");
                return;
            }

            const statusData = JSON.parse(readFileSync(statusPath, "utf8"));

            if (Object.keys(statusData).length === 0) {
                this.logInfo("No step history available.");
            } else {
                console.log("\nStep Execution History:");
                Object.keys(statusData)
                    .sort()
                    .forEach((stepId) => {
                        const step = statusData[stepId];
                        const statusIcon =
                            step.status === "completed"
                                ? "✅"
                                : step.status === "failed"
                                  ? "❌"
                                  : step.status === "running"
                                    ? "🔄"
                                    : step.status === "skipped"
                                      ? "⏭️"
                                      : "⏳";

                        console.log(
                            `\n${statusIcon} Step ${stepId}: ${step.step_name}`,
                        );
                        console.log(`   Status: ${step.status.toUpperCase()}`);
                        console.log(
                            `   Time: ${new Date(step.timestamp).toLocaleString()}`,
                        );
                        if (step.message) {
                            console.log(`   Message: ${step.message}`);
                        }
                    });
            }
        } catch (error) {
            this.logError(`Failed to load status history: ${error.message}`);
        }

        await this.askQuestion("\nPress Enter to continue...");
    }

    // Main application loop
    async run() {
        this.log(
            "Welcome to the NFT Metadata Generation Pipeline! 🚀",
            "bright",
        );

        while (true) {
            this.displayMainMenu();

            const choice = await this.askQuestion("\nSelect an option: ");

            switch (choice) {
                case "1":
                    await this.runSingleStep();
                    break;
                case "2":
                    await this.viewStatus();
                    break;
                case "3":
                    await this.viewStepDetails();
                    break;
                case "4":
                    await this.checkPrerequisites();
                    break;
                case "5":
                    await this.viewStepStatusHistory();
                    break;
                case "0":
                case "exit":
                case "quit":
                    this.log(
                        "\nThanks for using NFT Metadata Pipeline! 👋",
                        "cyan",
                    );
                    this.rl.close();
                    process.exit(0);
                    break;
                default:
                    this.logError("Invalid option! Please try again.");
                    await this.askQuestion("Press Enter to continue...");
            }
        }
    }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
    console.log("\n\nGoodbye! 👋");
    process.exit(0);
});

// Start the CLI application
const cli = new NFTMetadataCLI();
cli.run().catch((error) => {
    console.error("\nFatal error:", error.message);
    process.exit(1);
});
