export const DEFAULT_RELEASE_DATASETS = [
    "alliance",
    "bgee",
    "bindingdb",
    "chembl",
    "cohd",
    "ctd",
    "ctkp",
    "dakp",
    "dgidb",
    "diseases",
    "drug_rep_hub",
    "drugcentral",
    "gene2phenotype",
    "geneticskp",
    "go_cam",
    "goa",
    "gtopdb",
    "hpoa",
    "icees",
    "intact",
    "panther",
    "pathbank",
    "semmeddb",
    "sider",
    "signor",
    "tmkp",
    "ttd",
    "ubergraph",
];

export const DEFAULT_DUMP_ONLY_DATASETS = ["ncbi_gene", "tier0_kg"];

export interface SpecialDataset {
    build_name: string;
    /** Alias to assign during staging. null means skip tagging entirely. */
    staging_tag: string | null;
    /** Alias to use as the prod tag for this dataset. */
    prod_tag: string;
    /** whether we should expect a standalone plugin during dumping phase**/
    standalone_plugin?: boolean;
}

export const SPECIAL_DATASETS: SpecialDataset[] = [
    {
        build_name: "ubergraph_nodes_info",
        staging_tag: null,
        prod_tag: "ubergraph_nodes_mapping",
        standalone_plugin: true,
    },
    {
        build_name: "ubergraph_nodes",
        staging_tag: null,
        prod_tag: "ubergraph_nodes",
    },
];

export interface DatasetSelectionOptions {
    releaseDatasets?: readonly string[];
    dumpOnlyDatasets?: readonly string[];
}

const unique = (names: readonly string[]) => [...new Set(names)];

const getStandaloneSpecialDatasets = () =>
    SPECIAL_DATASETS.filter((dataset) => dataset.standalone_plugin).map(
        (dataset) => dataset.build_name,
    );

const getSpecialBuildDatasets = () =>
    SPECIAL_DATASETS.map((dataset) => dataset.build_name);

export const getBuildDatasets = (
    options: DatasetSelectionOptions = {},
): string[] =>
    unique([
        ...(options.releaseDatasets ?? DEFAULT_RELEASE_DATASETS),
        ...getSpecialBuildDatasets(),
    ]);

export const getDumpTargets = (
    options: DatasetSelectionOptions = {},
): string[] => {
    return unique([
        ...(options.releaseDatasets ?? DEFAULT_RELEASE_DATASETS),
        ...(options.dumpOnlyDatasets ?? DEFAULT_DUMP_ONLY_DATASETS),
        ...getStandaloneSpecialDatasets(),
    ]);
};
