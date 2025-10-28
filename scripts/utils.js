import {
    createReadStream,
    writeFileSync,
    readFileSync,
    existsSync,
    statSync,
} from "fs";
import { join, basename, extname, resolve } from "path";

import {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const DO_SPACES_ACCESS_KEY = process.env.DO_SPACES_ACCESS_KEY;
const DO_SPACES_SECRET_KEY = process.env.DO_SPACES_SECRET_KEY;
const REGION = process.env.REGION;
const ENDPOINT = process.env.ENDPOINT;
const bucketName = process.env.BUCKETNAME;

if (!DO_SPACES_ACCESS_KEY || !DO_SPACES_SECRET_KEY) {
    throw new Error(
        "DigitalOcean Spaces credentials are not set in environment variables.",
    );
}

// Configure DigitalOcean Spaces
const s3Client = new S3Client({
    endpoint: `https://${ENDPOINT}`,
    region: REGION,
    credentials: {
        accessKeyId: DO_SPACES_ACCESS_KEY,
        secretAccessKey: DO_SPACES_SECRET_KEY,
    },
});

// Load configuration
export const loadConfig = () => {
    try {
        const configPath = resolve("config.json");
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

// Update status file
export const updateStatus = (stepId, status, message = "") => {
    try {
        const config = loadConfig();
        const statusPath = config.paths.status;

        let statusData = {};
        if (existsSync(statusPath)) {
            statusData = JSON.parse(readFileSync(statusPath, "utf8"));
        }

        statusData[stepId] = {
            status: status,
            message: message,
            timestamp: new Date().toISOString(),
            step_name: "CSV to JSON Conversion",
        };

        writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
        console.log(`📝 Status updated: ${stepId} -> ${status}`);
    } catch (error) {
        console.warn(`⚠️  Could not update status: ${error.message}`);
    }
};

export const sanitizeFilename = (fileName, options = {}) => {
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
};

export const uploadFile = async (
    localFilePath,
    remoteFolderPath,
    contentType = null,
) => {
    try {
        const fileContent = readFileSync(localFilePath);
        const fileName = basename(localFilePath);

        // Determine content type if not provided
        if (!contentType) {
            const ext = extname(localFilePath).toLowerCase();
            contentType = getContentType(ext);
        }

        const remoteKey = `${remoteFolderPath}/${fileName}`;

        console.log(
            `Uploading ${localFilePath} to ${remoteKey} with content type ${contentType}`,
        );

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: remoteKey,
            Body: fileContent,
            ContentType: contentType,
            ACL: "public-read", // or 'private' based on your needs
        });

        await s3Client.send(command);
        const url = `https://${bucketName}.${ENDPOINT}/${remoteKey}`;
        console.log("Successfully uploaded object: ", url);
        return url;
    } catch (error) {
        console.error("Error uploading file:", error);
        throw error;
    }
};

function getContentType(extension) {
    const typeMap = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    };
    return typeMap[extension] || "application/octet-stream";
}

// Check if file exists in bucket
export const isFileAvailableInBucket = async (key) => {
    try {
        // console.log(s3Client, bucketName, key);
        console.log(`🔍 Checking if file exists in bucket: ${key}`);
        await s3Client.send(
            new HeadObjectCommand({ Bucket: bucketName, Key: key }),
        );
        console.log(`✅ File exists in bucket: ${key}`);
        return true; // Object exists
    } catch (err) {
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
            console.log(`📄 File not found in bucket: ${key}`);
            return false; // Object does not exist
        } else {
            // Handle other errors (e.g., permission issues)
            console.error(
                `❌ Error checking object existence for ${key}:`,
                err.message,
            );
            return false; // Assume doesn't exist on error to allow upload attempt
        }
    }
};

export const getS3URL = (key) => {
    return `https://${bucketName}.${ENDPOINT}/${key}`;
};
// module.exports = {
//     loadConfig,
//     updateStatus,
// };
