import {
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    deployConfigs,
    isDeployTarget,
} from "./common.js";
import { DATASETS, startAddNewBuilds } from "./build.js";
import { releaseStaging } from "./staging.js";
import { releaseProd } from "./prod.js";
import { removeIndicesWithDeleteTag } from "./delete.js";
import { removeStoredBuilds } from "./remove-builds.js";

(async function () {
    const args = process.argv.slice(2);

    // Parse flags
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
            "Usage: npx tsx release.ts [-b|--build] [-rb|--remove-build [filename]] [-rs|--release-staging [filename]] [-rp|--release-prod [filename]] [-rdi|--remove-delete-tagged-indices]",
        );
        console.log("Build options:");
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
