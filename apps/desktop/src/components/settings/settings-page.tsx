import { useEffect, useState } from "react";
import type { AppConfig, CredentialInfo } from "@agent2026/shared";
import {
  AlertCircle,
  Bot,
  Check,
  Cpu,
  Info,
  Monitor,
  Moon,
  Palette,
  Puzzle,
  Shield,
  SlidersHorizontal,
  Sun,
  User,
} from "lucide-react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

const SECTIONS = [
  { id: "section-models", label: "模型与 Provider", icon: Cpu },
  { id: "section-agent", label: "Agent", icon: Bot },
  { id: "section-permissions", label: "权限", icon: Shield },
  { id: "section-appearance", label: "外观", icon: Palette },
  { id: "section-mcp", label: "MCP", icon: Puzzle },
  { id: "section-advanced", label: "高级", icon: SlidersHorizontal },
  { id: "section-about", label: "关于", icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

type ProviderId = "deepseek" | "openai" | "custom";

const PROVIDER_PRESETS: Record<
  ProviderId,
  { label: string; baseUrl: string; apiKeyEnv: string; models: string[] }
> = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4.1"],
  },
  custom: {
    label: "Custom openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeyEnv: "CUSTOM_API_KEY",
    models: ["local-model"],
  },
};

function resolveProviderId(config: AppConfig): ProviderId {
  const id = config.providers.default;
  if (id === "deepseek" || id === "openai" || id === "custom") {
    return id;
  }
  return "custom";
}

function entryBaseUrl(config: AppConfig, providerId: string): string {
  const entry = config.providers.entries[providerId];
  if (entry?.type === "openai_compatible") {
    return entry.baseUrl;
  }
  return PROVIDER_PRESETS[providerId as ProviderId]?.baseUrl ?? "";
}

function entryApiKeyEnv(config: AppConfig, providerId: string): string {
  const entry = config.providers.entries[providerId];
  return (
    entry?.apiKeyEnv ??
    PROVIDER_PRESETS[providerId as ProviderId]?.apiKeyEnv ??
    "OPENAI_API_KEY"
  );
}

function entryModels(config: AppConfig, providerId: string): string[] {
  const entry = config.providers.entries[providerId];
  if (entry?.models && entry.models.length > 0) {
    return entry.models;
  }
  return PROVIDER_PRESETS[providerId as ProviderId]?.models ?? [];
}

function isProviderConfigured(
  config: AppConfig,
  credentials: Record<string, CredentialInfo>,
  providerId: string,
): boolean {
  const entry = config.providers.entries[providerId];
  if (!entry) {
    return false;
  }
  const cred = credentials[entry.apiKeyEnv];
  return Boolean(cred?.configured);
}

export function SettingsPage() {
  const baseUrl = useSessionStore((s) => s.baseUrl);
  const health = useSessionStore((s) => s.health);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const config = useSettingsStore((s) => s.config);
  const credentials = useSettingsStore((s) => s.credentials);
  const system = useSettingsStore((s) => s.system);
  const loading = useSettingsStore((s) => s.loading);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);
  const saveHint = useSettingsStore((s) => s.saveHint);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const saveProvider = useSettingsStore((s) => s.saveProvider);
  const saveAgent = useSettingsStore((s) => s.saveAgent);
  const savePermissions = useSettingsStore((s) => s.savePermissions);
  const clearHints = useSettingsStore((s) => s.clearHints);

  const [active, setActive] = useState<SectionId>("section-models");
  const [appearanceHint, setAppearanceHint] = useState<string | null>(null);

  // Provider form
  const [providerId, setProviderId] = useState<ProviderId>("deepseek");
  const [providerBaseUrl, setProviderBaseUrl] = useState(
    PROVIDER_PRESETS.deepseek.baseUrl,
  );
  const [apiKeyEnv, setApiKeyEnv] = useState(PROVIDER_PRESETS.deepseek.apiKeyEnv);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [defaultModel, setDefaultModel] = useState("deepseek/deepseek-chat");

  // Agent form
  const [systemPrompt, setSystemPrompt] = useState("");
  const [httpFetch, setHttpFetch] = useState(true);
  const [readFile, setReadFile] = useState(true);
  const [maxTurns, setMaxTurns] = useState(10);
  const [maxToolCalls, setMaxToolCalls] = useState("");

  // Permissions form
  const [permMode, setPermMode] = useState<"default" | "ask_all" | "allowlist">(
    "default",
  );
  const [allowlistText, setAllowlistText] = useState("");

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    void hydrate(baseUrl);
  }, [baseUrl, hydrate]);

  useEffect(() => {
    if (!config) {
      return;
    }
    const id = resolveProviderId(config);
    setProviderId(id);
    setProviderBaseUrl(entryBaseUrl(config, id));
    setApiKeyEnv(entryApiKeyEnv(config, id));
    setDefaultModel(config.agents.default.model);
    setApiKeyDraft("");

    setSystemPrompt(config.agents.default.systemPrompt);
    setHttpFetch(config.agents.default.tools.builtin.includes("http_fetch"));
    setReadFile(config.agents.default.tools.builtin.includes("read_file"));
    setMaxTurns(config.agents.default.maxTurns ?? 10);
    setMaxToolCalls(
      config.agents.default.maxToolCalls == null
        ? ""
        : String(config.agents.default.maxToolCalls),
    );

    setPermMode(config.permissions.mode);
    setAllowlistText(config.permissions.allowlist.join("\n"));
  }, [config]);

  const scrollTo = (id: SectionId) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const applyProviderPreset = (id: ProviderId) => {
    const preset = PROVIDER_PRESETS[id];
    setProviderId(id);
    setProviderBaseUrl(
      config ? entryBaseUrl(config, id) || preset.baseUrl : preset.baseUrl,
    );
    setApiKeyEnv(
      config ? entryApiKeyEnv(config, id) || preset.apiKeyEnv : preset.apiKeyEnv,
    );
    const models = config ? entryModels(config, id) : preset.models;
    const modelName = models[0] ?? preset.models[0];
    setDefaultModel(`${id}/${modelName}`);
    setApiKeyDraft("");
    clearHints();
  };

  const modelOptions = (() => {
    const fromConfig = config
      ? Object.entries(config.providers.entries).flatMap(([pid, entry]) =>
          (entry.models ?? []).map((m) => `${pid}/${m}`),
        )
      : [];
    const fromPresets = (
      Object.entries(PROVIDER_PRESETS) as [ProviderId, (typeof PROVIDER_PRESETS)[ProviderId]][]
    ).flatMap(([pid, preset]) => preset.models.map((m) => `${pid}/${m}`));
    const set = new Set([...fromConfig, ...fromPresets, defaultModel]);
    return [...set];
  })();

  const credential = credentials[apiKeyEnv];
  const keyFromEnv = credential?.source === "env";
  const keyConfigured = Boolean(credential?.configured);

  const statusLine = error ?? saveHint ?? appearanceHint;

  return (
    <div data-settings-page className="flex h-full min-h-0 flex-col">
      <header className="topbar">
        <span className="topbar-title">设置</span>
        <button type="button" className="avatar" aria-label="用户菜单">
          <User />
        </button>
      </header>

      <div className="content">
        <div className="settings-shell">
          <nav className="settings-sidebar" aria-label="设置分类">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`settings-sidebar-item${active === section.id ? " active" : ""}`}
                  data-settings-nav={section.id}
                  onClick={() => scrollTo(section.id)}
                >
                  <Icon aria-hidden />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="settings-content">
            {loading && !config ? (
              <p className="helper-text">正在加载配置…</p>
            ) : null}
            {statusLine ? (
              <p
                className="helper-text"
                data-settings-hint
                data-settings-error={error ? "true" : undefined}
              >
                {statusLine}
              </p>
            ) : null}

            <section className="settings-section" id="section-models">
              <div className="section-card">
                <div className="section-header">
                  <h2 className="section-title">模型与 Provider</h2>
                  <p className="section-subtitle">
                    配置默认模型 Provider、API Key 与基础地址。设置保存后将在下一轮对话生效。
                  </p>
                </div>
                <div className="section-body">
                  <div className="field-group">
                    <span className="field-label">默认 Provider</span>
                    <div className="provider-segment" role="radiogroup">
                      {(
                        [
                          ["deepseek", "DeepSeek"],
                          ["openai", "OpenAI"],
                          ["custom", "Custom openai-compatible"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={providerId === id}
                          className={`provider-chip${providerId === id ? " active" : ""}`}
                          onClick={() => applyProviderPreset(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="provider-list">
                    <ProviderCard
                      name="DeepSeek"
                      meta={
                        config
                          ? entryBaseUrl(config, "deepseek") ||
                            PROVIDER_PRESETS.deepseek.baseUrl
                          : PROVIDER_PRESETS.deepseek.baseUrl
                      }
                      configured={
                        config
                          ? isProviderConfigured(config, credentials, "deepseek")
                          : false
                      }
                      onEdit={() => applyProviderPreset("deepseek")}
                    />
                    <ProviderCard
                      name="OpenAI"
                      meta={
                        config
                          ? entryBaseUrl(config, "openai") ||
                            PROVIDER_PRESETS.openai.baseUrl
                          : PROVIDER_PRESETS.openai.baseUrl
                      }
                      configured={
                        config
                          ? isProviderConfigured(config, credentials, "openai")
                          : false
                      }
                      onEdit={() => applyProviderPreset("openai")}
                    />
                    <ProviderCard
                      name="Custom"
                      meta={
                        config?.providers.entries.custom &&
                        config.providers.entries.custom.type ===
                          "openai_compatible"
                          ? config.providers.entries.custom.baseUrl
                          : "未设置"
                      }
                      configured={
                        config
                          ? isProviderConfigured(config, credentials, "custom")
                          : false
                      }
                      onEdit={() => applyProviderPreset("custom")}
                    />
                  </div>

                  <div className="field-group input-medium">
                    <label className="field-label" htmlFor="api-base-url">
                      API Base URL
                    </label>
                    <input
                      className="text-input"
                      id="api-base-url"
                      value={providerBaseUrl}
                      onChange={(e) => {
                        setProviderBaseUrl(e.target.value);
                        clearHints();
                      }}
                      autoComplete="off"
                    />
                  </div>

                  <div className="field-group input-medium">
                    <label className="field-label" htmlFor="api-key">
                      API Key (write-only)
                    </label>
                    <input
                      className="text-input"
                      id="api-key"
                      type="password"
                      value={apiKeyDraft}
                      disabled={keyFromEnv}
                      placeholder={
                        keyFromEnv
                          ? "来自环境变量（只读）"
                          : keyConfigured
                            ? "已配置 — 输入新值以替换"
                            : "输入 API Key"
                      }
                      autoComplete="off"
                      onChange={(e) => {
                        setApiKeyDraft(e.target.value);
                        clearHints();
                      }}
                    />
                    {keyConfigured ? (
                      <span className="badge badge-success" style={{ marginTop: 8 }}>
                        <Check width={12} height={12} aria-hidden />
                        {keyFromEnv ? "已配置（环境变量）" : "已配置"}
                      </span>
                    ) : (
                      <span className="badge badge-muted" style={{ marginTop: 8 }}>
                        未配置
                      </span>
                    )}
                  </div>

                  <div className="field-group input-short">
                    <label className="field-label" htmlFor="api-key-env">
                      引用名
                    </label>
                    <input
                      className="text-input"
                      id="api-key-env"
                      value={apiKeyEnv}
                      onChange={(e) => {
                        setApiKeyEnv(e.target.value);
                        setApiKeyDraft("");
                        clearHints();
                      }}
                    />
                    <span className="field-hint">
                      对应环境变量名，用于运行时的凭据读取。
                    </span>
                  </div>

                  <div className="field-group input-medium">
                    <label className="field-label" htmlFor="default-model">
                      默认模型
                    </label>
                    <select
                      className="select"
                      id="default-model"
                      value={defaultModel}
                      onChange={(e) => {
                        setDefaultModel(e.target.value);
                        const slash = e.target.value.indexOf("/");
                        if (slash > 0) {
                          const pid = e.target.value.slice(0, slash);
                          if (
                            pid === "deepseek" ||
                            pid === "openai" ||
                            pid === "custom"
                          ) {
                            setProviderId(pid);
                          }
                        }
                        clearHints();
                      }}
                    >
                      {modelOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="action-row">
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => applyProviderPreset("deepseek")}
                    >
                      填充 DeepSeek 预设
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => applyProviderPreset("openai")}
                    >
                      填充 OpenAI 预设
                    </button>
                  </div>

                  <div className="action-row">
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={saving || !providerBaseUrl.trim() || !apiKeyEnv.trim()}
                      data-settings-save-provider
                      onClick={() => {
                        if (!baseUrl) {
                          return;
                        }
                        setAppearanceHint(null);
                        const presetModels = PROVIDER_PRESETS[providerId].models;
                        const existing = config
                          ? entryModels(config, providerId)
                          : [];
                        void saveProvider(baseUrl, {
                          providerId,
                          baseUrl: providerBaseUrl.trim(),
                          apiKeyEnv: apiKeyEnv.trim(),
                          model: defaultModel,
                          models: existing.length > 0 ? existing : presetModels,
                          apiKey: keyFromEnv ? undefined : apiKeyDraft || undefined,
                        }).then(() => setApiKeyDraft(""));
                      }}
                    >
                      {saving ? "保存中…" : "保存"}
                    </button>
                    <span className="helper-text">已保存，下一轮对话生效</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section" id="section-agent">
              <div className="section-card">
                <div className="section-header">
                  <h2 className="section-title">Agent</h2>
                  <p className="section-subtitle">
                    调整系统提示词、内置工具开关与调用限制。
                  </p>
                </div>
                <div className="section-body">
                  <div className="field-group">
                    <label className="field-label" htmlFor="system-prompt">
                      系统提示词
                    </label>
                    <textarea
                      className="textarea"
                      id="system-prompt"
                      value={systemPrompt}
                      onChange={(e) => {
                        setSystemPrompt(e.target.value);
                        clearHints();
                      }}
                    />
                  </div>

                  <div className="field-group">
                    <span className="field-label">内置工具</span>
                    <div className="switch-row">
                      <div className="switch-label">
                        <span className="switch-title">http_fetch</span>
                        <span className="switch-desc">
                          允许 Agent 发起 HTTP 请求获取网络内容
                        </span>
                      </div>
                      <label className="switch" aria-label="启用 http_fetch">
                        <input
                          type="checkbox"
                          checked={httpFetch}
                          onChange={(e) => {
                            setHttpFetch(e.target.checked);
                            clearHints();
                          }}
                        />
                        <span className="slider" />
                      </label>
                    </div>
                    <div className="switch-row">
                      <div className="switch-label">
                        <span className="switch-title">read_file</span>
                        <span className="switch-desc">
                          允许 Agent 读取本地文件内容
                        </span>
                      </div>
                      <label className="switch" aria-label="启用 read_file">
                        <input
                          type="checkbox"
                          checked={readFile}
                          onChange={(e) => {
                            setReadFile(e.target.checked);
                            clearHints();
                          }}
                        />
                        <span className="slider" />
                      </label>
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field-group input-short">
                      <label className="field-label" htmlFor="max-turns">
                        maxTurns
                      </label>
                      <input
                        className="text-input"
                        id="max-turns"
                        type="number"
                        value={maxTurns}
                        min={1}
                        max={50}
                        onChange={(e) => {
                          setMaxTurns(Number(e.target.value) || 1);
                          clearHints();
                        }}
                      />
                    </div>
                    <div className="field-group input-short">
                      <label className="field-label" htmlFor="max-tool-calls">
                        maxToolCalls
                      </label>
                      <input
                        className="text-input"
                        id="max-tool-calls"
                        type="number"
                        placeholder="不限制"
                        value={maxToolCalls}
                        onChange={(e) => {
                          setMaxToolCalls(e.target.value);
                          clearHints();
                        }}
                      />
                    </div>
                  </div>

                  <div className="action-row">
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={saving}
                      data-settings-save-agent
                      onClick={() => {
                        if (!baseUrl) {
                          return;
                        }
                        setAppearanceHint(null);
                        const builtin: Array<"http_fetch" | "read_file"> = [];
                        if (httpFetch) {
                          builtin.push("http_fetch");
                        }
                        if (readFile) {
                          builtin.push("read_file");
                        }
                        const parsedCalls = maxToolCalls.trim()
                          ? Number(maxToolCalls)
                          : null;
                        void saveAgent(baseUrl, {
                          systemPrompt,
                          builtin,
                          maxTurns,
                          maxToolCalls:
                            parsedCalls != null && Number.isFinite(parsedCalls)
                              ? parsedCalls
                              : null,
                        });
                      }}
                    >
                      {saving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section" id="section-permissions">
              <div className="section-card">
                <div className="section-header">
                  <h2 className="section-title">权限</h2>
                  <p className="section-subtitle">
                    控制 Agent 执行敏感操作时的确认策略。
                  </p>
                </div>
                <div className="section-body">
                  <div className="field-group input-medium">
                    <label className="field-label" htmlFor="perm-mode">
                      权限模式
                    </label>
                    <select
                      className="select"
                      id="perm-mode"
                      value={permMode}
                      onChange={(e) => {
                        setPermMode(
                          e.target.value as "default" | "ask_all" | "allowlist",
                        );
                        clearHints();
                      }}
                    >
                      <option value="default">default</option>
                      <option value="ask_all">ask_all</option>
                      <option value="allowlist">allowlist</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor="allowlist">
                      允许列表
                    </label>
                    <textarea
                      className="textarea"
                      id="allowlist"
                      placeholder={"http_fetch\nread_file"}
                      value={allowlistText}
                      onChange={(e) => {
                        setAllowlistText(e.target.value);
                        clearHints();
                      }}
                    />
                    <span className="field-hint">
                      每行一个工具名；仅在 allowlist 模式下生效。
                    </span>
                  </div>
                  <div className="alert">
                    <AlertCircle className="alert-icon" aria-hidden />
                    <span>
                      ask_all 确认弹窗与完整权限闸门 UI 将在后续版本完善；此处为设置壳。
                    </span>
                  </div>
                  <div className="action-row">
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={saving}
                      data-settings-save-permissions
                      onClick={() => {
                        if (!baseUrl) {
                          return;
                        }
                        setAppearanceHint(null);
                        void savePermissions(baseUrl, {
                          mode: permMode,
                          allowlist: allowlistText
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        });
                      }}
                    >
                      {saving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section" id="section-appearance">
              <div className="section-card">
                <div className="section-header">
                  <h2 className="section-title">外观</h2>
                  <p className="section-subtitle">主题偏好保存在本机，立即生效。</p>
                </div>
                <div className="section-body">
                  <div className="field-group">
                    <span className="field-label">主题</span>
                    <div className="theme-grid">
                      {(
                        [
                          ["light", "Light", Sun],
                          ["dark", "Dark", Moon],
                          ["system", "System", Monitor],
                        ] as const
                      ).map(([id, label, Icon]) => (
                        <button
                          key={id}
                          type="button"
                          className={`theme-card${theme === id ? " active" : ""}`}
                          data-theme-option={id}
                          onClick={() => {
                            setTheme(id);
                            setAppearanceHint("主题已应用");
                            clearHints();
                          }}
                        >
                          <Icon aria-hidden />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field-group input-short">
                    <label className="field-label" htmlFor="font">
                      字体
                    </label>
                    <select className="select" id="font" defaultValue="system" disabled>
                      <option value="system">系统默认</option>
                    </select>
                  </div>
                  <div className="action-row">
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => setAppearanceHint("主题已应用")}
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section" id="section-mcp">
              <div className="section-card">
                <div className="section-header">
                  <h2 className="section-title">MCP</h2>
                  <p className="section-subtitle">
                    通过 MCP 接入本地与远程工具服务。
                  </p>
                </div>
                <div className="section-body">
                  <div className="mcp-card">
                    <Puzzle width={20} height={20} aria-hidden />
                    <div>
                      <p style={{ margin: "0 0 8px", fontSize: 14 }}>
                        即将支持在此管理 MCP Server。当前运行时尚未接入。
                      </p>
                      <button type="button" className="mcp-link" disabled>
                        管理本地服务
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section" id="section-advanced">
              <div className="section-card">
                <div className="section-header">
                  <h2 className="section-title">高级</h2>
                  <p className="section-subtitle">面向调试与实验性能力的开关。</p>
                </div>
                <div className="section-body">
                  <div className="switch-row">
                    <div className="switch-label">
                      <span className="switch-title">开发者模式</span>
                      <span className="switch-desc">受限制 · 后续开放</span>
                    </div>
                    <label className="switch" aria-label="开发者模式">
                      <input type="checkbox" disabled />
                      <span className="slider" />
                    </label>
                  </div>
                  <div className="advanced-box">
                    <span className="helper-text">
                      A2A、Hooks 与更多高级选项将在此分区补充。
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section" id="section-about">
              <div className="section-card">
                <div className="section-header">
                  <h2 className="section-title">关于</h2>
                  <p className="section-subtitle">运行时与本机配置路径。</p>
                </div>
                <div className="section-body">
                  <dl className="about-list">
                    <div className="about-row">
                      <dt>版本</dt>
                      <dd>{system?.version ?? "0.0.0"}</dd>
                    </div>
                    <div className="about-row">
                      <dt>Server base URL</dt>
                      <dd>{baseUrl || "—"}</dd>
                    </div>
                    <div className="about-row">
                      <dt>health</dt>
                      <dd>{health}</dd>
                    </div>
                    <div className="about-row">
                      <dt>config 路径</dt>
                      <dd>{system?.configPath ?? "~/.agent2026/config.yaml"}</dd>
                    </div>
                    <div className="about-row">
                      <dt>credentials 路径</dt>
                      <dd>
                        {system?.credentialsPath ?? "~/.agent2026/credentials.yaml"}
                      </dd>
                    </div>
                  </dl>
                  <div className="action-row">
                    <button className="btn btn-primary" type="button" disabled>
                      <Check width={16} height={16} aria-hidden />
                      检查更新
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  name,
  meta,
  configured,
  onEdit,
}: {
  name: string;
  meta: string;
  configured: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="provider-card">
      <div className="provider-info">
        <span className="provider-name">{name}</span>
        <span className="provider-meta">{meta}</span>
      </div>
      <div className="action-row">
        {configured ? (
          <span className="badge badge-success">
            <Check width={12} height={12} aria-hidden />
            已配置
          </span>
        ) : (
          <span className="badge badge-muted">未配置</span>
        )}
        <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}
