import { checkHubSource, dump, getHubUrl, pingHub, sleep } from "../utils.js";
import type { RuntimeContextOptions } from "../runtime-context.js";

export interface DumpResult {
    dataset: string;
    success: boolean;
    timestamp: string;
    error?: string;
}

const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${String(hours)}h ${String(minutes)}m ${String(secs)}s`;
    } else if (minutes > 0) {
        return `${String(minutes)}m ${String(secs)}s`;
    } else {
        return `${String(secs)}s`;
    }
};

export const startDumpJobs = async (
    names: string[],
    totalDurationMs = 180000,
    dryRun = false,
    force = false,
    context?: RuntimeContextOptions,
): Promise<DumpResult[]> => {
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    const hubUrl = getHubUrl(context);

    const hubPing = await pingHub(context);
    if (!hubPing.ok) {
        if (dryRun) {
            console.warn(
                `\x1b[31m${dryRunLabel}Warning: Hub unreachable at ${hubUrl} (${hubPing.error ?? "<unknown>"})\x1b[0m`,
            );
        } else {
            throw new Error(
                `\x1b[31mHub unreachable at ${hubUrl} (${hubPing.error ?? "<unknown>"}). Aborting dump.\x1b[0m`,
            );
        }
    } else {
        console.log(`${dryRunLabel}Hub reachable at ${hubUrl}`);
    }

    const results: DumpResult[] = [];
    const intervalMs = Math.floor(totalDurationMs / names.length);

    console.log(
        `${dryRunLabel}Starting to dump ${String(names.length)} datasets over ${String(totalDurationMs)}ms (~${String(intervalMs)}ms between each)`,
    );
    console.log(`${dryRunLabel}Force mode: ${String(force)}`);

    if (dryRun) {
        if (!hubPing.ok) {
            for (const name of names) {
                results.push({
                    dataset: name,
                    success: false,
                    timestamp: new Date().toISOString(),
                    error: "source existence could not be confirmed because hub is unreachable",
                });
                console.log(
                    `• ${dryRunLabel}${name} (source existence could not be confirmed because hub is unreachable)`,
                );
            }

            return results;
        }

        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const index = i + 1;
            const sourceStatus = await checkHubSource(name, context);
            const timestamp = new Date().toISOString();

            if (sourceStatus.exists) {
                results.push({ dataset: name, success: true, timestamp });
                console.log(
                    `✅ [${String(index)}/${String(names.length)}] ${dryRunLabel}${name} source exists on hub`,
                );
            } else if (sourceStatus.error) {
                results.push({
                    dataset: name,
                    success: false,
                    timestamp,
                    error: sourceStatus.error,
                });
                console.log(
                    `⚠️  [${String(index)}/${String(names.length)}] ${dryRunLabel}${name} source could not be confirmed on hub (${sourceStatus.error})`,
                );
            } else {
                results.push({
                    dataset: name,
                    success: false,
                    timestamp,
                    error: "source not found on hub",
                });
                console.log(
                    `❌ [${String(index)}/${String(names.length)}] ${dryRunLabel}${name} source not found on hub`,
                );
            }

            if (i < names.length - 1) {
                await sleep(intervalMs);
            }
        }

        const successful = results.filter((r) => r.success).length;
        const failed = results.length - successful;
        console.log(
            `\n✨ ${dryRunLabel}Dump check complete: ${String(successful)} successful, ${String(failed)} failed`,
        );

        return results;
    }

    const startTime = Date.now();

    const clockInterval = setInterval(() => {
        const elapsedMs = Date.now() - startTime;
        const elapsedSec = Math.floor(elapsedMs / 1000);
        process.stdout.write(`\r⏱️  Elapsed: ${formatTime(elapsedSec)}`);
    }, 500);

    const pendingDumps: Promise<unknown>[] = [];

    for (let i = 0; i < names.length; i++) {
        const dataset = names[i];
        const timestamp = new Date().toISOString();
        const index = i + 1;

        const dumpPromise = dump([dataset], force, context)
            .then((result) => {
                process.stdout.write("\r\x1b[K");
                const settled = result[0];

                if (settled.status === "fulfilled" && settled.value.ok) {
                    results.push({
                        dataset,
                        success: true,
                        timestamp,
                    });
                    console.log(
                        `✅ [${String(index)}/${String(names.length)}] ${dataset} dump started`,
                    );
                } else if (settled.status === "fulfilled") {
                    const statusCode = String(settled.value.status);
                    results.push({
                        dataset,
                        success: false,
                        timestamp,
                        error: `HTTP ${statusCode}`,
                    });
                    console.log(
                        `❌ [${String(index)}/${String(names.length)}] ${dataset} failed: HTTP ${statusCode}`,
                    );
                } else {
                    const errorMessage = String(settled.reason);
                    results.push({
                        dataset,
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
                    success: false,
                    timestamp,
                    error: errorMessage,
                });
                console.log(
                    `❌ [${String(index)}/${String(names.length)}] ${dataset} error: ${errorMessage}`,
                );
            });

        pendingDumps.push(dumpPromise);

        if (i < names.length - 1) {
            await sleep(intervalMs);
        }
    }

    await Promise.allSettled(pendingDumps);

    clearInterval(clockInterval);
    process.stdout.write("\r\x1b[K");

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;
    console.log(
        `\n✨ Dump complete: ${String(successful)} successful, ${String(failed)} failed`,
    );

    return results;
};
