import { UploadMode } from "./types.js";
import { isOnPremiseMode } from "./runtime-config.js";
import type { RuntimeContextOptions } from "./runtime-context.js";

export const DEFAULT_HUB_URL = "http://localhost:19180/";
export const ON_PREMISE_HUB_URL = "http://su06:19180/";

const DEFAULT_INDEX_TARGET_LOCATION = "transltr";
const HUB_REQUEST_TIMEOUT_MS = 10_000;

export const getHubUrl = (context?: RuntimeContextOptions) =>
    isOnPremiseMode(context) ? ON_PREMISE_HUB_URL : DEFAULT_HUB_URL;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const parseHubSourceNames = (payload: unknown) => {
    if (!isRecord(payload)) {
        throw new Error(
            "Hub sources response must include a result or results array",
        );
    }

    const results = Array.isArray(payload.results)
        ? payload.results
        : payload.result;

    if (!Array.isArray(results)) {
        throw new Error(
            "Hub sources response must include a result or results array",
        );
    }

    return results.map((entry, index) => {
        if (!isRecord(entry) || typeof entry.name !== "string") {
            throw new Error(
                `Hub sources response entry ${String(index)} is missing a string name`,
            );
        }

        return entry.name;
    });
};

export const pingHub = async (
    context?: RuntimeContextOptions,
): Promise<{ ok: boolean; error?: string }> => {
    const hubUrl = getHubUrl(context);
    try {
        const response = await fetch(hubUrl, {
            signal: AbortSignal.timeout(HUB_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            return { ok: false, error: `HTTP ${String(response.status)}` };
        }
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
};

export const getHubSourceNames = async (
    context?: RuntimeContextOptions,
): Promise<string[]> => {
    const hubUrl = getHubUrl(context);
    const sourcesUrl = `${hubUrl}sources`;

    try {
        const response = await fetch(sourcesUrl, {
            signal: AbortSignal.timeout(HUB_REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${String(response.status)}`);
        }

        const payload = (await response.json()) as unknown;
        return parseHubSourceNames(payload);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Hub sources request failed at ${sourcesUrl}: ${errorMessage}`,
        );
    }
};

export const checkHubSource = async (
    name: string,
    context?: RuntimeContextOptions,
): Promise<{ exists: boolean; error?: string; status?: number }> => {
    const hubUrl = getHubUrl(context);
    try {
        const response = await fetch(`${hubUrl}source/${name}`, {
            signal: AbortSignal.timeout(HUB_REQUEST_TIMEOUT_MS),
        });

        if (response.ok) {
            return { exists: true, status: response.status };
        }

        if (response.status === 404) {
            return { exists: false, status: response.status };
        }

        return {
            exists: false,
            status: response.status,
            error: `HTTP ${String(response.status)}`,
        };
    } catch (err) {
        return {
            exists: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
};

function deleteOldBuild(
    name: string,
    context?: RuntimeContextOptions,
): Promise<Response> {
    return fetch(`${getHubUrl(context)}build/${name}`, {
        method: "DELETE",
    });
}

function addNewBuildConfRequest(
    name: string,
    context?: RuntimeContextOptions,
): Promise<Response> {
    return fetch(`${getHubUrl(context)}buildconf`, {
        method: "POST",
        body: JSON.stringify({
            name,
            doc_type: "knowledge",
            sources: [`${name}_edges`],
            roots: [`${name}_edges`],
            builder_class: "biothings.hub.databuild.builder.LinkDataBuilder",
            params: {},
            archived: false,
        }),
    });
}

function addNewBuildRequest(
    name: string,
    context?: RuntimeContextOptions,
): Promise<Response> {
    // cohd_20260205_dasr1s => cohd, used to locate build config
    const buildConfName = name.split("_").slice(0, -2).join("_");

    return fetch(`${getHubUrl(context)}build/${buildConfName}/new`, {
        method: "PUT",
        body: JSON.stringify({
            target_name: name,
            force: true,
        }),
    });
}

interface IndexPyalod {
    build_name: string;
    index_name: string | null;
    indexer_env: string;
    mode?: string;
}

function makeIndexRequest(
    name: string,
    mode?: string,
    indexerEnv = DEFAULT_INDEX_TARGET_LOCATION,
    context?: RuntimeContextOptions,
): Promise<Response> {
    const url = `${getHubUrl(context)}index`;

    const payload: IndexPyalod = {
        build_name: name,
        index_name: null,
        indexer_env: indexerEnv,
    };

    if (mode === "purge") {
        payload.mode = mode;
    }

    return fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

function makeReIndexRequest(
    name: string,
    context?: RuntimeContextOptions,
): Promise<Response> {
    const url = `${getHubUrl(context)}index`;
    return fetch(url, {
        method: "PUT",
        body: JSON.stringify({
            build_name: name.toLowerCase(),
            index_name: name.toLowerCase(),
            mode: "purge",
            indexer_env: DEFAULT_INDEX_TARGET_LOCATION,
        }),
    });
}

function makeUploadRequest(
    name: string,
    side: "nodes" | "edges",
    context?: RuntimeContextOptions,
): Promise<Response> {
    return fetch(
        `${getHubUrl(context)}source/${name}.${name.toLowerCase()}_${side}/upload`,
        {
            method: "PUT",
        },
    );
}

function makeDumpRequest(
    name: string,
    force = false,
    context?: RuntimeContextOptions,
): Promise<Response> {
    return fetch(`${getHubUrl(context)}source/${name}/dump`, {
        method: "PUT",
        body: JSON.stringify({
            force,
        }),
    });
}

const makeReMethods =
    <TArgs extends unknown[]>(
        requestMethod: (name: string, ...args: TArgs) => Promise<Response>,
    ) =>
    (names: string[], ...args: TArgs) => {
        const requestPromises: Promise<Response>[] = names.map((name) =>
            requestMethod(name, ...args),
        );

        return Promise.allSettled(requestPromises);
    };
export const reindex = makeReMethods(makeReIndexRequest);
export const startIndex = makeReMethods(makeIndexRequest);
export const dump = makeReMethods(makeDumpRequest);
export const reDump = (names: string[], context?: RuntimeContextOptions) =>
    dump(names, true, context);
export const deleteBuilds = makeReMethods(deleteOldBuild);
const addBuildConf = makeReMethods(addNewBuildConfRequest);
export const addNewBuild = makeReMethods(addNewBuildRequest);

function reUpload(
    names: string[],
    mode: UploadMode,
    context?: RuntimeContextOptions,
) {
    const requestPromises: Promise<Response>[] = names.reduce(
        (promises: Promise<Response>[], name) => {
            if (mode === "edge" || mode === "full") {
                promises.push(makeUploadRequest(name, "edges", context));
            }

            if (mode === "node" || mode === "full") {
                promises.push(makeUploadRequest(name, "nodes", context));
            }

            return promises;
        },
        [],
    );

    return Promise.allSettled(requestPromises);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
