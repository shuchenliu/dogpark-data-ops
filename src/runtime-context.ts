import path from "path";

export const WORKSPACE_ROOT_ENV = "DOGPARK_DATA_OPS_ROOT";
export const DEFAULT_RUNTIME_CONFIG_FILE = ".dogpark-release-config.json";
export const DEFAULT_RELEASE_RECORDS_DIR = "release-records";

export interface RuntimeContextOptions {
    workspaceRoot?: string;
    runtimeConfigPath?: string;
    releaseRecordsDir?: string;
}

export interface RuntimeContext {
    workspaceRoot: string;
    runtimeConfigPath: string;
    releaseRecordsDir: string;
}

const resolveFromWorkspace = (workspaceRoot: string, targetPath: string) =>
    path.isAbsolute(targetPath)
        ? path.resolve(targetPath)
        : path.resolve(workspaceRoot, targetPath);

export const resolveRuntimeContext = (
    options: RuntimeContextOptions = {},
): RuntimeContext => {
    const workspaceRoot = path.resolve(
        options.workspaceRoot ??
            process.env[WORKSPACE_ROOT_ENV] ??
            process.cwd(),
    );

    return {
        workspaceRoot,
        runtimeConfigPath: resolveFromWorkspace(
            workspaceRoot,
            options.runtimeConfigPath ?? DEFAULT_RUNTIME_CONFIG_FILE,
        ),
        releaseRecordsDir: resolveFromWorkspace(
            workspaceRoot,
            options.releaseRecordsDir ?? DEFAULT_RELEASE_RECORDS_DIR,
        ),
    };
};
