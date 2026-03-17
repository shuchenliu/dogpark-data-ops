import { deleteBuilds } from "../utils.js";
import { readNames } from "./common.js";

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
export const removeStoredBuilds = async (
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
