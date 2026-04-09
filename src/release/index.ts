import {
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    getActiveDeployConfigs,
    getDeployConfig,
    isDeployTarget,
    validateDeployClusterName,
} from "./common.js";
import { DATASETS, startAddNewBuilds } from "./build.js";
import { compareIndicesAcrossTargets } from "./compare.js";
import { startDumpJobs } from "./dump.js";
import { type StagingBatchConfig, releaseStaging } from "./staging.js";
import { releaseProd } from "./prod.js";
import { removeIndicesWithDeleteTag } from "./delete.js";
import { removeStoredBuilds } from "./remove-builds.js";
import { getHubUrl, pingHub } from "../utils.js";
import { ALL_DATASETS, DUMP_ONLY, SPECIAL_DATASETS } from "../common.js";
import {
    RUNTIME_CONFIG_PATH,
    isOnPremiseMode,
    setOnPremiseMode,
} from "../runtime-config.js";

(async function () {
    const args = process.argv.slice(2);

    // Parse flags
    const hasDump = args.includes("--dump");
    const hasCheck = args.includes("--check");
    const hasCompare = args.includes("--compare");
    const hasForceDump = args.includes("--force");
    const enableOnPremise = args.includes("--on-premise");
    const disableOnPremise =
        args.includes("--off-premise") || args.includes("--local");
    const showRuntimeConfig =
        args.includes("--show-config") || args.includes("--show-mode");
    const hasBuild = args.includes("-b") || args.includes("--build");
    const hasRemove = args.includes("-rb") || args.includes("--remove-build");
    const hasReleaseStaging =
        args.includes("-rs") || args.includes("--release-staging");
    const hasReleaseProd =
        args.includes("-rp") || args.includes("--release-prod");
    const hasRemoveDeleteTaggedIndices =
        args.includes("-rdi") ||
        args.includes("--remove-delete-tagged-indices") ||
        args.includes("--remove-del-tag-indices");
    const hasDryRun = args.includes("-d") || args.includes("--dry-run");
    const hasSkipMarkOldDeprForDeletion =
        args.includes("--skip-mark-old-depr-for-deletion") ||
        args.includes("--skip-mark-old-depr");
    const hasStagingPurgeMode =
        args.includes("--purge") || args.includes("--purge-mode");
    const hasStagingTagsOnly =
        args.includes("--tags-only") || args.includes("--skip-indexing");
    let dumpSourceName: string | undefined;
    const dumpSourceIndex = args.findIndex(
        (arg) => arg === "--source" || arg === "--dump-source",
    );
    if (dumpSourceIndex !== -1 && dumpSourceIndex + 1 < args.length) {
        const rawSourceName = args[dumpSourceIndex + 1];
        if (!rawSourceName.startsWith("-")) {
            dumpSourceName = rawSourceName;
        }
    }

    if (enableOnPremise && disableOnPremise) {
        throw new Error(
            "Cannot set both --on-premise and --off-premise in the same command",
        );
    }

    if (enableOnPremise) {
        setOnPremiseMode(true);
        console.log(
            `Persisted runtime mode: on-premise (${RUNTIME_CONFIG_PATH})`,
        );
    } else if (disableOnPremise) {
        setOnPremiseMode(false);
        console.log(`Persisted runtime mode: local (${RUNTIME_CONFIG_PATH})`);
    }

    const currentOnPremiseMode = isOnPremiseMode();
    const currentHubUrl = getHubUrl();
    const activeDeployConfigs = getActiveDeployConfigs();

    // Parse batch mode for staging
    let stagingBatch: StagingBatchConfig | undefined;
    const batchIndex = args.findIndex((arg) => arg === "--batch");
    if (batchIndex !== -1 && batchIndex + 1 < args.length) {
        const batchNumber = parseInt(args[batchIndex + 1], 10);
        if (isNaN(batchNumber) || batchNumber < 1) {
            throw new Error(`Invalid batch number: ${args[batchIndex + 1]}`);
        }
        let totalBatches = 5;
        const batchesIndex = args.findIndex((arg) => arg === "--batches");
        if (batchesIndex !== -1 && batchesIndex + 1 < args.length) {
            const parsed = parseInt(args[batchesIndex + 1], 10);
            if (isNaN(parsed) || parsed < 1) {
                throw new Error(
                    `Invalid total batches: ${args[batchesIndex + 1]}`,
                );
            }
            totalBatches = parsed;
        }
        if (batchNumber > totalBatches) {
            throw new Error(
                `Batch number ${batchNumber} exceeds total batches ${totalBatches}`,
            );
        }
        stagingBatch = { batchNumber, totalBatches };
    }

    // Parse deploy target (default: transltr)
    let deployTarget: DeployTarget = DEFAULT_DEPLOY_TARGET;
    const deployTargetIndex = args.findIndex(
        (arg) => arg === "--deploy-target" || arg === "--target",
    );
    if (deployTargetIndex !== -1 && deployTargetIndex + 1 < args.length) {
        const rawTarget = args[deployTargetIndex + 1];
        if (!isDeployTarget(rawTarget)) {
            throw new Error(
                `Invalid deploy target: ${rawTarget}. Must be one of: ${Object.keys(activeDeployConfigs).join(", ")}`,
            );
        }
        deployTarget = rawTarget;
    }

    // Parse duration argument (in seconds, default 3 minutes = 180 seconds)
    let durationSeconds = 180;
    const durationIndex = args.findIndex(
        (arg) => arg === "--duration" || arg === "-t",
    );
    if (durationIndex !== -1 && durationIndex + 1 < args.length) {
        const parsedDuration = parseInt(args[durationIndex + 1], 10);
        if (!isNaN(parsedDuration) && parsedDuration > 0) {
            durationSeconds = parsedDuration;
        }
    }

    // Parse filename for remove operation
    let removeFileName: string | undefined;
    const removeIndex = args.findIndex(
        (arg) => arg === "--remove-build" || arg === "-rb",
    );
    if (
        removeIndex !== -1 &&
        removeIndex + 1 < args.length &&
        !args[removeIndex + 1].startsWith("-")
    ) {
        removeFileName = args[removeIndex + 1];
    }

    // Parse filename for release staging operation
    let stagingFileName: string | undefined;
    const stagingIndex = args.findIndex(
        (arg) => arg === "--release-staging" || arg === "-rs",
    );
    if (
        stagingIndex !== -1 &&
        stagingIndex + 1 < args.length &&
        !args[stagingIndex + 1].startsWith("-")
    ) {
        stagingFileName = args[stagingIndex + 1];
    }

    // Parse filename for release prod operation
    let prodFileName: string | undefined;
    const prodIndex = args.findIndex(
        (arg) => arg === "--release-prod" || arg === "-rp",
    );
    if (
        prodIndex !== -1 &&
        prodIndex + 1 < args.length &&
        !args[prodIndex + 1].startsWith("-")
    ) {
        prodFileName = args[prodIndex + 1];
    }

    let compareSourceTarget: DeployTarget | undefined;
    let compareTargetName: DeployTarget | undefined;
    const compareIndex = args.findIndex((arg) => arg === "--compare");
    if (compareIndex !== -1) {
        const rawSourceTarget = args[compareIndex + 1];
        const rawTargetTarget = args[compareIndex + 2];

        if (
            rawSourceTarget &&
            !rawSourceTarget.startsWith("-") &&
            isDeployTarget(rawSourceTarget)
        ) {
            compareSourceTarget = rawSourceTarget;
        }

        if (
            rawTargetTarget &&
            !rawTargetTarget.startsWith("-") &&
            isDeployTarget(rawTargetTarget)
        ) {
            compareTargetName = rawTargetTarget;
        }
    }

    const compareFileIndex = args.findIndex(
        (arg) => arg === "--file" || arg === "--compare-file",
    );
    const compareFileName =
        compareFileIndex !== -1 &&
        compareFileIndex + 1 < args.length &&
        !args[compareFileIndex + 1].startsWith("-")
            ? args[compareFileIndex + 1]
            : undefined;

    // Define actions
    interface Action {
        check: () => boolean;
        execute: () => Promise<void>;
    }

    const actions: Action[] = [
        {
            check: () => hasCheck,
            execute: async () => {
                const deployConfig = getDeployConfig(deployTarget);
                const hubPing = await pingHub();
                const { ok, actualClusterName } =
                    await validateDeployClusterName(deployConfig);

                console.log(
                    `Runtime mode: ${currentOnPremiseMode ? "on-premise" : "local"}`,
                );
                console.log(`Hub URL: ${currentHubUrl}`);
                if (hubPing.ok) {
                    console.log(`✅ Hub reachable`);
                } else {
                    console.log(`❌ Hub unreachable: ${hubPing.error}`);
                }

                console.log(`Deploy target: ${deployConfig.target}`);
                console.log(`ES URL: ${deployConfig.ES_URL}`);
                console.log(
                    `Expected cluster_name: ${deployConfig.cluster_name}`,
                );
                console.log(
                    `Actual cluster_name: ${actualClusterName ?? "<unavailable>"}`,
                );
                console.log(
                    ok
                        ? "✅ Deploy target validated"
                        : "❌ Deploy target validation failed",
                );
            },
        },
        {
            check: () => hasCompare,
            execute: async () => {
                const sourceTarget = compareSourceTarget ?? deployTarget;
                const secondTarget = compareTargetName ?? "su12";
                await compareIndicesAcrossTargets({
                    fileName: compareFileName ?? "latest-builds.txt",
                    sourceTarget,
                    targetTarget: secondTarget,
                });
            },
        },
        {
            check: () => hasDump,
            execute: async () => {
                const specialStandalone = SPECIAL_DATASETS.filter(
                    (d) => d.standalone_plugin,
                ).map((d) => d.build_name);
                const allDumpTargets = [
                    ...ALL_DATASETS,
                    ...DUMP_ONLY,
                    ...specialStandalone,
                ];
                const targets = dumpSourceName
                    ? [dumpSourceName]
                    : allDumpTargets;

                if (
                    dumpSourceName &&
                    !allDumpTargets.includes(dumpSourceName)
                ) {
                    throw new Error(
                        `Invalid dump source: ${dumpSourceName}. Must be one of: ${allDumpTargets.join(", ")}`,
                    );
                }

                console.log(
                    `Starting dump process for ${targets.length} datasets...`,
                );
                await startDumpJobs(
                    targets,
                    durationSeconds * 1000,
                    hasDryRun,
                    hasForceDump,
                );
            },
        },
        {
            check: () => hasBuild,
            execute: async () => {
                console.log("Starting build process...");
                await startAddNewBuilds(
                    DATASETS,
                    durationSeconds * 1000,
                    hasDryRun,
                );
            },
        },
        {
            check: () => hasRemove,
            execute: async () => {
                console.log("Starting removal process...");
                await removeStoredBuilds(removeFileName, hasDryRun);
            },
        },
        {
            check: () => hasReleaseStaging,
            execute: async () => {
                console.log("Starting staging release process...");
                const targetFile = stagingFileName || "latest-builds.txt";
                await releaseStaging(
                    targetFile,
                    hasDryRun,
                    deployTarget,
                    hasStagingPurgeMode,
                    hasStagingTagsOnly,
                    stagingBatch,
                );
            },
        },
        {
            check: () => hasReleaseProd,
            execute: async () => {
                console.log("Starting prod release process...");
                const targetFile = prodFileName || "latest-builds.txt";
                await releaseProd(
                    targetFile,
                    hasDryRun,
                    !hasSkipMarkOldDeprForDeletion,
                    deployTarget,
                );
            },
        },
        {
            check: () => hasRemoveDeleteTaggedIndices,
            execute: async () => {
                console.log("Starting deletion of DEL_TAG indices...");
                await removeIndicesWithDeleteTag(hasDryRun, deployTarget);
            },
        },
    ];

    // Execute the first matching action
    const action = actions.find((a) => a.check());
    if (action) {
        await action.execute();
    } else if (showRuntimeConfig || enableOnPremise || disableOnPremise) {
        console.log(
            `Current runtime mode: ${currentOnPremiseMode ? "on-premise" : "local"}`,
        );
        console.log(`Runtime config file: ${RUNTIME_CONFIG_PATH}`);
        console.log(`Active hub URL: ${currentHubUrl}`);
        console.log(
            `Default deploy target: ${DEFAULT_DEPLOY_TARGET} (${activeDeployConfigs[DEFAULT_DEPLOY_TARGET].ES_URL})`,
        );
    } else {
        console.log(
            "Usage: npx tsx release.ts [--dump] [-b|--build] [-rb|--remove-build [filename]] [-rs|--release-staging [filename]] [-rp|--release-prod [filename]] [-rdi|--remove-delete-tagged-indices]",
        );
        console.log("\nRuntime options:");
        console.log(
            "  --on-premise                Persist on-premise mode and use the on-premise hub/deploy config defaults",
        );
        console.log(
            "  --off-premise, --local      Persist local mode and use the local hub/deploy config defaults",
        );
        console.log(
            "  --show-config, --show-mode  Show whether the CLI is currently in on-premise mode",
        );
        console.log("Dump options:");
        console.log(
            "  --check                     Ping the active hub and validate the current deploy target",
        );
        console.log(
            `  --compare <${Object.keys(activeDeployConfigs).join("|")}> <${Object.keys(activeDeployConfigs).join("|")}>  Compare record counts for listed indices across two deploy targets`,
        );
        console.log(
            "  --file, --compare-file [filename]  Build record file for --compare (defaults to latest-builds.txt)",
        );
        console.log(
            "  --dump                      Trigger dump for all datasets (includes dump-only and standalone plugins)",
        );
        console.log(
            "  --source, --dump-source <name>  Trigger dump for a single source only",
        );
        console.log(
            "  --force                     Force dump jobs when used with --dump",
        );
        console.log("\nBuild options:");
        console.log(
            "  -b, --build                 Initiate builds for all datasets",
        );
        console.log(
            "  -t, --duration <seconds>    Spread builds over N seconds (default: 180)",
        );
        console.log("\nRemoval options:");
        console.log(
            "  -rb, --remove-build [filename] Remove builds from file (defaults to release-records/builds/live/latest-builds.txt)",
        );
        console.log("\nStaging options:");
        console.log(
            "  -rs, --release-staging [filename] Release builds to staging (defaults to release-records/builds/live/latest-builds.txt)",
        );
        console.log(
            `  --deploy-target, --target <${Object.keys(activeDeployConfigs).join("|")}>  Deploy target for staging release (default: ${DEFAULT_DEPLOY_TARGET})`,
        );
        console.log(
            "  --purge, --purge-mode       Enable purge mode when starting staging index jobs (default: disabled)",
        );
        console.log(
            "  --tags-only, --skip-indexing Skip indexing, only assign staging tags",
        );
        console.log(
            "  --batch <number>            Process only the m-th batch of builds (1-indexed)",
        );
        console.log(
            "  --batches <n>               Total number of batches to split builds into (default: 5, requires --batch)",
        );
        console.log("\nProd options:");
        console.log(
            "  -rp, --release-prod [filename]  Release builds to prod on selected deploy target (defaults to release-records/builds/live/latest-builds.txt)",
        );
        console.log(
            "  --skip-mark-old-depr-for-deletion  Skip marking old deprecated indices with deletion tag",
        );
        console.log(
            "  --skip-mark-old-depr               (alias for --skip-mark-old-depr-for-deletion)",
        );
        console.log("\nDeletion options:");
        console.log(
            "  -rdi, --remove-delete-tagged-indices  Delete DEL_TAG indices on selected deploy target",
        );
        console.log(
            "  --remove-del-tag-indices              (alias for --remove-delete-tagged-indices)",
        );
        console.log("\nCommon options:");
        console.log(
            "  -d, --dry-run               Show what would happen without making actual requests",
        );
    }
})();
