import { pingHub, HUB_URL } from "../utils.js";
import {
    type AliasOperation,
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    STAGING_TAG,
    PROD_TAG,
    DEPR_TAG,
    DEL_TAG,
    assertAliasesOk,
    getDeployConfig,
    getIndexNamesWithAlias,
    getTimeString,
    readNames,
    resolveSpecialDatasetForBuild,
    updateAliases,
    validateDeployClusterName,
    writeReleaseRecord,
} from "./common.js";

export const releaseProd = async (
    buildRecordName: string,
    dryRun = false,
    markOldDeprForDeletion = true,
    deployTarget: DeployTarget = DEFAULT_DEPLOY_TARGET,
) => {
    const dryRunLabel = dryRun ? "[DRY RUN] " : "";
    const deployConfig = getDeployConfig(deployTarget);
    const { ok, actualClusterName } =
        await validateDeployClusterName(deployConfig);

    // Ping hub before proceeding
    const hubPing = await pingHub();
    if (!hubPing.ok) {
        if (dryRun) {
            console.warn(
                `\x1b[31m${dryRunLabel}Warning: Hub unreachable at ${HUB_URL} (${hubPing.error})\x1b[0m`,
            );
        } else {
            throw new Error(
                `\x1b[31mHub unreachable at ${HUB_URL} (${hubPing.error}). Aborting prod release.\x1b[0m`,
            );
        }
    } else {
        console.log(`${dryRunLabel}Hub reachable at ${HUB_URL}`);
    }

    if (!ok) {
        console.error(
            `${dryRunLabel}Aborting prod release due to cluster mismatch.`,
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

    // 1. get target staging indices
    const stagingCandidates = readNames(buildRecordName);
    if (stagingCandidates.length === 0) {
        throw new Error("No staging indices provided for prod release");
    }

    // Partition into normal and special candidates
    const normalCandidates = stagingCandidates.filter(
        (name) => !resolveSpecialDatasetForBuild(name),
    );
    const specialCandidates = stagingCandidates.filter((name) =>
        Boolean(resolveSpecialDatasetForBuild(name)),
    );
    const resolvedSpecial = specialCandidates.map((name) => {
        const entry = resolveSpecialDatasetForBuild(name);
        if (!entry)
            throw new Error(`No special dataset config found for ${name}`);
        return { name, entry };
    });

    if (dryRun) {
        const prodNames = await getIndexNamesWithAlias(
            PROD_TAG,
            deployConfig.ES_URL,
            deployConfig.host,
        );
        const oldDeprNames = markOldDeprForDeletion
            ? await getIndexNamesWithAlias(
                  DEPR_TAG,
                  deployConfig.ES_URL,
                  deployConfig.host,
              )
            : [];
        console.log(
            `${dryRunLabel}Would run prod release on ${deployConfig.target} (${deployConfig.ES_URL})`,
        );
        console.log(
            `${dryRunLabel}Validated ES cluster_name: ${actualClusterName}`,
        );
        console.log(
            `${dryRunLabel}Would switch prod alias to ${normalCandidates.length} staging indices`,
        );
        console.log(`${dryRunLabel}Would promote staging indices:`);
        normalCandidates.forEach((name) => console.log(`  ${name}`));
        if (resolvedSpecial.length > 0) {
            console.log(
                `${dryRunLabel}Would promote special indices (custom prod tags):`,
            );
            for (const { name, entry } of resolvedSpecial) {
                const currentHolders = await getIndexNamesWithAlias(
                    entry.prod_tag,
                    deployConfig.ES_URL,
                    deployConfig.host,
                );
                console.log(`  ${name} -> ${entry.prod_tag}`);
                if (currentHolders.length > 0) {
                    console.log(`    current holder(s) to be deprecated:`);
                    currentHolders.forEach((h) => console.log(`      ${h}`));
                } else {
                    console.log(`    (no current holder)`);
                }
            }
        }
        console.log(`${dryRunLabel}Current prod indices (${PROD_TAG}):`);
        prodNames.forEach((name) => console.log(`  ${name}`));
        console.log(
            `${dryRunLabel}Would deprecate current prod indices and clear staging tags`,
        );
        if (markOldDeprForDeletion && oldDeprNames.length > 0) {
            console.log(
                `${dryRunLabel}Would mark ${oldDeprNames.length} old deprecated indices for deletion:`,
            );
            oldDeprNames.forEach((name) => console.log(`  ${name}`));
        }
        const fileName = getTimeString();
        const deprFileName = `depr-${fileName}-dry-run.txt`;
        const deprFilePath = writeReleaseRecord(
            deprFileName,
            prodNames.join("\n"),
        );
        console.log(
            `${dryRunLabel}Recorded deprecated indices to ${deprFilePath}`,
        );
        return;
    }

    // 0. get current prod indices
    const prodNames = await getIndexNamesWithAlias(
        PROD_TAG,
        deployConfig.ES_URL,
        deployConfig.host,
    );

    const stagingNames = new Set<string>(
        await getIndexNamesWithAlias(
            STAGING_TAG,
            deployConfig.ES_URL,
            deployConfig.host,
        ),
    );

    // ensure normal candidates are indeed staging indices
    for (const candidate of normalCandidates) {
        if (!stagingNames.has(candidate)) {
            throw new Error(`${candidate} is not a staging index`);
        }
    }

    // 1.5. get old deprecated indices if we need to mark them for deletion
    const oldDeprNames = markOldDeprForDeletion
        ? await getIndexNamesWithAlias(
              DEPR_TAG,
              deployConfig.ES_URL,
              deployConfig.host,
          )
        : [];

    // 2. build alias operations for normal candidates
    const operations: AliasOperation[] = [
        { action: "add", indices: normalCandidates, alias: PROD_TAG },
        { action: "remove", indices: prodNames, alias: PROD_TAG },
        { action: "add", indices: prodNames, alias: DEPR_TAG },
        { action: "remove", indices: normalCandidates, alias: STAGING_TAG },
    ];

    // 2a. handle special candidates: use their prod_tag, deprecate old holder
    for (const { name, entry } of resolvedSpecial) {
        const currentProdHolders = await getIndexNamesWithAlias(
            entry.prod_tag,
            deployConfig.ES_URL,
            deployConfig.host,
        );
        operations.push({
            action: "add",
            indices: [name],
            alias: entry.prod_tag,
        });
        if (currentProdHolders.length > 0) {
            operations.push({
                action: "remove",
                indices: currentProdHolders,
                alias: entry.prod_tag,
            });
            operations.push({
                action: "add",
                indices: currentProdHolders,
                alias: DEPR_TAG,
            });
        }
        // remove staging_tag if it had one
        if (entry.staging_tag !== null) {
            operations.push({
                action: "remove",
                indices: [name],
                alias: entry.staging_tag,
            });
        }
    }

    if (markOldDeprForDeletion && oldDeprNames.length > 0) {
        operations.push({
            action: "add",
            indices: oldDeprNames,
            alias: DEL_TAG,
        });
        console.log(
            `Marking ${oldDeprNames.length} old deprecated indices for deletion`,
        );
    }

    const aliasResponse = await updateAliases(
        operations,
        deployConfig.ES_URL,
        deployConfig.host,
    );

    await assertAliasesOk(aliasResponse);

    // 3. store deprecated names for rollback (only after alias update succeeds)
    const fileName = getTimeString();
    const deprFilePath = writeReleaseRecord(
        `depr-${fileName}`,
        prodNames.join("\n"),
    );
    console.log(`Recorded deprecated indices to ${deprFilePath}`);
};
