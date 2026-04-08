import { getHubUrl, sleep, startIndex, pingHub } from "../utils.js";
import {
    type AliasOperation,
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    STAGING_TAG,
    getDeployConfig,
    readNames,
    resolveSpecialDatasetForBuild,
    updateAliases,
    assertAliasesOk,
    validateDeployClusterName,
} from "./common.js";

export interface StagingBatchConfig {
    /** 1-indexed batch number */
    batchNumber: number;
    /** Total number of batches to split builds into (default 5) */
    totalBatches: number;
}

export const releaseStaging = async (
    fileName: string,
    dryRun = false,
    deployTarget: DeployTarget = DEFAULT_DEPLOY_TARGET,
    purgeMode = false,
    tagsOnly = false,
    batch?: StagingBatchConfig,
) => {
    const allBuildNames = readNames(fileName);
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    const hubUrl = getHubUrl();
    const deployConfig = getDeployConfig(deployTarget);
    const { ok, actualClusterName } =
        await validateDeployClusterName(deployConfig);
    const purgeModeLabel = purgeMode ? "ENABLED" : "DISABLED";
    const tagsOnlyLabel = tagsOnly ? "ENABLED" : "DISABLED";

    // Ping hub before proceeding (only needed when indexing)
    if (!tagsOnly) {
        const hubPing = await pingHub();
        if (!hubPing.ok) {
            if (dryRun) {
                console.warn(
                    `\x1b[31m${dryRunLabel}Warning: Hub unreachable at ${hubUrl} (${hubPing.error})\x1b[0m`,
                );
            } else {
                throw new Error(
                    `\x1b[31mHub unreachable at ${hubUrl} (${hubPing.error}). Aborting staging release.\x1b[0m`,
                );
            }
        } else {
            console.log(`${dryRunLabel}Hub reachable at ${hubUrl}`);
        }
    }

    // Apply batch slicing
    let buildNames: string[];
    let batchLabel: string;
    if (batch) {
        const { batchNumber, totalBatches } = batch;
        if (batchNumber < 1 || batchNumber > totalBatches) {
            throw new Error(
                `Invalid batch number ${batchNumber}: must be between 1 and ${totalBatches}`,
            );
        }
        const chunkSize = Math.ceil(allBuildNames.length / totalBatches);
        const start = (batchNumber - 1) * chunkSize;
        const end = start + chunkSize;
        buildNames = allBuildNames.slice(start, end);
        batchLabel = `batch ${batchNumber}/${totalBatches} (${buildNames.length} builds in this batch, ${allBuildNames.length} total)`;
    } else {
        buildNames = allBuildNames;
        batchLabel = "DISABLED";
    }

    if (!ok) {
        console.error(
            `${dryRunLabel}Aborting staging release due to cluster mismatch.`,
        );
        console.error(`${dryRunLabel}Target: ${deployConfig.target}`);
        console.error(`${dryRunLabel}ES URL: ${deployConfig.ES_URL}`);
        console.error(
            `${dryRunLabel}Expected cluster_name: ${deployConfig.cluster_name}`,
        );
        console.error(
            `${dryRunLabel}Actual cluster_name: ${actualClusterName ?? "<unavailable>"}`,
        );
        return;
    }

    const normalBuilds: string[] = [];
    const specialTagAssignments = new Map<string, string[]>();

    for (const buildName of buildNames) {
        const special = resolveSpecialDatasetForBuild(buildName);
        if (!special) {
            normalBuilds.push(buildName);
            continue;
        }

        if (special.staging_tag !== null) {
            const names = specialTagAssignments.get(special.staging_tag) ?? [];
            names.push(buildName);
            specialTagAssignments.set(special.staging_tag, names);
        }
    }

    if (dryRun) {
        console.log(
            `${dryRunLabel}Would release to target ${deployConfig.target} (${deployConfig.ES_URL})`,
        );
        console.log(`${dryRunLabel}Purge mode: ${purgeModeLabel}`);
        console.log(`${dryRunLabel}Tags-only mode: ${tagsOnlyLabel}`);
        console.log(`${dryRunLabel}Batch mode: ${batchLabel}`);
        console.log(
            `${dryRunLabel}Validated ES cluster_name: ${actualClusterName}`,
        );
        if (tagsOnly) {
            console.log(`${dryRunLabel}Would SKIP indexing (tags-only mode)`);
        } else {
            console.log(
                `${dryRunLabel}Would start indexing for ${buildNames.length} builds`,
            );
        }
        console.log(`${dryRunLabel}Would assign staging tags to:`);
        for (const buildName of buildNames) {
            const special = resolveSpecialDatasetForBuild(buildName);
            const tag = special ? special.staging_tag : STAGING_TAG;
            const tagLabel = tag ?? "(no tag)";
            console.log(`  ${buildName} -> ${tagLabel}`);
        }
    } else {
        console.log(
            `Validated ES cluster_name: ${actualClusterName} for target ${deployConfig.target}`,
        );
        console.log(`Purge mode: ${purgeModeLabel}`);
        console.log(`Tags-only mode: ${tagsOnlyLabel}`);
        console.log(`Batch mode: ${batchLabel}`);

        if (!tagsOnly) {
            // 1. release data
            await startIndex(
                buildNames,
                purgeMode ? "purge" : undefined,
                deployConfig.target,
            );
            console.log("indexing started");

            // 2. wait before assigning tags
            await sleep(10000);
        } else {
            console.log("Skipping indexing (tags-only mode)");
        }

        // assign tags based on dataset policy
        const operations: AliasOperation[] = [];

        if (normalBuilds.length > 0) {
            operations.push({
                action: "add",
                indices: normalBuilds,
                alias: STAGING_TAG,
            });
        }

        for (const [tag, names] of specialTagAssignments.entries()) {
            if (names.length > 0) {
                operations.push({
                    action: "add",
                    indices: names,
                    alias: tag,
                });
            }
        }

        if (operations.length > 0) {
            const aliasResponse = await updateAliases(
                operations,
                deployConfig.ES_URL,
                deployConfig.host,
            );
            await assertAliasesOk(aliasResponse);
        }

        console.log(`staging tags assigned (cluster: ${actualClusterName})`);
    }
};
