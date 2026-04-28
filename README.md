## About

Quick data operation scripts for Dogpark Ranger service

## Install From Git

Add this package to the consuming project's `package.json` with a pinned Git
tag:

```json
{
    "dependencies": {
        "dogpark-data-ops": "github:shuchenliu/dogpark-data-ops#v0.1.0"
    }
}
```

Then run `pnpm install` in the consuming project. The repo does not commit
`lib/`; Git dependency installs build it from `src/` through the package
`prepare` script.

## CLI Runtime

The release tooling keeps mutable runtime state outside the package install
directory. Pass an explicit workspace root when invoking it from automation:

```bash
dogpark-data --workspace-root /path/to/dogpark-data-ops --show-config
```

The CLI resolves runtime files in this order:

1. `--workspace-root` / `--root`
2. `DOGPARK_DATA_OPS_ROOT`
3. The current working directory

MCP tools can import the structured client directly:

```ts
import { createDogparkDataClient } from "dogpark-data-ops";

const dogpark = createDogparkDataClient({
    workspaceRoot: "/path/to/dogpark-data-ops",
});

const status = dogpark.getRuntimeStatus();
await dogpark.checkConnection();
await dogpark.getExistingSourcesOnHub();
await dogpark.dumpSources({
    releaseDatasets: ["alliance", "bgee"],
    dumpOnlyDatasets: ["ncbi_gene"],
    dryRun: true,
});
await dogpark.buildDatasets({
    releaseDatasets: ["alliance", "bgee"],
    dryRun: true,
});
await dogpark.releaseStaging({ fileName: "latest-builds.txt", dryRun: true });
```

The workspace root owns `.dogpark-release-config.json`, `release-records/`, and
relative input files such as `latest-builds.txt`.

See [MCP Integration](docs/mcp-integration.md) for the structured client API and
recommended MCP tool flow.
