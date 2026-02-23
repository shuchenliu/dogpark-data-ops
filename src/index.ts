import { reindex, reDump } from "./utils.js";

// function reindex(names: string[]) {
//     const requestPromises: Promise<Response>[] = names.map((name) =>
//         makeIndexRequest(name),
//     );
//
//     return Promise.allSettled(requestPromises);
// }

function examineResults(
    results: PromiseSettledResult<Response>[],
    datasets: string[],
) {
    for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res.status !== "fulfilled" || !res.value.ok) {
            console.log(`${datasets[i]} errored out`, res);
        }
    }
}

async function main() {
    // `dump` triggers uploading as well. Good for new datasets
    // const statuses = await reDump(datasets);
    // only need to upload edges by default
    // const statuses = await reUpload(["ttd"], "edge");
    // const statuses = await reUpload(datasets, "node");
    // await deleteBuilds(datasets);
    // const statuses0 = await addBuildConf(datasets);
    // examineResults(statuses0, datasets);
    // const statuses1 = await addNewBuild(datasets);
    // examineResults(statuses1, datasets);
    // const statuses = await reindex(datasets);
}

main();
