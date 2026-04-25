import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RUNTIME_CONFIG_FILE = fileURLToPath(import.meta.url);

export const REPO_ROOT = path.resolve(path.dirname(RUNTIME_CONFIG_FILE), "..");
export const RUNTIME_CONFIG_PATH = path.join(
    REPO_ROOT,
    ".dogpark-release-config.json",
);

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

export const readRuntimeConfig = (): RuntimeConfig => {
    let raw: string;

    try {
        raw = fs.readFileSync(RUNTIME_CONFIG_PATH, "utf8");
    } catch (error) {
        if (isMissingFileError(error)) {
            writeRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
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
            `Expected runtime config at ${RUNTIME_CONFIG_PATH} to be a JSON object`,
        );
    }

    const config = parsed as Partial<RuntimeConfig>;
    return {
        onPremise: config.onPremise === true,
    };
};

export const writeRuntimeConfig = (config: RuntimeConfig) => {
    fs.writeFileSync(
        RUNTIME_CONFIG_PATH,
        `${JSON.stringify(config, null, 2)}\n`,
        "utf8",
    );
};

export const isOnPremiseMode = () => readRuntimeConfig().onPremise;

export const setOnPremiseMode = (onPremise: boolean) => {
    const nextConfig: RuntimeConfig = { onPremise };
    writeRuntimeConfig(nextConfig);
    return nextConfig;
};
