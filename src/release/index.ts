import {
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    deployConfigs,
    isDeployTarget,
} from "./common.js";
import { DATASETS, startAddNewBuilds } from "./build.js";
import { type StagingBatchConfig, releaseStaging } from "./staging.js";
import { releaseProd } from "./prod.js";
import { removeIndicesWithDeleteTag } from "./delete.js";
import { removeStoredBuilds } from "./remove-builds.js";
import { checkHubSource, dump, HUB_URL, pingHub } from "../utils.js";
import { ALL_DATASETS, DUMP_ONLY, SPECIAL_DATASETS } from "../common.js";

(async function () {
    const args = process.argv.slice(2);

    // Parse flags
    const hasDump = args.includes("--dump");
    const hasForceDump = args.includes("--force");
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
                `Invalid deploy target: ${rawTarget}. Must be one of: ${Object.keys(deployConfigs).join(", ")}`,
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

    // Define actions
    interface Action {
        check: () => boolean;
        execute: () => Promise<void>;
    }

    const actions: Action[] = [
        {
            check: () => hasDump,
            execute: async () => {
                const specialStandalone = SPECIAL_DATASETS.filter(
                    (d) => d.standalone_plugin,
                ).map((d) => d.build_name);
                const targets = [
                    ...ALL_DATASETS,
                    ...DUMP_ONLY,
                    ...specialStandalone,
                ];
                console.log(
                    `Starting dump process for ${targets.length} datasets...`,
                );

                const dryRunLabel = hasDryRun ? "[DRY RUN] " : "";
                const hubPing = await pingHub();
                if (!hubPing.ok) {
                    if (hasDryRun) {
                        console.warn(
                            `\x1b[31m${dryRunLabel}Warning: Hub unreachable at ${HUB_URL} (${hubPing.error})\x1b[0m`,
                        );
                    } else {
                        throw new Error(
                            `\x1b[31mHub unreachable at ${HUB_URL} (${hubPing.error}). Aborting dump.\x1b[0m`,
                        );
                    }
                } else {
                    console.log(`${dryRunLabel}Hub reachable at ${HUB_URL}`);
                }

                if (hasDryRun) {
                    console.log(`${dryRunLabel}Force mode: ${hasForceDump}`);
                    console.log(
                        `${dryRunLabel}Would dump the following datasets:`,
                    );
                    if (!hubPing.ok) {
                        for (const target of targets) {
                            console.log(
                                `• ${dryRunLabel}${target} (source existence could not be confirmed because hub is unreachable)`,
                            );
                        }
                        return;
                    }
                    for (const target of targets) {
                        const sourceStatus = await checkHubSource(target);
                        if (sourceStatus.exists) {
                            console.log(
                                `✅ ${dryRunLabel}${target} source exists on hub`,
                            );
                        } else if (sourceStatus.error) {
                            console.log(
                                `⚠️  ${dryRunLabel}${target} source could not be confirmed on hub (${sourceStatus.error})`,
                            );
                        } else {
                            console.log(
                                `❌ ${dryRunLabel}${target} source not found on hub`,
                            );
                        }
                    }
                    return;
                }

                const statuses = await dump(targets, hasForceDump);
                for (let i = 0; i < statuses.length; i++) {
                    const res = statuses[i];
                    if (res.status !== "fulfilled" || !res.value.ok) {
                        console.log(`${targets[i]} errored out`, res);
                    }
                }
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
    } else {
        console.log(
            "Usage: npx tsx release.ts [--dump] [-b|--build] [-rb|--remove-build [filename]] [-rs|--release-staging [filename]] [-rp|--release-prod [filename]] [-rdi|--remove-delete-tagged-indices]",
        );
        console.log("Dump options:");
        console.log(
            "  --dump                      Trigger dump for all datasets (includes dump-only and standalone plugins)",
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
            "  -rb, --remove-build [filename] Remove builds from file (defaults to latest-builds.txt)",
        );
        console.log("\nStaging options:");
        console.log(
            "  -rs, --release-staging [filename] Release builds to staging (defaults to latest-builds.txt)",
        );
        console.log(
            "  --deploy-target, --target <transltr|su12|itrb-ci>  Deploy target for staging release (default: transltr)",
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
            "  -rp, --release-prod [filename]  Release builds to prod on selected deploy target (defaults to latest-builds.txt)",
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
