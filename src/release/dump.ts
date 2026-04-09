import { checkHubSource, dump, getHubUrl, pingHub, sleep } from "../utils.js";

interface DumpResult {
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
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
};

export const startDumpJobs = async (
    names: string[],
    totalDurationMs: number = 180000,
    dryRun: boolean = false,
    force: boolean = false,
): Promise<DumpResult[]> => {
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    const hubUrl = getHubUrl();

    const hubPing = await pingHub();
    if (!hubPing.ok) {
        if (dryRun) {
            console.warn(
                `\x1b[31m${dryRunLabel}Warning: Hub unreachable at ${hubUrl} (${hubPing.error})\x1b[0m`,
            );
        } else {
            throw new Error(
                `\x1b[31mHub unreachable at ${hubUrl} (${hubPing.error}). Aborting dump.\x1b[0m`,
            );
        }
    } else {
        console.log(`${dryRunLabel}Hub reachable at ${hubUrl}`);
    }

    const results: DumpResult[] = [];
    const intervalMs = Math.floor(totalDurationMs / names.length);

    console.log(
        `${dryRunLabel}Starting to dump ${names.length} datasets over ${totalDurationMs}ms (~${intervalMs}ms between each)`,
    );
    console.log(`${dryRunLabel}Force mode: ${force}`);

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
            const sourceStatus = await checkHubSource(name);
            const timestamp = new Date().toISOString();

            if (sourceStatus.exists) {
                results.push({ dataset: name, success: true, timestamp });
                console.log(
                    `✅ [${index}/${names.length}] ${dryRunLabel}${name} source exists on hub`,
                );
            } else if (sourceStatus.error) {
                results.push({
                    dataset: name,
                    success: false,
                    timestamp,
                    error: sourceStatus.error,
                });
                console.log(
                    `⚠️  [${index}/${names.length}] ${dryRunLabel}${name} source could not be confirmed on hub (${sourceStatus.error})`,
                );
            } else {
                results.push({
                    dataset: name,
                    success: false,
                    timestamp,
                    error: "source not found on hub",
                });
                console.log(
                    `❌ [${index}/${names.length}] ${dryRunLabel}${name} source not found on hub`,
                );
            }

            if (i < names.length - 1) {
                await sleep(intervalMs);
            }
        }

        const successful = results.filter((r) => r.success).length;
        const failed = results.length - successful;
        console.log(
            `\n✨ ${dryRunLabel}Dump check complete: ${successful} successful, ${failed} failed`,
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

        const dumpPromise = dump([dataset], force)
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
                        `✅ [${index}/${names.length}] ${dataset} dump started`,
                    );
                } else if (settled.status === "fulfilled") {
                    results.push({
                        dataset,
                        success: false,
                        timestamp,
                        error: `HTTP ${settled.value.status}`,
                    });
                    console.log(
                        `❌ [${index}/${names.length}] ${dataset} failed: HTTP ${settled.value.status}`,
                    );
                } else {
                    results.push({
                        dataset,
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
                    success: false,
                    timestamp,
                    error: err instanceof Error ? err.message : String(err),
                });
                console.log(
                    `❌ [${index}/${names.length}] ${dataset} error: ${err instanceof Error ? err.message : String(err)}`,
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
        `\n✨ Dump complete: ${successful} successful, ${failed} failed`,
    );

    return results;
};
