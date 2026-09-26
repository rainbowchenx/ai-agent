import { useMemo, useState } from "react";
import type { AppConfig, McpServerConfig, McpServerStatusView } from "@agent2026/shared";
import { Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

type McpFormState = {
  previousName?: string;
  name: string;
  transport: "stdio" | "http";
  enabled: boolean;
  mount: boolean;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  url: string;
  headersText: string;
  httpSubtype: "streamable" | "sse";
};

const EMPTY_FORM: McpFormState = {
  name: "",
  transport: "stdio",
  enabled: true,
  mount: true,
  command: "npx",
  argsText: "-y\n@modelcontextprotocol/server-filesystem\n/path/to/workspace",
  envText: "",
  cwd: "",
  url: "http://localhost:1933/mcp",
  headersText: "",
  httpSubtype: "streamable",
};

function statusLabel(status: McpServerStatusView["status"]): string {
  switch (status) {
    case "ready":
      return "就绪";
    case "connecting":
      return "连接中";
    case "error":
      return "错误";
    case "disabled":
      return "已禁用";
    case "closed":
      return "已关闭";
    default:
      return status;
  }
}

function summarizeServer(config: McpServerConfig): string {
  if (config.transport === "stdio") {
    const args = config.args.slice(0, 2).join(" ");
    return `${config.command}${args ? ` ${args}` : ""}${config.args.length > 2 ? "…" : ""}`;
  }
  return config.url;
}

function parseArgs(text: string): string[] {
  return text
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep <= 0) continue;
    headers[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function headersToText(headers?: Record<string, string>): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function envToText(env?: Record<string, string>): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function toServerConfig(form: McpFormState): McpServerConfig {
  if (form.transport === "stdio") {
    return {
      transport: "stdio",
      command: form.command.trim(),
      args: parseArgs(form.argsText),
      env: parseEnv(form.envText),
      cwd: form.cwd.trim() ? form.cwd.trim() : null,
      enabled: form.enabled,
    };
  }
  return {
    transport: "http",
    url: form.url.trim(),
    headers: parseHeaders(form.headersText),
    httpSubtype: form.httpSubtype,
    enabled: form.enabled,
  };
}

function formFromConfig(
  name: string,
  config: McpServerConfig,
  mount: boolean,
): McpFormState {
  if (config.transport === "stdio") {
    return {
      previousName: name,
      name,
      transport: "stdio",
      enabled: config.enabled,
      mount,
      command: config.command,
      argsText: config.args.join("\n"),
      envText: envToText(config.env),
      cwd: config.cwd ?? "",
      url: "http://localhost:1933/mcp",
      headersText: "",
      httpSubtype: "streamable",
    };
  }
  return {
    previousName: name,
    name,
    transport: "http",
    enabled: config.enabled,
    mount,
    command: "npx",
    argsText: "",
    envText: "",
    cwd: "",
    url: config.url,
    headersText: headersToText(config.headers),
    httpSubtype: config.httpSubtype ?? "streamable",
  };
}

export function McpSettingsPanel({
  baseUrl,
  config,
}: {
  baseUrl: string;
  config: AppConfig;
}) {
  const mcpStatus = useSettingsStore((s) => s.mcpStatus);
  const saving = useSettingsStore((s) => s.saving);
  const saveMcpServer = useSettingsStore((s) => s.saveMcpServer);
  const deleteMcpServer = useSettingsStore((s) => s.deleteMcpServer);
  const setMcpEnabled = useSettingsStore((s) => s.setMcpEnabled);
  const refreshMcpTools = useSettingsStore((s) => s.refreshMcpTools);
  const refreshMcpStatus = useSettingsStore((s) => s.refreshMcpStatus);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<McpFormState>(EMPTY_FORM);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const servers = useMemo(
    () => Object.entries(config.mcpServers ?? {}),
    [config.mcpServers],
  );
  const mounted = new Set(config.agents.default.tools.mcpServers);
  const statusByName = useMemo(() => {
    const map = new Map<string, McpServerStatusView>();
    for (const entry of mcpStatus) {
      map.set(entry.name, entry);
    }
    return map;
  }, [mcpStatus]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (name: string, serverConfig: McpServerConfig) => {
    setForm(formFromConfig(name, serverConfig, mounted.has(name)));
    setFormError(null);
    setFormOpen(true);
  };

  const onSave = async () => {
    const name = form.name.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setFormError("名称须匹配 [a-zA-Z0-9_-]+");
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      setFormError("stdio 需要 command");
      return;
    }
    if (form.transport === "http" && !form.url.trim()) {
      setFormError("http 需要 url");
      return;
    }
    try {
      await saveMcpServer(baseUrl, {
        previousName: form.previousName,
        name,
        config: toServerConfig(form),
        mount: form.mount,
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mcp-panel">
      <p className="helper-text" style={{ marginTop: 0 }}>
        可添加本地 stdio 或远程 HTTP MCP。禁用后立即断开，且不会提供给 Agent。
        敏感 HTTP headers 在展示时会掩码；优先使用密钥引用。
      </p>

      <div className="action-row" style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" type="button" onClick={openCreate}>
          添加 MCP
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={saving || !baseUrl}
          onClick={() => void refreshMcpStatus(baseUrl)}
        >
          <RefreshCw width={14} height={14} aria-hidden />
          刷新状态
        </button>
      </div>

      {servers.length === 0 && !formOpen ? (
        <div className="mcp-card">
          <Puzzle width={20} height={20} aria-hidden />
          <div>
            <p style={{ margin: "0 0 8px", fontSize: 14 }}>
              尚未配置 MCP Server。添加后可在此查看连接状态与发现的工具。
            </p>
            <button type="button" className="mcp-link" onClick={openCreate}>
              添加第一个 MCP
            </button>
          </div>
        </div>
      ) : null}

      <ul className="mcp-server-list">
        {servers.map(([name, serverConfig]) => {
          const status = statusByName.get(name);
          const isExpanded = expanded === name;
          return (
            <li
              key={name}
              className={`mcp-server-row${serverConfig.enabled ? "" : " is-disabled"}`}
            >
              <div className="mcp-server-main">
                <div className="mcp-server-meta">
                  <div className="mcp-server-title">
                    <strong>{name}</strong>
                    <span className="mcp-badge">{serverConfig.transport}</span>
                    <span
                      className={`mcp-status mcp-status-${status?.status ?? "closed"}`}
                    >
                      {status ? statusLabel(status.status) : "未知"}
                    </span>
                  </div>
                  <div className="mcp-server-summary">
                    {summarizeServer(serverConfig)}
                    {mounted.has(name) ? " · 已挂载 Agent" : " · 未挂载"}
                    {status
                      ? ` · ${status.toolCount} 个工具`
                      : null}
                  </div>
                  {status?.lastError ? (
                    <div className="mcp-error">{status.lastError}</div>
                  ) : null}
                </div>
                <div className="mcp-server-actions">
                  <label className="switch" aria-label={`启用 ${name}`}>
                    <input
                      type="checkbox"
                      checked={serverConfig.enabled}
                      disabled={saving}
                      onChange={(event) => {
                        void setMcpEnabled(baseUrl, name, event.target.checked);
                      }}
                    />
                    <span className="slider" />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={saving || !serverConfig.enabled}
                    onClick={() => void refreshMcpTools(baseUrl, name)}
                  >
                    刷新工具
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      setExpanded(isExpanded ? null : name)
                    }
                  >
                    {isExpanded ? "收起工具" : "展开工具"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openEdit(name, serverConfig)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={saving}
                    aria-label={`删除 ${name}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除 MCP「${name}」？配置将移除，若已启用会断开连接。`,
                        )
                      ) {
                        void deleteMcpServer(baseUrl, name);
                      }
                    }}
                  >
                    <Trash2 width={14} height={14} />
                  </button>
                </div>
              </div>
              {isExpanded ? (
                <div className="mcp-tools">
                  {!serverConfig.enabled ? (
                    <p className="helper-text">已禁用，未连接。</p>
                  ) : status?.status === "error" ? (
                    <p className="helper-text">
                      连接失败：{status.lastError ?? "未知错误"}。请检查
                      command/URL/鉴权后刷新。
                    </p>
                  ) : status?.tools.length ? (
                    <ul>
                      {status.tools.map((tool) => (
                        <li key={tool.name}>
                          <code>{tool.name}</code>
                          {tool.description ? (
                            <span> — {tool.description}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="helper-text">
                      {status?.status === "ready"
                        ? "已连接，暂无工具"
                        : "等待连接…"}
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {formOpen ? (
        <div className="mcp-form">
          <h3 className="mcp-form-title">
            {form.previousName ? `编辑 ${form.previousName}` : "新增 MCP"}
          </h3>
          {formError ? <p className="field-error">{formError}</p> : null}
          <div className="field-grid">
            <div className="field">
              <label className="field-label" htmlFor="mcp-name">
                名称（key）
              </label>
              <input
                id="mcp-name"
                className="input"
                value={form.name}
                disabled={Boolean(form.previousName)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="mcp-transport">
                传输类型
              </label>
              <select
                id="mcp-transport"
                className="select"
                value={form.transport}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    transport: event.target.value as "stdio" | "http",
                  }))
                }
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </div>
          </div>

          {form.transport === "stdio" ? (
            <>
              <div className="field">
                <label className="field-label" htmlFor="mcp-command">
                  Command
                </label>
                <input
                  id="mcp-command"
                  className="input"
                  value={form.command}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, command: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="mcp-args">
                  Args（每行一个）
                </label>
                <textarea
                  id="mcp-args"
                  className="textarea"
                  rows={3}
                  value={form.argsText}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, argsText: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="mcp-env">
                  Env 非密键值（KEY=value，每行一个）
                </label>
                <textarea
                  id="mcp-env"
                  className="textarea"
                  rows={2}
                  value={form.envText}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, envText: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="mcp-cwd">
                  cwd（可选）
                </label>
                <input
                  id="mcp-cwd"
                  className="input"
                  value={form.cwd}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, cwd: event.target.value }))
                  }
                />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label className="field-label" htmlFor="mcp-url">
                  URL
                </label>
                <input
                  id="mcp-url"
                  className="input"
                  value={form.url}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, url: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="mcp-headers">
                  Headers（Key: Value，每行一个；敏感值回显掩码）
                </label>
                <textarea
                  id="mcp-headers"
                  className="textarea"
                  rows={3}
                  value={form.headersText}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      headersText: event.target.value,
                    }))
                  }
                />
                <p className="helper-text">
                  勿把长期密钥写进配置；优先用凭证引用。留着掩码字符串保存时会保留原密钥。
                </p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="mcp-subtype">
                  HTTP 方言
                </label>
                <select
                  id="mcp-subtype"
                  className="select"
                  value={form.httpSubtype}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      httpSubtype: event.target.value as "streamable" | "sse",
                    }))
                  }
                >
                  <option value="streamable">Streamable HTTP（默认）</option>
                  <option value="sse">SSE</option>
                </select>
              </div>
            </>
          )}

          <div className="switch-row">
            <div className="switch-label">
              <span className="switch-title">启用</span>
              <span className="switch-desc">关闭则断开且不进 ToolPort</span>
            </div>
            <label className="switch" aria-label="启用 MCP">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              <span className="slider" />
            </label>
          </div>
          <div className="switch-row">
            <div className="switch-label">
              <span className="switch-title">挂载到当前 Agent</span>
              <span className="switch-desc">
                写入 agents.default.tools.mcpServers
              </span>
            </div>
            <label className="switch" aria-label="挂载到 Agent">
              <input
                type="checkbox"
                checked={form.mount}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, mount: event.target.checked }))
                }
              />
              <span className="slider" />
            </label>
          </div>

          <div className="action-row">
            <button
              className="btn btn-primary"
              type="button"
              disabled={saving}
              onClick={() => void onSave()}
            >
              保存
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setFormOpen(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
