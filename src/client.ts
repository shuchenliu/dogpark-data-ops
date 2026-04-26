import { getAllDumpTargets } from "./common.js";
import {
    type RuntimeContext,
    type RuntimeContextOptions,
    resolveRuntimeContext,
} from "./runtime-context.js";
import { isOnPremiseMode, setOnPremiseMode } from "./runtime-config.js";
import { getHubUrl, pingHub } from "./utils.js";
import {
    DATASETS,
    type BuildResult,
    startAddNewBuilds,
} from "./release/build.js";
import { startDumpJobs, type DumpResult } from "./release/dump.js";
import { releaseStaging, type StagingBatchConfig } from "./release/staging.js";
import { releaseProd } from "./release/prod.js";
import { removeStoredBuilds } from "./release/remove-builds.js";
import { removeIndicesWithDeleteTag } from "./release/delete.js";
import { compareIndicesAcrossTargets } from "./release/compare.js";
import { runDogparkDataCommand } from "./release/index.js";
import {
    type DeployConfig,
    type DeployTarget,
    DEFAULT_DEPLOY_TARGET,
    getActiveDeployConfigs,
    getDeployConfig,
    validateDeployClusterName,
} from "./release/common.js";

export type DogparkRuntimeMode = "local" | "on-premise";

export type DogparkDataClientOptions = RuntimeContextOptions;

export interface DogparkRuntimeStatus {
    context: RuntimeContext;
    mode: DogparkRuntimeMode;
    hubUrl: string;
    defaultDeployTarget: DeployTarget;
    defaultDeployConfig: DeployConfig;
}

export interface DogparkConnectionCheckOptions {
    deployTarget?: DeployTarget;
}

export interface DogparkConnectionCheckResult {
    mode: DogparkRuntimeMode;
    hubUrl: string;
    hubReachable: boolean;
    hubError?: string;
    deployTarget: DeployTarget;
    esUrl: string;
    expectedClusterName: string;
    actualClusterName: string | null;
    deployTargetValid: boolean;
}

export interface DogparkBuildDatasetsOptions {
    datasets?: string[];
    durationSeconds?: number;
    dryRun?: boolean;
}

export interface DogparkDumpSourcesOptions {
    source?: string;
    durationSeconds?: number;
    dryRun?: boolean;
    force?: boolean;
}

export interface DogparkRemoveBuildsOptions {
    fileName?: string;
    dryRun?: boolean;
}

export interface DogparkReleaseStagingOptions {
    fileName?: string;
    deployTarget?: DeployTarget;
    dryRun?: boolean;
    purgeMode?: boolean;
    tagsOnly?: boolean;
    batch?: StagingBatchConfig;
}

export interface DogparkReleaseProdOptions {
    fileName?: string;
    deployTarget?: DeployTarget;
    dryRun?: boolean;
    markOldDeprecatedForDeletion?: boolean;
}

export interface DogparkCompareTargetsOptions {
    fileName?: string;
    sourceTarget: DeployTarget;
    targetTarget: DeployTarget;
}

export interface DogparkDeleteTaggedIndicesOptions {
    deployTarget?: DeployTarget;
    dryRun?: boolean;
}

export interface DogparkDataClient {
    context: RuntimeContext;
    run: (args: string[]) => Promise<void>;
    getRuntimeStatus: () => DogparkRuntimeStatus;
    setRuntimeMode: (mode: DogparkRuntimeMode) => DogparkRuntimeStatus;
    useLocalMode: () => DogparkRuntimeStatus;
    useOnPremiseMode: () => DogparkRuntimeStatus;
    checkConnection: (
        options?: DogparkConnectionCheckOptions,
    ) => Promise<DogparkConnectionCheckResult>;
    buildDatasets: (
        options?: DogparkBuildDatasetsOptions,
    ) => Promise<BuildResult[]>;
    dumpSources: (options?: DogparkDumpSourcesOptions) => Promise<DumpResult[]>;
    removeBuilds: (
        options?: DogparkRemoveBuildsOptions,
    ) => Promise<PromiseSettledResult<Response>[]>;
    releaseStaging: (options?: DogparkReleaseStagingOptions) => Promise<void>;
    releaseProd: (options?: DogparkReleaseProdOptions) => Promise<void>;
    compareTargets: (options: DogparkCompareTargetsOptions) => Promise<void>;
    deleteTaggedIndices: (
        options?: DogparkDeleteTaggedIndicesOptions,
    ) => Promise<void>;
}

const toDurationMs = (durationSeconds: number | undefined) =>
    (durationSeconds ?? 180) * 1000;

const getMode = (context: RuntimeContext): DogparkRuntimeMode =>
    isOnPremiseMode(context) ? "on-premise" : "local";

export const createDogparkDataClient = (
    options: DogparkDataClientOptions = {},
): DogparkDataClient => {
    const context = resolveRuntimeContext(options);

    const getRuntimeStatus = (): DogparkRuntimeStatus => {
        const activeDeployConfigs = getActiveDeployConfigs(context);

        return {
            context,
            mode: getMode(context),
            hubUrl: getHubUrl(context),
            defaultDeployTarget: DEFAULT_DEPLOY_TARGET,
            defaultDeployConfig: activeDeployConfigs[DEFAULT_DEPLOY_TARGET],
        };
    };

    const setRuntimeMode = (mode: DogparkRuntimeMode) => {
        setOnPremiseMode(mode === "on-premise", context);
        return getRuntimeStatus();
    };

    return {
        context,
        run: (args) => runDogparkDataCommand(args, context),
        getRuntimeStatus,
        setRuntimeMode,
        useLocalMode: () => setRuntimeMode("local"),
        useOnPremiseMode: () => setRuntimeMode("on-premise"),
        checkConnection: async (checkOptions = {}) => {
            const deployTarget =
                checkOptions.deployTarget ?? DEFAULT_DEPLOY_TARGET;
            const deployConfig = getDeployConfig(deployTarget, context);
            const [hubPing, deployValidation] = await Promise.all([
                pingHub(context),
                validateDeployClusterName(deployConfig),
            ]);

            return {
                mode: getMode(context),
                hubUrl: getHubUrl(context),
                hubReachable: hubPing.ok,
                hubError: hubPing.error,
                deployTarget,
                esUrl: deployConfig.ES_URL,
                expectedClusterName: deployConfig.cluster_name,
                actualClusterName: deployValidation.actualClusterName,
                deployTargetValid: deployValidation.ok,
            };
        },
        buildDatasets: (buildOptions = {}) =>
            startAddNewBuilds(
                buildOptions.datasets ?? DATASETS,
                toDurationMs(buildOptions.durationSeconds),
                buildOptions.dryRun ?? false,
                context,
            ),
        dumpSources: (dumpOptions = {}) => {
            const allDumpTargets = getAllDumpTargets();
            const targets = dumpOptions.source
                ? [dumpOptions.source]
                : allDumpTargets;

            if (
                dumpOptions.source &&
                !allDumpTargets.includes(dumpOptions.source)
            ) {
                throw new Error(
                    `Invalid dump source: ${dumpOptions.source}. Must be one of: ${allDumpTargets.join(", ")}`,
                );
            }

            return startDumpJobs(
                targets,
                toDurationMs(dumpOptions.durationSeconds),
                dumpOptions.dryRun ?? false,
                dumpOptions.force ?? false,
                context,
            );
        },
        removeBuilds: (removeOptions = {}) =>
            removeStoredBuilds(
                removeOptions.fileName,
                removeOptions.dryRun ?? false,
                context,
            ),
        releaseStaging: (stagingOptions = {}) =>
            releaseStaging(
                stagingOptions.fileName ?? "latest-builds.txt",
                stagingOptions.dryRun ?? false,
                stagingOptions.deployTarget ?? DEFAULT_DEPLOY_TARGET,
                stagingOptions.purgeMode ?? false,
                stagingOptions.tagsOnly ?? false,
                stagingOptions.batch,
                context,
            ),
        releaseProd: (prodOptions = {}) =>
            releaseProd(
                prodOptions.fileName ?? "latest-builds.txt",
                prodOptions.dryRun ?? false,
                prodOptions.markOldDeprecatedForDeletion ?? true,
                prodOptions.deployTarget ?? DEFAULT_DEPLOY_TARGET,
                context,
            ),
        compareTargets: (compareOptions) =>
            compareIndicesAcrossTargets({
                fileName: compareOptions.fileName ?? "latest-builds.txt",
                sourceTarget: compareOptions.sourceTarget,
                targetTarget: compareOptions.targetTarget,
                context,
            }),
        deleteTaggedIndices: (deleteOptions = {}) =>
            removeIndicesWithDeleteTag(
                deleteOptions.dryRun ?? false,
                deleteOptions.deployTarget ?? DEFAULT_DEPLOY_TARGET,
                context,
            ),
    };
};
