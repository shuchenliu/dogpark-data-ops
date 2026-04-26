import fs from "fs";
import path from "path";
import {
    type RuntimeContextOptions,
    resolveRuntimeContext,
} from "./runtime-context.js";

export interface RuntimeConfig {
    onPremise: boolean;
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
    onPremise: false,
};

const isMissingFileError = (error: unknown): error is NodeJS.ErrnoException =>
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT";

export const getRuntimeConfigPath = (context?: RuntimeContextOptions) =>
    resolveRuntimeContext(context).runtimeConfigPath;

export const readRuntimeConfig = (
    context?: RuntimeContextOptions,
): RuntimeConfig => {
    const runtimeConfigPath = getRuntimeConfigPath(context);
    let raw: string;

    try {
        raw = fs.readFileSync(runtimeConfigPath, "utf8");
    } catch (error) {
        if (isMissingFileError(error)) {
            writeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, context);
            return DEFAULT_RUNTIME_CONFIG;
        }

        throw error;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
    ) {
        throw new Error(
            `Expected runtime config at ${runtimeConfigPath} to be a JSON object`,
        );
    }

    const config = parsed as Partial<RuntimeConfig>;
    return {
        onPremise: config.onPremise === true,
    };
};

export const writeRuntimeConfig = (
    config: RuntimeConfig,
    context?: RuntimeContextOptions,
) => {
    const runtimeConfigPath = getRuntimeConfigPath(context);
    fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
    fs.writeFileSync(
        runtimeConfigPath,
        `${JSON.stringify(config, null, 4)}\n`,
        "utf8",
    );
};

export const isOnPremiseMode = (context?: RuntimeContextOptions) =>
    readRuntimeConfig(context).onPremise;

export const setOnPremiseMode = (
    onPremise: boolean,
    context?: RuntimeContextOptions,
) => {
    const nextConfig: RuntimeConfig = { onPremise };
    writeRuntimeConfig(nextConfig, context);
    return nextConfig;
};
