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

export const readRuntimeConfig = (): RuntimeConfig => {
    try {
        const raw = fs.readFileSync(RUNTIME_CONFIG_PATH, "utf8");
        const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;

        return {
            onPremise: parsed.onPremise === true,
        };
    } catch {
        return DEFAULT_RUNTIME_CONFIG;
    }
};

export const writeRuntimeConfig = (config: RuntimeConfig) => {
    fs.writeFileSync(
        RUNTIME_CONFIG_PATH,
        JSON.stringify(config, null, 2),
        "utf8",
    );
};

export const isOnPremiseMode = () => readRuntimeConfig().onPremise;

export const setOnPremiseMode = (onPremise: boolean) => {
    const nextConfig: RuntimeConfig = { onPremise };
    writeRuntimeConfig(nextConfig);
    return nextConfig;
};
