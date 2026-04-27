import { addNewBuild, getHubUrl, sleep, pingHub } from "../utils.js";
import {
    formatElapsedTime,
    getBuildName,
    getTimeString,
    writeReleaseRecord,
} from "./common.js";
import type { RuntimeContextOptions } from "../runtime-context.js";

export interface BuildResult {
    dataset: string;
    buildName: string;
    success: boolean;
    timestamp: string;
    error?: string;
}

const mockAddNewBuild = (names: string[], _context?: RuntimeContextOptions) => {
    return Promise.resolve(names.map(() => ({ status: "fulfilled" as const })));
};

export const startAddNewBuilds = async (
    names: string[],
    totalDurationMs = 180000,
    dryRun = false,
    context?: RuntimeContextOptions,
): Promise<BuildResult[]> => {
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    const hubUrl = getHubUrl(context);

    // Ping hub before proceeding
    const hubPing = await pingHub(context);
    if (!hubPing.ok) {
        if (dryRun) {
            console.warn(
                `\x1b[31m${dryRunLabel}Warning: Hub unreachable at ${hubUrl} (${hubPing.error ?? "<unknown>"})\x1b[0m`,
            );
        } else {
            throw new Error(
                `\x1b[31mHub unreachable at ${hubUrl} (${hubPing.error ?? "<unknown>"}). Aborting build.\x1b[0m`,
            );
        }
    } else {
        console.log(`${dryRunLabel}Hub reachable at ${hubUrl}`);
    }

    const results: BuildResult[] = [];
    const intervalMs = Math.floor(totalDurationMs / names.length);

    console.log(
        `${dryRunLabel}Starting to add ${String(names.length)} builds over ${String(totalDurationMs)}ms (~${String(intervalMs)}ms between each)`,
    );

    const buildAsync = dryRun ? mockAddNewBuild : addNewBuild;

    const startTime = Date.now();

    const clockInterval = setInterval(() => {
        const elapsedMs = Date.now() - startTime;
        const elapsedSec = Math.floor(elapsedMs / 1000);
        process.stdout.write(`\r⏱️  Elapsed: ${formatElapsedTime(elapsedSec)}`);
    }, 500);

    const pendingBuilds: Promise<unknown>[] = [];

    for (let i = 0; i < names.length; i++) {
        const dataset = names[i];
        const buildName = getBuildName(dataset);
        const timestamp = new Date().toISOString();
        const index = i + 1;

        const buildPromise = buildAsync([buildName], context)
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
                        `✅ [${String(index)}/${String(names.length)}] ${dryRunLabel}${dataset} -> ${buildName}`,
                    );
                } else {
                    const errorMessage = String(settled.reason);
                    results.push({
                        dataset,
                        buildName,
                        success: false,
                        timestamp,
                        error: errorMessage,
                    });
                    console.log(
                        `❌ [${String(index)}/${String(names.length)}] ${dataset} failed: ${errorMessage}`,
                    );
                }
                return result;
            })
            .catch((err: unknown) => {
                const errorMessage =
                    err instanceof Error ? err.message : String(err);
                process.stdout.write("\r\x1b[K");
                results.push({
                    dataset,
                    buildName,
                    success: false,
                    timestamp,
                    error: errorMessage,
                });
                console.log(
                    `❌ [${String(index)}/${String(names.length)}] ${dataset} error: ${errorMessage}`,
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
        `\n✨ ${dryRunLabel}Build complete: ${String(successful)} successful, ${String(failed)} failed`,
    );

    if (successful > 0 && !dryRun) {
        const successfulBuildNames = results
            .filter((r) => r.success)
            .map((r) => r.buildName);
        const fileName = getTimeString();
        const contents = successfulBuildNames.join("\n");
        const latestBuildsPath = writeReleaseRecord(
            "latest-builds",
            contents,
            undefined,
            undefined,
            context,
        );
        const timestampedBuildsPath = writeReleaseRecord(
            fileName,
            contents,
            undefined,
            undefined,
            context,
        );
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
            context,
        );
        const timestampedBuildsPath = writeReleaseRecord(
            fileName,
            contents,
            "builds",
            "dry-run",
            context,
        );
        console.log(
            `${dryRunLabel}Recorded dry-run builds to ${latestBuildsPath} and ${timestampedBuildsPath}`,
        );
    }

    return results;
};
