# agent2026-openviking-runtime

Pinned [OpenViking](https://github.com/volcengine/OpenViking) Python runtime for agent2026. This is an **optional sidecar** — the core TypeScript packages do not depend on it.

## License notice

OpenViking is distributed under **AGPLv3**. Enabling long-term memory in agent2026 starts this optional component. If you redistribute a closed-source product that bundles or requires OpenViking, assess AGPL compliance with your legal counsel.

## Sync dependencies

From the repository root:

```bash
pnpm ov:sync
```

Equivalent:

```bash
uv sync --project packages/openviking-runtime
```

If `uv.lock` is missing (e.g. offline clone), generate it first:

```bash
uv lock --project packages/openviking-runtime
uv sync --project packages/openviking-runtime
```

Requires [uv](https://docs.astral.sh/uv/) and Python ≥ 3.11.

## Data directory

Runtime data and generated config live under:

```text
~/.agent2026/openviking/
```

- `ov.conf` — OpenViking server configuration (written by Agent Server from your Provider settings)
- `data/` — OpenViking workspace storage

This is separate from the main agent SQLite session store.

## Default MCP URL

When healthy, OpenViking exposes HTTP MCP at:

```text
http://127.0.0.1:1933/mcp
```

Agent Server registers this as `mcpServers.openviking` when long-term memory is enabled and the service is ready. Tools appear as `openviking__*`.

## Relationship to the Agent switch

The **single source of truth** for whether OpenViking should run is `mcpServers.openviking.enabled` in AppConfig (controlled from Desktop **Settings → Long-term memory**). When enabled, Agent Server runs `ov:sync`, writes `ov.conf`, starts or reuses `openviking-server`, and attaches the MCP preset. When disabled, Agent Server stops only the process **it** started and disconnects MCP; an externally running OpenViking instance is left alone.

## Manual server (debug)

After sync, from the repo root:

```bash
uv run --project packages/openviking-runtime openviking-server --help
```

Use the flags shown by `--help` with your `~/.agent2026/openviking/ov.conf` and port `1933`.

## Troubleshooting

**Health check**

```bash
curl http://127.0.0.1:1933/health
```

Expect HTTP 200 and a JSON body indicating OK (exact shape depends on OpenViking version).

**Common issues**

| Symptom | Likely cause |
|---------|----------------|
| `uv: command not found` | Install [uv](https://docs.astral.sh/uv/getting-started/installation/) |
| Sync fails / no lockfile | Run `uv lock --project packages/openviking-runtime` with network access |
| Health fails after enable | Missing Provider API key, port conflict, or server still starting |
| MCP tools missing | OpenViking not ready; check `/openviking/status` on Agent Server |

If OpenViking is unavailable, agent chat continues; status and Desktop UI show the error or `needs_config` reason.
