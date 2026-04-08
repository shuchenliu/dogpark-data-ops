export const ALL_DATASETS = [
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

export const DUMP_ONLY = ["ncbi_gene", "tier0_kg"];

export interface SpecialDataset {
    build_name: string;
    /** Alias to assign during staging. null means skip tagging entirely. */
    staging_tag: string | null;
    /** Alias to use as the prod tag for this dataset. */
    prod_tag: string;
}

export const SPECIAL_DATASETS: SpecialDataset[] = [
    {
        build_name: "ubergraph_nodes_info",
        staging_tag: null,
        prod_tag: "ubergraph_nodes_mapping",
    },
    {
        build_name: "ubergraph_nodes",
        staging_tag: null,
        prod_tag: "ubergraph_nodes",
    },
];
