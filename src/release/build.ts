import fs from "fs";
import { addNewBuild, sleep } from "../utils.js";
import { ALL_DATASETS, SPECIAL_DATASETS } from "../common.js";
import { getBuildName, getTimeString } from "./common.js";

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
    const results: BuildResult[] = [];
    const intervalMs = Math.floor(totalDurationMs / names.length);

    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
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

export { DATASETS };
