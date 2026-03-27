import { sleep, startIndex } from "../utils.js";
import {
    type AliasOperation,
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    STAGING_TAG,
    assignAlias,
    assignStagingTag,
    getDeployConfig,
    readNames,
    resolveSpecialDatasetForBuild,
    updateAliases,
    assertAliasesOk,
    validateDeployClusterName,
} from "./common.js";

export const releaseStaging = async (
    fileName: string,
    dryRun = false,
    deployTarget: DeployTarget = DEFAULT_DEPLOY_TARGET,
    purgeMode = false,
    tagsOnly = false,
) => {
    const buildNames = readNames(fileName);
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    const deployConfig = getDeployConfig(deployTarget);
    const { ok, actualClusterName } =
        await validateDeployClusterName(deployConfig);
    const purgeModeLabel = purgeMode ? "ENABLED" : "DISABLED";
    const tagsOnlyLabel = tagsOnly ? "ENABLED" : "DISABLED";

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
            );
            await assertAliasesOk(aliasResponse);
        }

        console.log(`staging tags assigned (cluster: ${actualClusterName})`);
    }
};
