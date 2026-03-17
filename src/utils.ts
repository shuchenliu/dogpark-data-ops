import { UploadMode } from "./types.js";

const BASE_URL = "http://localhost:19180/";

const DEFAULT_INDEX_TARGET_LOCATION = "transltr";

function deleteOldBuild(name: string): Promise<Response> {
    return fetch(`${BASE_URL}build/${name}`, {
        method: "DELETE",
    });
}

function addNewBuildConfRequest(name: string): Promise<Response> {
    return fetch(`${BASE_URL}buildconf`, {
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

function addNewBuildRequest(name: string): Promise<Response> {
    // cohd_20260205_dasr1s => cohd, used to locate build config
    const buildConfName = name.split("_").slice(0, -2).join("_");

    return fetch(`${BASE_URL}build/${buildConfName}/new`, {
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
): Promise<Response> {
    const url = `${BASE_URL}index`;

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

function makeReIndexRequest(name: string): Promise<Response> {
    const url = `${BASE_URL}index`;
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
): Promise<Response> {
    return fetch(
        `${BASE_URL}source/${name}.${name.toLowerCase()}_${side}/upload`,
        {
            method: "PUT",
        },
    );
}

function makeDumpRequest(name: string, force = true): Promise<Response> {
    return fetch(`${BASE_URL}source/${name}/dump`, {
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
export const reDump = makeReMethods(makeDumpRequest);
export const deleteBuilds = makeReMethods(deleteOldBuild);
const addBuildConf = makeReMethods(addNewBuildConfRequest);
export const addNewBuild = makeReMethods(addNewBuildRequest);

function reUpload(names: string[], mode: UploadMode) {
    const requestPromises: Promise<Response>[] = names.reduce(
        (promises: Promise<Response>[], name) => {
            if (mode === "edge" || mode === "full") {
                promises.push(makeUploadRequest(name, "edges"));
            }

            if (mode === "node" || mode === "full") {
                promises.push(makeUploadRequest(name, "nodes"));
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
