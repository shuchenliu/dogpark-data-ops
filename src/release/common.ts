import { customAlphabet } from "nanoid";
import fs from "fs";
import http from "http";
import { SPECIAL_DATASETS } from "../common.js";

// --- Special dataset resolution ---

const SPECIAL_DATASET_BY_BUILD_NAME = new Map(
    SPECIAL_DATASETS.map((dataset) => [dataset.build_name, dataset]),
);

export const getDatasetNameFromBuildName = (buildName: string): string => {
    const parts = buildName.split("_");
    if (parts.length <= 2) {
        return buildName;
    }

    return parts.slice(0, -2).join("_");
};

export const resolveSpecialDatasetForBuild = (buildName: string) => {
    const datasetName = getDatasetNameFromBuildName(buildName);
    return SPECIAL_DATASET_BY_BUILD_NAME.get(datasetName);
};

// --- Deploy config ---

export type DeployTarget = "transltr" | "su12" | "itrb-ci";

export interface DeployConfig {
    ES_URL: string;
    target: DeployTarget;
    cluster_name: string;
    host?: string; // Only for "itrb-ci" to specify the header
}

export const DEFAULT_DEPLOY_TARGET: DeployTarget = "transltr";

export const deployConfigs: Record<DeployTarget, DeployConfig> = {
    transltr: {
        ES_URL: "http://localhost:9200/",
        target: "transltr",
        cluster_name: "transltr-es8",
    },
    su12: {
        ES_URL: "http://localhost:9200/",
        target: "su12",
        cluster_name: "biothings_es8",
    },
    "itrb-ci": {
        host: "tier1-dogpark.ci.transltr.io:9200",
        ES_URL: "http://localhost:9200/",
        target: "itrb-ci",
        cluster_name: "es-tier1-cluster",
    },
};

export const isDeployTarget = (value: string): value is DeployTarget =>
    value in deployConfigs;

export const getDeployConfig = (target: DeployTarget): DeployConfig =>
    deployConfigs[target];

/**
 * Wrapper around fetch that optionally sets the Host header.
 * Uses http.request when a host override is needed because Node.js fetch (undici)
 * silently strips the Host header as a forbidden request header per the Fetch spec.
 */
const esFetch = (
    url: string,
    init?: RequestInit,
    host?: string,
): Promise<Response> => {
    if (!host) return fetch(url, init);

    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const reqHeaders: Record<string, string> = { Host: host };

        // Forward headers from init
        if (init?.headers) {
            const entries =
                init.headers instanceof Headers
                    ? [...init.headers.entries()]
                    : Object.entries(init.headers as Record<string, string>);
            for (const [k, v] of entries) {
                reqHeaders[k] = v;
            }
        }

        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || 80,
                path: parsed.pathname + parsed.search,
                method: init?.method ?? "GET",
                headers: reqHeaders,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    const body = Buffer.concat(chunks).toString("utf8");
                    const status = res.statusCode ?? 500;
                    resolve(
                        new Response(body, {
                            status,
                            statusText: res.statusMessage,
                            headers: res.headers as Record<string, string>,
                        }),
                    );
                });
            },
        );

        req.on("error", reject);

        if (init?.body) {
            req.write(
                typeof init.body === "string"
                    ? init.body
                    : JSON.stringify(init.body),
            );
        }

        req.end();
    });
};

// --- Tags ---

export const STAGING_TAG = "dingo_staging";
export const PROD_TAG = "dingo";
export const DEPR_TAG = "dingo_deprecated";
export const DEL_TAG = "dingo_to_be_deleted";

// --- Alias types and helpers ---

interface AddAliasAction {
    add: {
        index: string;
        alias: string;
    };
}

interface RemoveAliasAction {
    remove: {
        index: string;
        alias: string;
    };
}

type AliasAction = AddAliasAction | RemoveAliasAction;

type AliasResponse = Record<string, Record<string, unknown>>;

export interface DeleteIndicesResponse {
    acknowledged?: boolean;
}

export interface AliasOperation {
    action: "add" | "remove";
    indices: string[];
    alias: string;
}

const buildAliasPayload = (
    indices: string[],
    alias: string,
    action: "add" | "remove" = "add",
): { actions: AliasAction[] } => {
    return {
        actions: indices.map((index) =>
            action === "add"
                ? ({ add: { index, alias } } as AddAliasAction)
                : ({ remove: { index, alias } } as RemoveAliasAction),
        ),
    };
};

const buildBulkAliasPayload = (
    operations: AliasOperation[],
): { actions: AliasAction[] } => {
    const allActions = operations.flatMap(
        (op) => buildAliasPayload(op.indices, op.alias, op.action).actions,
    );
    return { actions: allActions };
};

export const updateAliases = async (
    operations: AliasOperation[],
    esUrl: string,
    hostHeader?: string,
): Promise<Response> => {
    const payload = buildBulkAliasPayload(operations);
    return await esFetch(
        `${esUrl}_aliases`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        },
        hostHeader,
    );
};

export const assertAliasesOk = async (response: Response) => {
    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `Elasticsearch alias update failed (HTTP ${response.status}): ${text}`,
        );
    }
};

const executeAliasActions =
    (action: "add" | "remove") =>
    async (
        names: string[],
        alias: string,
        esUrl: string,
        hostHeader?: string,
    ) => {
        const operations: AliasOperation[] = [
            { action, indices: names, alias },
        ];
        return updateAliases(operations, esUrl, hostHeader);
    };

export const assignAlias = executeAliasActions("add");
export const removeAlias = executeAliasActions("remove");

export const getIndexNamesWithAlias = async (
    alias: string,
    esUrl: string,
    hostHeader?: string,
): Promise<string[]> => {
    const res = await esFetch(`${esUrl}_alias/${alias}`, undefined, hostHeader);

    if (res.status === 404) {
        return [];
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Elasticsearch error: ${text}`);
    }

    const data = (await res.json()) as AliasResponse;
    return Object.keys(data).sort();
};

export const assignStagingTag = (
    names: string[],
    esUrl: string,
    hostHeader?: string,
) => assignAlias(names, STAGING_TAG, esUrl, hostHeader);
export const removeStagingTag = (
    names: string[],
    esUrl: string,
    hostHeader?: string,
) => removeAlias(names, STAGING_TAG, esUrl, hostHeader);
export const assignProdTag = (
    names: string[],
    esUrl: string,
    hostHeader?: string,
) => assignAlias(names, PROD_TAG, esUrl, hostHeader);
export const removeProdTag = (
    names: string[],
    esUrl: string,
    hostHeader?: string,
) => removeAlias(names, PROD_TAG, esUrl, hostHeader);

export const assignDeprTag = (
    names: string[],
    esUrl: string,
    hostHeader?: string,
) => assignAlias(names, DEPR_TAG, esUrl, hostHeader);
export const removeDeprTag = (
    names: string[],
    esUrl: string,
    hostHeader?: string,
) => removeAlias(names, DEPR_TAG, esUrl, hostHeader);

export const deleteIndices = async (
    indexNames: string[],
    esUrl: string,
    hostHeader?: string,
): Promise<DeleteIndicesResponse> => {
    const target = indexNames.map(encodeURIComponent).join(",");
    const response = await esFetch(
        `${esUrl}${target}`,
        { method: "DELETE" },
        hostHeader,
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `Elasticsearch index deletion failed (HTTP ${response.status}): ${text}`,
        );
    }

    const data = (await response.json()) as DeleteIndicesResponse;

    if (!data.acknowledged) {
        throw new Error(
            "Elasticsearch index deletion was not acknowledged by the cluster",
        );
    }

    return data;
};

// --- Name / time helpers ---

export const getDateString = () =>
    new Date().toISOString().slice(0, 10).replace(/-/g, "");

export const getTimeString = () =>
    new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);

export const getRandomString = () => {
    const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789");
    return nanoid(8);
};

export const getBuildName = (name: string) => {
    return `${name}_${getDateString()}_${getRandomString()}`;
};

export const readNames = (fileName: string) => {
    const nameWithExtension = fileName.endsWith(".txt")
        ? fileName
        : `${fileName}.txt`;
    const data = fs.readFileSync(nameWithExtension, "utf8");
    const buildNames = data.split(/\r?\n/).filter(Boolean);

    if (buildNames.length === 0) {
        throw new Error(`No names retrieved from "${nameWithExtension}"`);
    }

    return buildNames;
};

// --- Cluster validation ---

const getEsClusterName = async (
    esUrl: string,
    hostHeader?: string,
): Promise<string | null> => {
    try {
        const response = await esFetch(esUrl, undefined, hostHeader);
        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as { cluster_name?: unknown };
        return typeof payload.cluster_name === "string"
            ? payload.cluster_name
            : null;
    } catch {
        return null;
    }
};

export interface DeployClusterValidationResult {
    ok: boolean;
    actualClusterName: string | null;
}

export const validateDeployClusterName = async (
    deployConfig: DeployConfig,
): Promise<DeployClusterValidationResult> => {
    const actualClusterName = await getEsClusterName(
        deployConfig.ES_URL,
        deployConfig.host,
    );

    if (!actualClusterName) {
        return { ok: false, actualClusterName: null };
    }

    return {
        ok: actualClusterName === deployConfig.cluster_name,
        actualClusterName,
    };
};
