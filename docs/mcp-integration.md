# MCP Integration

This package is now set up so an MCP server can call Dogpark data operations
without shelling out to the CLI. The recommended entrypoint is the structured
client factory:

```ts
import { createDogparkDataClient } from "dogpark-data-ops";

const workspaceRoot = process.env.DOGPARK_DATA_OPS_ROOT;

if (!workspaceRoot) {
    throw new Error("DOGPARK_DATA_OPS_ROOT is required");
}

const dogpark = createDogparkDataClient({
    workspaceRoot,
});
```

The client binds `workspaceRoot` once. Every method then resolves local runtime
state from that workspace:

- `.dogpark-release-config.json`
- `release-records/`
- relative input files such as `latest-builds.txt`

## Build And Install

When using this package from a local checkout, build it first:

```bash
pnpm build
```

An MCP server in another project can depend on this checkout locally:

```bash
pnpm add file:/path/to/dogpark-data-ops
```

If the package is packed or published, `lib/` is included through
`package.json`, so consumers do not need to build it themselves.

## Runtime Root

Set the workspace root in the MCP server environment:

```bash
DOGPARK_DATA_OPS_ROOT=/path/to/dogpark-data-ops
```

Then bind it once at server startup:

```ts
const workspaceRoot = process.env.DOGPARK_DATA_OPS_ROOT;

if (!workspaceRoot) {
    throw new Error("DOGPARK_DATA_OPS_ROOT is required");
}

const dogpark = createDogparkDataClient({ workspaceRoot });
```

## Package Exports

Use these exports from the package root:

```ts
import {
    createDogparkDataClient,
    getRuntimeConfigPath,
    isOnPremiseMode,
    readRuntimeConfig,
    resolveRuntimeContext,
    runDogparkDataCommand,
    setOnPremiseMode,
    writeRuntimeConfig,
} from "dogpark-data-ops";
```

Recommended MCP entrypoint:

```ts
createDogparkDataClient({ workspaceRoot });
```

Compatibility escape hatch:

```ts
runDogparkDataCommand(["--show-config"], { workspaceRoot });
```

Runtime helpers are available for setup and diagnostics, but MCP tools should
prefer the structured client methods.

## Exposed Client Methods

These methods are ready to wrap as MCP tools:

| Method                                                                                       | Purpose                                                           | Notes                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getRuntimeStatus()`                                                                         | Show workspace, runtime mode, hub URL, and default deploy target. | Synchronous and safe.                                                                                                                                              |
| `setRuntimeMode(mode)`                                                                       | Persist `"local"` or `"on-premise"` mode.                         | Writes `.dogpark-release-config.json`.                                                                                                                             |
| `useLocalMode()`                                                                             | Persist local mode.                                               | Convenience wrapper.                                                                                                                                               |
| `useOnPremiseMode()`                                                                         | Persist on-premise mode.                                          | Convenience wrapper.                                                                                                                                               |
| `checkConnection({ deployTarget })`                                                          | Ping hub and validate Elasticsearch target.                       | Returns structured status.                                                                                                                                         |
| `getExistingSourcesOnHub()`                                                                  | List existing data source names from the active hub.              | Read-only. Returns `string[]`.                                                                                                                                     |
| `buildDatasets({ releaseDatasets, datasets, durationSeconds, dryRun })`                      | Start build jobs.                                                 | `releaseDatasets` replaces repo defaults and appends repo-owned special datasets; `datasets` is an exact target override. Prefer `dryRun: true` by default in MCP. |
| `dumpSources({ source, releaseDatasets, dumpOnlyDatasets, durationSeconds, dryRun, force })` | Start dump jobs.                                                  | Supports one source or all configured dump targets.                                                                                                                |
| `removeBuilds({ fileName, dryRun })`                                                         | Remove stored builds listed in a file.                            | Destructive when `dryRun` is false.                                                                                                                                |
| `releaseStaging({ fileName, deployTarget, dryRun, purgeMode, tagsOnly, batch })`             | Release builds to staging.                                        | Gate non-dry-run usage.                                                                                                                                            |
| `releaseProd({ fileName, deployTarget, dryRun, markOldDeprecatedForDeletion })`              | Promote staging builds to prod.                                   | Gate non-dry-run usage strongly.                                                                                                                                   |
| `compareTargets({ fileName, sourceTarget, targetTarget })`                                   | Compare index record counts across deploy targets.                | Read-only, but depends on Elasticsearch access.                                                                                                                    |
| `deleteTaggedIndices({ deployTarget, dryRun })`                                              | Delete indices tagged for deletion.                               | Destructive when `dryRun` is false.                                                                                                                                |
| `run(args)`                                                                                  | CLI-shaped escape hatch.                                          | Keep for parity, but prefer structured methods.                                                                                                                    |

## Suggested MCP Tools

Recommended initial tool set:

```txt
dogpark_get_runtime_status
dogpark_set_runtime_mode
dogpark_check_connection
dogpark_get_existing_sources_on_hub
dogpark_compare_targets
dogpark_dump_source_dry_run
dogpark_build_datasets_dry_run
dogpark_release_staging_dry_run
dogpark_release_prod_dry_run
```

Expose write/destructive tools only after deciding on an approval model:

```txt
dogpark_build_datasets
dogpark_dump_sources
dogpark_remove_builds
dogpark_release_staging
dogpark_release_prod
dogpark_delete_tagged_indices
```

## Adapter Flow

An MCP server should stay thin:

```txt
MCP request
  -> validate tool input
  -> enforce safety policy
  -> call dogpark client method
  -> return structured result or concise text
```

Example adapter code:

```ts
import { createDogparkDataClient } from "dogpark-data-ops";

const dogpark = createDogparkDataClient({
    workspaceRoot: process.env.DOGPARK_DATA_OPS_ROOT,
});

export async function dogparkGetRuntimeStatus() {
    return dogpark.getRuntimeStatus();
}

export async function dogparkCheckConnection(input: {
    deployTarget?: "transltr" | "su12" | "itrb-ci";
}) {
    return dogpark.checkConnection({
        deployTarget: input.deployTarget,
    });
}

export async function dogparkGetExistingSourcesOnHub() {
    return dogpark.getExistingSourcesOnHub();
}

export async function dogparkReleaseStagingDryRun(input: {
    fileName?: string;
    deployTarget?: "transltr" | "su12" | "itrb-ci";
}) {
    await dogpark.releaseStaging({
        fileName: input.fileName,
        deployTarget: input.deployTarget,
        dryRun: true,
    });

    return {
        ok: true,
        dryRun: true,
    };
}
```

## Safety Recommendations

For agentic usage, start conservative:

- Default all mutating tools to `dryRun: true`.
- Expose non-dry-run release and delete operations as separate tool names.
- Require explicit operator approval for:
    - `releaseProd({ dryRun: false })`
    - `deleteTaggedIndices({ dryRun: false })`
    - `removeBuilds({ dryRun: false })`
- Run `checkConnection()` before staging, prod, or delete operations.
- Prefer explicit `deployTarget`; avoid relying on defaults for destructive
  operations.
- Log the resolved `workspaceRoot`, `runtimeConfigPath`, and deploy target for
  every non-dry-run operation.

## Current Limitations

The client is structured, but some underlying operations still write progress to
`console.log` and return `void` or existing result shapes. The next improvement
would be to make every operation return a structured result object suitable for
MCP responses, while keeping console output in the CLI adapter only.

The lower-level command runner remains available:

```ts
await dogpark.run(["--show-config"]);
```

Use it only as an escape hatch. New MCP tools should prefer the named client
methods.
