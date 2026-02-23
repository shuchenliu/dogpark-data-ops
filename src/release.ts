// may be parsed from release.json in the future
import { customAlphabet } from "nanoid";
import fs from "fs";
import { addNewBuild, deleteBuilds, sleep, startIndex } from "./utils.js";

/**
 * Represents the result of a single build operation.
 */
interface BuildResult {
    /** The name of the dataset being built */
    dataset: string;
    /** The generated build name for this dataset */
    buildName: string;
    /** Whether the build succeeded */
    success: boolean;
    /** When the build was requested (ISO string) */
    timestamp: string;
    /** Error message if the build failed */
    error?: string;
}

const DATASETS = [
    // "alliance",
    // "bgee",
    // "bindingdb",
    // "chembl",
    // "cohd",
    // "ctd",
    // "ctkp",
    // "dakp",
    // "dgidb",
    // "diseases",
    // "drug_rep_hub",
    // "drugcentral",
    // "gene2phenotype",
    // "geneticskp",
    // "go_cam",
    // "goa",
    // "gtopdb",
    // "hpoa",
    // "icees",
    // "intact",

    // "ncbi_gene",

    "panther",
    "pathbank",
    "semmeddb",
    "sider",
    "signor",
    "tmkp",
    "ttd",
    "ubergraph",
];

// const DATASETS = ["drug_rep_hub"];

const ES_URL = "http://localhost:9200/";

const STAGING_TAG = "dingo_staging";
const PROD_TAG = "dingo";
const DEPR_TAG = "dingo_deprecated";

interface AddAliasAction {
    add: {
        index: string;
        alias: string;
    };
}

interface RemoveAliasAction {
    remove: {
        index: string;
        alias: string;
    };
}

type AliasAction = AddAliasAction | RemoveAliasAction;

type AliasResponse = Record<string, Record<string, unknown>>;

const buildAliasPayload = (
    indices: string[],
    alias: string,
    action: "add" | "remove" = "add",
): { actions: AliasAction[] } => {
    return {
        actions: indices.map((index) =>
            action === "add"
                ? ({ add: { index, alias } } as AddAliasAction)
                : ({ remove: { index, alias } } as RemoveAliasAction),
        ),
    };
};

const executeAliasActions =
    (action: "add" | "remove") => async (names: string[], alias: string) => {
        const payload = buildAliasPayload(names, alias, action);
        return await fetch(`${ES_URL}_aliases`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
    };

const assignAlias = executeAliasActions("add");
const removeAlias = executeAliasActions("remove");

/**
 * Fetches all Elasticsearch indices associated with a given alias.
 *
 * Returns an empty array if the alias does not exist.
 *
 * @param alias - the target alias to query
 * @returns a list of index names associated with the alias
 */

const getIndexNamesWithAlias = async (alias: string): Promise<string[]> => {
    const res = await fetch(`${ES_URL}_alias/${alias}`);

    if (res.status === 404) {
        return [];
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Elasticsearch error: ${text}`);
    }

    const data = (await res.json()) as AliasResponse;
    return Object.keys(data);
};

const assignStagingTag = (names: string[]) => assignAlias(names, STAGING_TAG);
const removeStagingTag = (names: string[]) => removeAlias(names, STAGING_TAG);
const assignProdTag = (names: string[]) => assignAlias(names, PROD_TAG);
const removeProdTag = (names: string[]) => removeAlias(names, PROD_TAG);

const assignDeprTag = (names: string[]) => assignAlias(names, DEPR_TAG);
const removeDeprTag = (names: string[]) => removeAlias(names, DEPR_TAG);

const getDateString = () =>
    new Date().toISOString().slice(0, 10).replace(/-/g, "");

const getTimeString = () =>
    new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);

const getRandomString = () => {
    const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789");
    return nanoid(8);
};

const getBuildName = (name: string) => {
    return `${name}_${getDateString()}_${getRandomString()}`;
};

const addNewBuilds = async (names: string[]) => {
    const buildNames = names.map((name) => getBuildName(name));
    await addNewBuild(buildNames);

    // persist build names for records
    const fileName = getTimeString();
    fs.writeFileSync("latest-builds.txt", buildNames.join("\n"), "utf8");
    fs.writeFileSync(`${fileName}.txt`, buildNames.join("\n"), "utf8");

    return buildNames;
};

/**
 *
 * @param fileName name of the file containing target builds
 * @return an array of build config names
 */

const readNames = (fileName: string) => {
    const nameWithExtension = fileName.endsWith(".txt")
        ? fileName
        : `${fileName}.txt`;
    const data = fs.readFileSync(nameWithExtension, "utf8");
    const buildNames = data.split(/\r?\n/).filter(Boolean);

    if (buildNames.length === 0) {
        throw new Error(`No names retrieved from "${nameWithExtension}"`);
    }

    return buildNames;
};

/**
 * Mock version of addNewBuild for dry run testing.
 * Returns immediately with successful responses without making actual requests.
 */
const mockAddNewBuild = (names: string[]) => {
    return Promise.resolve(names.map(() => ({ status: "fulfilled" as const })));
};

/**
 * Formats elapsed time in human-readable format.
 *
 * @param seconds - Total elapsed seconds
 * @returns Formatted time string (e.g. "1m 30s" or "45s")
 */
const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
};

/**
 * Initiates new builds for a list of datasets, throttled over a specified duration.
 *
 * This prevents flooding the downstream service by spacing out build requests evenly.
 * Tracks detailed results including successes, failures, and error messages.
 * Logs progress and summary to console.
 *
 * @param names - Array of dataset names to build
 * @param totalDurationMs - Total time duration to spread requests over (default: 180000ms = 3 minutes)
 * @param dryRun - If true, only logs what would happen without making actual requests (default: false)
 * @returns Array of BuildResult objects containing success/failure details for each dataset
 */
const startAddNewBuilds = async (
    names: string[],
    totalDurationMs: number = 180000,
    dryRun: boolean = false,
): Promise<BuildResult[]> => {
    const results: BuildResult[] = [];
    // Calculate interval to evenly distribute requests over the specified duration
    const intervalMs = Math.floor(totalDurationMs / names.length);

    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    console.log(
        `${dryRunLabel}Starting to add ${names.length} builds over ${totalDurationMs}ms (~${intervalMs}ms between each)`,
    );

    // Use mock build function in dry run mode, real one otherwise
    const buildAsync = dryRun ? mockAddNewBuild : addNewBuild;

    const startTime = Date.now();

    // Start a persistent clock that updates on the same line
    const clockInterval = setInterval(() => {
        const elapsedMs = Date.now() - startTime;
        const elapsedSec = Math.floor(elapsedMs / 1000);
        process.stdout.write(`\r⏱️  Elapsed: ${formatTime(elapsedSec)}`);
    }, 500);

    // Process each dataset sequentially with delays between requests
    const pendingBuilds: Promise<unknown>[] = [];

    for (let i = 0; i < names.length; i++) {
        const dataset = names[i];
        const buildName = getBuildName(dataset);
        const timestamp = new Date().toISOString();
        const index = i + 1; // Capture index for use in closures

        // Start the build request without waiting for it to complete
        const buildPromise = buildAsync([buildName])
            .then((result) => {
                // Clear the clock line before printing result
                process.stdout.write("\r\x1b[K");

                const settled = result[0];
                if (settled.status === "fulfilled") {
                    results.push({
                        dataset,
                        buildName,
                        success: true,
                        timestamp,
                    });
                    console.log(
                        `✅ [${index}/${names.length}] ${dryRunLabel}${dataset} -> ${buildName}`,
                    );
                } else {
                    results.push({
                        dataset,
                        buildName,
                        success: false,
                        timestamp,
                        error: String(settled.reason),
                    });
                    console.log(
                        `❌ [${index}/${names.length}] ${dataset} failed: ${settled.reason}`,
                    );
                }
                return result;
            })
            .catch((err) => {
                // Clear the clock line before printing error
                process.stdout.write("\r\x1b[K");
                results.push({
                    dataset,
                    buildName,
                    success: false,
                    timestamp,
                    error: err instanceof Error ? err.message : String(err),
                });
                console.log(
                    `❌ [${index}/${names.length}] ${dataset} error: ${err}`,
                );
            });

        pendingBuilds.push(buildPromise);

        // Wait the interval before starting the next build (except after the last one)
        if (i < names.length - 1) {
            await sleep(intervalMs);
        }
    }

    // Wait for all pending builds to complete
    await Promise.allSettled(pendingBuilds);

    // Stop the clock and clear the line
    clearInterval(clockInterval);
    process.stdout.write("\r\x1b[K");

    // Log summary statistics
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(
        `\n✨ ${dryRunLabel}Build complete: ${successful} successful, ${failed} failed`,
    );

    // Persist successful build names to file (like the old addNewBuilds function did)
    if (successful > 0) {
        const successfulBuildNames = results
            .filter((r) => r.success)
            .map((r) => r.buildName);
        const fileName = getTimeString();
        fs.writeFileSync(
            "latest-builds.txt",
            successfulBuildNames.join("\n"),
            "utf8",
        );
        fs.writeFileSync(
            `${fileName}.txt`,
            successfulBuildNames.join("\n"),
            "utf8",
        );
    }

    return results;
};

const releaseStaging = async (fileName: string) => {
    const buildNames = readNames(fileName);

    // 1. release data
    await startIndex(buildNames);
    console.log("indexing started");

    // 2. assign tags
    await sleep(5000);
    await assignStagingTag(buildNames);

    console.log("staging tags assigned");
};

const deprecateProdIndices = async (names: string[]) => {
    await assignDeprTag(names);
    // store deprecated names for future rollback
    const fileName = getTimeString();
    fs.writeFileSync(`depr-${fileName}.txt`, names.join("\n"), "utf8");
};

const releaseProd = async (buildRecordName: string) => {
    // 0. get current prod indices
    const prodNames = await getIndexNamesWithAlias(PROD_TAG);

    // 1. get target staging indices
    const stagingCandidates = readNames(buildRecordName);

    const stagingNames = new Set<string>(
        await getIndexNamesWithAlias(STAGING_TAG),
    );

    // better grained tagging for better replacing, maybe

    // ensure these are indeed candidates
    for (const candidate of stagingCandidates) {
        if (!stagingNames.has(candidate)) {
            throw new Error(`${candidate} is not a staging index`);
        }
    }

    // 2. switch staging indices to prod
    await assignProdTag(stagingCandidates);
    // 4. remove ex-prod tags - data removal depending on redundancy
    await removeProdTag(prodNames);

    // deprecate and store names for future rollback
    await deprecateProdIndices(prodNames);

    // 3. remove staging tag
    await removeStagingTag(stagingCandidates);
};

const rollBackIndices = async (deprRecordFileName: string) => {
    if (!deprRecordFileName.startsWith("depr")) {
        throw new Error("Not a valid depr record");
    }

    const prodNames = await getIndexNamesWithAlias(PROD_TAG);
    const indexNames = readNames(deprRecordFileName);

    await assignProdTag(indexNames);
    await removeProdTag(prodNames);
    await deprecateProdIndices(prodNames);
};

// todo
const removeDeprIndices = async (deprRecordFileName: string) => {};

/**
 * Removes builds specified in a file.
 *
 * Reads build names from the provided file and deletes each one.
 * If no filename is provided, defaults to latest-builds.txt.
 *
 * @param fileName - Path to file containing build names (one per line). Defaults to "latest-builds.txt" if not provided or "latest"
 * @param dryRun - If true, only logs what would happen without making actual requests (default: false)
 * @returns Array of deletion results
 */
const removeStoredBuilds = async (
    fileName?: string,
    dryRun: boolean = false,
): Promise<PromiseSettledResult<Response>[]> => {
    // Default to latest-builds.txt if no filename provided
    const targetFile =
        !fileName || fileName === "latest" ? "latest-builds.txt" : fileName;
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";

    console.log(`${dryRunLabel}Removing builds from ${targetFile}...`);

    const buildNames = readNames(targetFile);
    console.log(`Found ${buildNames.length} builds to remove`);

    const results: PromiseSettledResult<Response>[] = dryRun
        ? (buildNames.map(() => ({
              status: "fulfilled" as const,
          })) as PromiseSettledResult<Response>[])
        : await deleteBuilds(buildNames);

    // Log individual results
    buildNames.forEach((buildName, index) => {
        const result = results[index] as any;
        if (result.status === "fulfilled") {
            if (dryRun) {
                console.log(`✅ Would remove ${buildName}`);
            } else {
                const response = result.value as Response;
                if (response && response.ok) {
                    console.log(`✅ Removed ${buildName}`);
                } else {
                    const status = response?.status || "unknown";
                    console.log(
                        `❌ Failed to remove ${buildName}: HTTP ${status}`,
                    );
                }
            }
        } else {
            console.log(`❌ Failed to remove ${buildName}: ${result.reason}`);
        }
    });

    // Log summary
    const successful = results.filter((r: any) => {
        if (dryRun) {
            return r.status === "fulfilled";
        }
        return r.status === "fulfilled" && (r.value as Response).ok;
    }).length;
    const failed = results.length - successful;
    console.log(
        `\n✨ ${dryRunLabel}Removal complete: ${successful} successful, ${failed} failed`,
    );

    return results;
};

(async function () {
    const args = process.argv.slice(2);
    const hasBuild = args.includes("-b") || args.includes("--build");
    const hasRemove = args.includes("-rb") || args.includes("--remove-build");
    const hasDryRun = args.includes("-d") || args.includes("--dry-run");

    // Parse duration argument (in seconds, default 3 minutes = 180 seconds)
    let durationSeconds = 180;
    const durationIndex = args.findIndex(
        (arg) => arg === "--duration" || arg === "-t",
    );
    if (durationIndex !== -1 && durationIndex + 1 < args.length) {
        const parsedDuration = parseInt(args[durationIndex + 1], 10);
        if (!isNaN(parsedDuration) && parsedDuration > 0) {
            durationSeconds = parsedDuration;
        }
    }

    // Parse filename for remove operation
    let removeFileName: string | undefined;
    const removeIndex = args.findIndex(
        (arg) => arg === "--remove-build" || arg === "-rb",
    );
    if (
        removeIndex !== -1 &&
        removeIndex + 1 < args.length &&
        !args[removeIndex + 1].startsWith("-")
    ) {
        removeFileName = args[removeIndex + 1];
    }

    if (hasBuild) {
        console.log("Starting build process...");
        await startAddNewBuilds(DATASETS, durationSeconds * 1000, hasDryRun);
    } else if (hasRemove) {
        console.log("Starting removal process...");
        await removeStoredBuilds(removeFileName, hasDryRun);
    } else {
        console.log(
            "Usage: npx tsx release.ts [-b|--build] [-rb|--remove-build [filename]]",
        );
        console.log("Build options:");
        console.log(
            "  -b, --build                 Initiate builds for all datasets",
        );
        console.log(
            "  -t, --duration <seconds>    Spread builds over N seconds (default: 180)",
        );
        console.log("\nRemoval options:");
        console.log(
            "  -rb, --remove-build [filename] Remove builds from file (defaults to latest-builds.txt)",
        );
        console.log("\nCommon options:");
        console.log(
            "  -d, --dry-run               Show what would happen without making actual requests",
        );
    }
})();
