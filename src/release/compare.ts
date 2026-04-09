import {
    type DeployTarget,
    getDeployConfig,
    getIndexStats,
    readNames,
    validateDeployClusterName,
} from "./common.js";

interface CompareOptions {
    fileName: string;
    sourceTarget: DeployTarget;
    targetTarget: DeployTarget;
}

const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const STATUS_MATCH = "OK";
const STATUS_MISMATCH = "DIFF";

const colorIfNeeded = (value: string, highlight: boolean) =>
    highlight ? `${RED}${value}${RESET}` : value;

const formatMetric = (left: string, right: string, matches: boolean) => {
    if (matches) {
        return "matched";
    }

    return `${colorIfNeeded(left, true)} | ${colorIfNeeded(right, true)}`;
};

const visibleLength = (value: string) => value.replace(ANSI_PATTERN, "").length;

const pad = (value: string, width: number) => {
    const paddingWidth = Math.max(0, width - visibleLength(value));
    return `${value}${" ".repeat(paddingWidth)}`;
};

export const compareIndicesAcrossTargets = async ({
    fileName,
    sourceTarget,
    targetTarget,
}: CompareOptions) => {
    if (sourceTarget === targetTarget) {
        throw new Error("Compare targets must be different");
    }

    const indexNames = readNames(fileName);
    const sourceConfig = getDeployConfig(sourceTarget);
    const targetConfig = getDeployConfig(targetTarget);
    const sameEsUrl = sourceConfig.ES_URL === targetConfig.ES_URL;
    const sameHostHeader = sourceConfig.host === targetConfig.host;

    if (sameEsUrl && sameHostHeader) {
        throw new Error(
            `Compare targets ${sourceTarget} and ${targetTarget} resolve to the same Elasticsearch endpoint (${sourceConfig.ES_URL}). Choose two targets with different ES settings.`,
        );
    }

    const [sourceValidation, targetValidation] = await Promise.all([
        validateDeployClusterName(sourceConfig),
        validateDeployClusterName(targetConfig),
    ]);

    if (!sourceValidation.ok) {
        throw new Error(
            `Source target ${sourceConfig.target} failed validation. Expected ${sourceConfig.cluster_name}, got ${sourceValidation.actualClusterName ?? "<unavailable>"}`,
        );
    }

    if (!targetValidation.ok) {
        throw new Error(
            `Target ${targetConfig.target} failed validation. Expected ${targetConfig.cluster_name}, got ${targetValidation.actualClusterName ?? "<unavailable>"}`,
        );
    }

    console.log(
        `Comparing ${indexNames.length} indices from ${fileName} between ${sourceTarget} and ${targetTarget}`,
    );
    console.log(
        `${sourceTarget}: ${sourceConfig.ES_URL} (${sourceValidation.actualClusterName})`,
    );
    console.log(
        `${targetTarget}: ${targetConfig.ES_URL} (${targetValidation.actualClusterName})`,
    );
    console.log("");

    const statusWidth = "STATUS".length;
    const indexWidth = Math.max(
        "INDEX".length,
        ...indexNames.map((name) => name.length),
    );
    const foundWidth = Math.max(
        12,
        `${sourceTarget}=false | ${targetTarget}=false`.length,
    );
    const recordsWidth = Math.max(
        12,
        `${sourceTarget}=1000000 | ${targetTarget}=1000000`.length,
    );

    console.log(
        [
            pad("STATUS", statusWidth),
            pad("INDEX", indexWidth),
            pad("FOUND", foundWidth),
            pad("RECORDS", recordsWidth),
        ].join("  "),
    );
    console.log(
        [
            "-".repeat(statusWidth),
            "-".repeat(indexWidth),
            "-".repeat(foundWidth),
            "-".repeat(recordsWidth),
        ].join("  "),
    );

    let matched = 0;
    let mismatched = 0;

    for (const indexName of indexNames) {
        const [sourceStats, targetStats] = await Promise.all([
            getIndexStats(indexName, sourceConfig.ES_URL, sourceConfig.host),
            getIndexStats(indexName, targetConfig.ES_URL, targetConfig.host),
        ]);

        const docsMatch = sourceStats.docsCount === targetStats.docsCount;
        const existsMatch = sourceStats.found === targetStats.found;
        const fullyMatched = docsMatch && existsMatch;
        const foundCell = formatMetric(
            `${sourceTarget}=${String(sourceStats.found)}`,
            `${targetTarget}=${String(targetStats.found)}`,
            existsMatch,
        );
        const recordsCell = formatMetric(
            `${sourceTarget}=${String(sourceStats.docsCount)}`,
            `${targetTarget}=${String(targetStats.docsCount)}`,
            docsMatch,
        );

        if (fullyMatched) {
            matched += 1;
            console.log(
                [
                    STATUS_MATCH,
                    pad(indexName, indexWidth),
                    pad(foundCell, foundWidth),
                    pad(recordsCell, recordsWidth),
                ]
                    .map((value, index) =>
                        index === 0 ? pad(value, statusWidth) : value,
                    )
                    .join("  "),
            );
            continue;
        }

        mismatched += 1;
        console.log(
            [
                STATUS_MISMATCH,
                pad(indexName, indexWidth),
                pad(foundCell, foundWidth),
                pad(recordsCell, recordsWidth),
            ]
                .map((value, index) =>
                    index === 0 ? pad(value, statusWidth) : value,
                )
                .join("  "),
        );
    }

    console.log(
        `\n✨ Compare complete: ${matched} matched, ${mismatched} mismatched`,
    );
};
