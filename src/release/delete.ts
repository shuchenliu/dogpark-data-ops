import {
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    DEL_TAG,
    deleteIndices,
    getDeployConfig,
    getIndexNamesWithAlias,
    validateDeployClusterName,
} from "./common.js";

export const removeIndicesWithDeleteTag = async (
    dryRun: boolean = false,
    deployTarget: DeployTarget = DEFAULT_DEPLOY_TARGET,
): Promise<void> => {
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    const deployConfig = getDeployConfig(deployTarget);
    const { ok, actualClusterName } =
        await validateDeployClusterName(deployConfig);

    if (!ok) {
        console.error(
            `${dryRunLabel}Aborting index deletion due to cluster mismatch.`,
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

    const indexNames = await getIndexNamesWithAlias(
        DEL_TAG,
        deployConfig.ES_URL,
        deployConfig.host,
    );

    if (indexNames.length === 0) {
        console.log(`${dryRunLabel}No indices found with alias ${DEL_TAG}`);
        return;
    }

    console.log(
        `${dryRunLabel}Target ${deployConfig.target} validated (cluster: ${actualClusterName})`,
    );
    console.log(
        `${dryRunLabel}Found ${indexNames.length} indices tagged for deletion (${DEL_TAG})`,
    );

    indexNames.forEach((indexName) => {
        console.log(
            dryRun
                ? `✅ Would delete ${indexName}`
                : `🗑 Deleting ${indexName}`,
        );
    });

    if (dryRun) {
        console.log(
            `\n✨ ${dryRunLabel}Deletion complete: ${indexNames.length} successful, 0 failed`,
        );
        return;
    }

    await deleteIndices(indexNames, deployConfig.ES_URL, deployConfig.host);

    console.log(
        `\n✨ Deletion complete: ${indexNames.length} successful, 0 failed`,
    );
};
