function getMetaURLs(name: string) {
    const base = `https://stars.renci.org/var/translator/releases/`;
    const graph = `${base}${name}/latest/graph-metadata.json`;
    const release = `${base}${name}/release-metadata.json`;

    return {
        graph,
        release,
    };
}

async function getMetaData<T>(url: string) {
    const res = await fetch(url);
    const data: unknown = await res.json();

    return data as T;
}

async function updateMetaField(
    indexName: string,
    payload: Record<string, unknown>,
) {
    const base = `http://localhost:9200/${indexName}/_mappings`;

    // 1. Fetch current mappings
    const res = await fetch(base);
    if (!res.ok) throw new Error(`Failed to fetch mapping: ${res.statusText}`);

    const data = await res.json();
    const originalMeta = data[indexName]?.mappings?._meta ?? {};

    // 2. Merge without unsafe `any`
    const newMeta: Record<string, unknown> = {
        ...originalMeta,
        ...payload,
    };

    // 3. Update only the _meta field
    return fetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            _meta: newMeta,
        }),
    });
}

async function updateMeta(name: string) {
    const urls = getMetaURLs(name);

    const keys = ["release", "graph"];

    const payload = {};
    for (const key of keys) {
        const url = urls[key as keyof typeof urls];
        const md = await getMetaData(url);
        payload[key] = md;
    }

    await updateMetaField(name, payload);
    // console.log(payload);
}

async function update() {
    const datasets = [
        // "diseases",
        // "gene2phenotype",
        // "go_cam",
        // "goa",
        // "hpoa",
        // "sider",
        "ctd",
        //
        // // newly added
        // "panther",
        // "ubergraph",
        // "ttd",
        // "alliance",
    ];

    for (const name of datasets) {
        await updateMeta(name);
        console.log(`${name} meta updated`);
    }
}

update();
