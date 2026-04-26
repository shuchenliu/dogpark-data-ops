import {
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    PROD_TAG,
    DEPR_TAG,
    DEL_TAG,
    assertAliasesOk,
    getDeployConfig,
    getIndexNamesWithAlias,
    getTimeString,
    readNames,
    updateAliases,
    validateDeployClusterName,
    writeReleaseRecord,
} from "./common.js";
import type { RuntimeContextOptions } from "../runtime-context.js";

export const rollBackIndices = async (
    deprRecordFileName: string,
    deployTarget: DeployTarget = DEFAULT_DEPLOY_TARGET,
    context?: RuntimeContextOptions,
) => {
    if (!deprRecordFileName.startsWith("depr")) {
        throw new Error("Not a valid depr record");
    }

    const deployConfig = getDeployConfig(deployTarget, context);
    const { ok, actualClusterName } =
        await validateDeployClusterName(deployConfig);

    if (!ok) {
        console.error("Aborting rollback due to cluster mismatch.");
        console.error(`Target: ${deployConfig.target}`);
        console.error(`ES URL: ${deployConfig.ES_URL}`);
        console.error(`Expected cluster_name: ${deployConfig.cluster_name}`);
        console.error(
            `Actual cluster_name: ${actualClusterName ?? "<unavailable>"}`,
        );
        return;
    }

    const prodNames = await getIndexNamesWithAlias(
        PROD_TAG,
        deployConfig.ES_URL,
        deployConfig.host,
    );
    const indexNames = readNames(deprRecordFileName, context);

    const aliasResponse = await updateAliases(
        [
            { action: "add", indices: indexNames, alias: PROD_TAG },
            { action: "remove", indices: indexNames, alias: DEPR_TAG },
            { action: "remove", indices: indexNames, alias: DEL_TAG },
            { action: "remove", indices: prodNames, alias: PROD_TAG },
            { action: "add", indices: prodNames, alias: DEPR_TAG },
        ],
        deployConfig.ES_URL,
        deployConfig.host,
    );

    await assertAliasesOk(aliasResponse);

    const fileName = getTimeString();
    const deprFilePath = writeReleaseRecord(
        `depr-${fileName}`,
        prodNames.join("\n"),
        undefined,
        undefined,
        context,
    );
    console.log(`Recorded deprecated indices to ${deprFilePath}`);
};
