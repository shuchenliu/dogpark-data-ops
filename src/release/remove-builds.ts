import { deleteBuilds } from "../utils.js";
import { readNames } from "./common.js";
import type { RuntimeContextOptions } from "../runtime-context.js";

/**
 * Removes builds specified in a file.
 *
 * Reads build names from the provided file and deletes each one.
 * If no filename is provided, defaults to release-records/builds/live/latest-builds.txt.
 *
 * @param fileName - Path to file containing build names (one per line). Defaults to "latest-builds.txt" if not provided or "latest"
 * @param dryRun - If true, only logs what would happen without making actual requests (default: false)
 * @returns Array of deletion results
 */
export const removeStoredBuilds = async (
    fileName?: string,
    dryRun = false,
    context?: RuntimeContextOptions,
): Promise<PromiseSettledResult<Response>[]> => {
    // Default to the shared latest builds artifact if no filename is provided
    const targetFile =
        !fileName || fileName === "latest" ? "latest-builds.txt" : fileName;
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";

    console.log(`${dryRunLabel}Removing builds from ${targetFile}...`);

    const buildNames = readNames(targetFile, context);
    console.log(`Found ${String(buildNames.length)} builds to remove`);

    const results: PromiseSettledResult<Response>[] = dryRun
        ? buildNames.map(
              () =>
                  ({
                      status: "fulfilled",
                      value: new Response(null, { status: 204 }),
                  }) satisfies PromiseFulfilledResult<Response>,
          )
        : await deleteBuilds(buildNames, context);

    // Log individual results
    buildNames.forEach((buildName, index) => {
        const result = results[index];
        if (result.status === "fulfilled") {
            if (dryRun) {
                console.log(`✅ Would remove ${buildName}`);
            } else {
                const response = result.value;
                if (response.ok) {
                    console.log(`✅ Removed ${buildName}`);
                } else {
                    const status = String(response.status);
                    console.log(
                        `❌ Failed to remove ${buildName}: HTTP ${status}`,
                    );
                }
            }
        } else {
            console.log(
                `❌ Failed to remove ${buildName}: ${String(result.reason)}`,
            );
        }
    });

    // Log summary
    const successful = results.filter((result) => {
        if (dryRun) {
            return result.status === "fulfilled";
        }
        return result.status === "fulfilled" && result.value.ok;
    }).length;
    const failed = results.length - successful;
    console.log(
        `\n✨ ${dryRunLabel}Removal complete: ${String(successful)} successful, ${String(failed)} failed`,
    );

    return results;
};
