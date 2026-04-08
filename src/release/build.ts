import { addNewBuild, sleep, pingHub, HUB_URL } from "../utils.js";
import { ALL_DATASETS, SPECIAL_DATASETS } from "../common.js";
import { getBuildName, getTimeString, writeReleaseRecord } from "./common.js";

const DATASETS = [
    ...ALL_DATASETS,
    ...SPECIAL_DATASETS.map((d) => d.build_name),
];

interface BuildResult {
    dataset: string;
    buildName: string;
    success: boolean;
    timestamp: string;
    error?: string;
}

const mockAddNewBuild = (names: string[]) => {
    return Promise.resolve(names.map(() => ({ status: "fulfilled" as const })));
};

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

export const startAddNewBuilds = async (
    names: string[],
    totalDurationMs: number = 180000,
    dryRun: boolean = false,
): Promise<BuildResult[]> => {
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";

    // Ping hub before proceeding
    const hubPing = await pingHub();
    if (!hubPing.ok) {
        if (dryRun) {
            console.warn(
                `\x1b[31m${dryRunLabel}Warning: Hub unreachable at ${HUB_URL} (${hubPing.error})\x1b[0m`,
            );
        } else {
            throw new Error(
                `\x1b[31mHub unreachable at ${HUB_URL} (${hubPing.error}). Aborting build.\x1b[0m`,
            );
        }
    } else {
        console.log(`${dryRunLabel}Hub reachable at ${HUB_URL}`);
    }

    const results: BuildResult[] = [];
    const intervalMs = Math.floor(totalDurationMs / names.length);

    console.log(
        `${dryRunLabel}Starting to add ${names.length} builds over ${totalDurationMs}ms (~${intervalMs}ms between each)`,
    );

    const buildAsync = dryRun ? mockAddNewBuild : addNewBuild;

    const startTime = Date.now();

    const clockInterval = setInterval(() => {
        const elapsedMs = Date.now() - startTime;
        const elapsedSec = Math.floor(elapsedMs / 1000);
        process.stdout.write(`\r⏱️  Elapsed: ${formatTime(elapsedSec)}`);
    }, 500);

    const pendingBuilds: Promise<unknown>[] = [];

    for (let i = 0; i < names.length; i++) {
        const dataset = names[i];
        const buildName = getBuildName(dataset);
        const timestamp = new Date().toISOString();
        const index = i + 1;

        const buildPromise = buildAsync([buildName])
            .then((result) => {
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

        if (i < names.length - 1) {
            await sleep(intervalMs);
        }
    }

    await Promise.allSettled(pendingBuilds);

    clearInterval(clockInterval);
    process.stdout.write("\r\x1b[K");

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(
        `\n✨ ${dryRunLabel}Build complete: ${successful} successful, ${failed} failed`,
    );

    if (successful > 0 && !dryRun) {
        const successfulBuildNames = results
            .filter((r) => r.success)
            .map((r) => r.buildName);
        const fileName = getTimeString();
        const contents = successfulBuildNames.join("\n");
        const latestBuildsPath = writeReleaseRecord("latest-builds", contents);
        const timestampedBuildsPath = writeReleaseRecord(fileName, contents);
        console.log(
            `Recorded latest builds to ${latestBuildsPath} and ${timestampedBuildsPath}`,
        );
    } else if (successful > 0) {
        const successfulBuildNames = results
            .filter((r) => r.success)
            .map((r) => r.buildName);
        const fileName = getTimeString();
        const contents = successfulBuildNames.join("\n");
        const latestBuildsPath = writeReleaseRecord(
            "latest-builds",
            contents,
            "builds",
            "dry-run",
        );
        const timestampedBuildsPath = writeReleaseRecord(
            fileName,
            contents,
            "builds",
            "dry-run",
        );
        console.log(
            `${dryRunLabel}Recorded dry-run builds to ${latestBuildsPath} and ${timestampedBuildsPath}`,
        );
    }

    return results;
};

export { DATASETS };
