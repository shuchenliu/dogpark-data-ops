import { MongoClient, Db } from "mongodb";

const MONGO_URI = "mongodb://su11:27017";
const DB_NAME = "dogpark_src";

const COLLECTIONS = [
    "alliance",
    "bgee",
    "chembl",
    "cohd",
    "ctd",
    "ctkp",
    "dakp",
    "dgidb",
    "diseases",
    "drug_rep_hub",
    "gene2phenotype",
    "geneticskp",
    "go_cam",
    "goa",
    "gtopdb",
    "hpoa",
    "icees",
    "intact",
    "panther",
    "semmeddb",
    "sider",
    "signor",
    "tmkp",
    "ttd",
    "ubergraph",
];

async function checkQualifiers(db: Db) {
    const targetField = "aggregator_knowledge_source";

    for (const name of COLLECTIONS) {
        const collection = db.collection(`${name}_edges`);

        const exists = await collection.findOne(
            { [targetField]: { $exists: true } },
            { projection: { _id: 1 } },
        );

        if (exists) {
            console.log(`✅ ${name}: ${targetField} exists`);
        } else {
            console.log(`❌ ${name}: ${targetField} NOT found`);
        }
    }
}

async function main() {
    const client = new MongoClient(MONGO_URI, {
        proxyHost: "127.0.0.1",
        proxyPort: 1080,
    });

    try {
        await client.connect();
        const db = client.db(DB_NAME);

        await checkQualifiers(db);
    } finally {
        await client.close();
    }
}

main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
