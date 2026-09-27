import { useEffect, useState } from "react";
import type {
  AppConfig,
  DistillStatusView,
  OpenVikingStatus,
} from "@agent2026/shared";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

const OPENVIKING_RUNTIME_README_URL =
  "https://github.com/rainbowchenx/ai-agent/blob/main/packages/openviking-runtime/README.md";
const OPENVIKING_MCP_URL_DISPLAY = "http://127.0.0.1:1933/mcp";
const DEFAULT_EMBEDDING_API_KEY_ENV = "OPENVIKING_EMBEDDING_API_KEY";

function statusPillClass(status: OpenVikingStatus): string {
  switch (status) {
    case "ready":
      return "mcp-status-ready";
    case "starting":
      return "mcp-status-connecting";
    case "error":
    case "needs_config":
      return "mcp-status-error";
    case "stopped":
    default:
      return "mcp-status-closed";
  }
}

function statusDetailText(
  status: OpenVikingStatus,
  ownedProcess: boolean,
  lastError?: string,
): string | null {
  if (status === "ready") {
    return ownedProcess ? "本进程拉起" : "复用已有服务";
  }
  if (lastError) {
    return lastError;
  }
  if (status === "needs_config") {
    return "需要配置独立 Embedding 与 Provider API Key";
  }
  if (status === "starting") {
    return "正在准备…";
  }
  return null;
}

function distillStatusText(status: DistillStatusView): string | null {
  if (status.lastStatus === "idle") {
    return null;
  }
  const parts: string[] = [`上次提炼：${status.lastStatus}`];
  if (status.lastWritten != null) {
    parts.push(`写入 ${status.lastWritten}`);
  }
  if (status.lastMessage) {
    parts.push(status.lastMessage);
  }
  return parts.join(" · ");
}

export function MemorySettingsPanel({
  baseUrl,
  config,
  onScrollToModels,
}: {
  baseUrl: string;
  config: AppConfig;
  onScrollToModels: () => void;
}) {
  const openVikingStatus = useSettingsStore((s) => s.openVikingStatus);
  const distillStatus = useSettingsStore((s) => s.distillStatus);
  const credentials = useSettingsStore((s) => s.credentials);
  const saving = useSettingsStore((s) => s.saving);
  const setOpenVikingEnabled = useSettingsStore((s) => s.setOpenVikingEnabled);
  const setAutoDistill = useSettingsStore((s) => s.setAutoDistill);
  const setAutoRecall = useSettingsStore((s) => s.setAutoRecall);
  const saveOpenVikingEmbedding = useSettingsStore(
    (s) => s.saveOpenVikingEmbedding,
  );
  const saveOpenVikingOverrides = useSettingsStore(
    (s) => s.saveOpenVikingOverrides,
  );
  const refreshOpenVikingStatus = useSettingsStore(
    (s) => s.refreshOpenVikingStatus,
  );
  const retryOpenVikingStatus = useSettingsStore(
    (s) => s.retryOpenVikingStatus,
  );

  const enabled =
    openVikingStatus?.enabled ??
    config.mcpServers?.openviking?.enabled === true;
  const autoDistill = config.openviking?.autoDistill !== false;
  const autoRecall = config.openviking?.autoRecall !== false;

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [embBaseUrl, setEmbBaseUrl] = useState(
    config.openviking?.embedding?.baseUrl ?? "",
  );
  const [embModel, setEmbModel] = useState(
    config.openviking?.embedding?.model ??
      config.openviking?.embeddingModel ??
      "",
  );
  const [embApiKeyEnv, setEmbApiKeyEnv] = useState(
    config.openviking?.embedding?.apiKeyEnv ?? DEFAULT_EMBEDDING_API_KEY_ENV,
  );
  const [embDimension, setEmbDimension] = useState(
    config.openviking?.embedding?.dimension != null
      ? String(config.openviking.embedding.dimension)
      : config.openviking?.embeddingDimension != null
        ? String(config.openviking.embeddingDimension)
        : "",
  );
  const [embApiKeyDraft, setEmbApiKeyDraft] = useState("");
  const [vlmModel, setVlmModel] = useState(config.openviking?.vlmModel ?? "");

  useEffect(() => {
    setEmbBaseUrl(config.openviking?.embedding?.baseUrl ?? "");
    setEmbModel(
      config.openviking?.embedding?.model ??
        config.openviking?.embeddingModel ??
        "",
    );
    setEmbApiKeyEnv(
      config.openviking?.embedding?.apiKeyEnv ?? DEFAULT_EMBEDDING_API_KEY_ENV,
    );
    setEmbDimension(
      config.openviking?.embedding?.dimension != null
        ? String(config.openviking.embedding.dimension)
        : config.openviking?.embeddingDimension != null
          ? String(config.openviking.embeddingDimension)
          : "",
    );
    setVlmModel(config.openviking?.vlmModel ?? "");
  }, [
    config.openviking?.embedding?.baseUrl,
    config.openviking?.embedding?.model,
    config.openviking?.embedding?.apiKeyEnv,
    config.openviking?.embedding?.dimension,
    config.openviking?.embeddingModel,
    config.openviking?.embeddingDimension,
    config.openviking?.vlmModel,
  ]);

  useEffect(() => {
    if (!baseUrl || openVikingStatus?.status !== "starting") {
      return;
    }
    const id = window.setInterval(() => {
      void refreshOpenVikingStatus(baseUrl);
    }, 2000);
    return () => window.clearInterval(id);
  }, [baseUrl, openVikingStatus?.status, refreshOpenVikingStatus]);

  const status = openVikingStatus?.status ?? "stopped";
  const ovReady = status === "ready";
  const detail = openVikingStatus
    ? statusDetailText(
        openVikingStatus.status,
        openVikingStatus.ownedProcess,
        openVikingStatus.lastError,
      )
    : null;
  const mcpUrl = openVikingStatus?.mcpUrl ?? OPENVIKING_MCP_URL_DISPLAY;
  const lastDistill = distillStatus ? distillStatusText(distillStatus) : null;
  const embCredential = credentials[embApiKeyEnv.trim()];
  const embKeyFromEnv = embCredential?.source === "env";

  return (
    <div className="memory-panel" data-settings-memory-panel>
      <div className="switch-row">
        <div className="switch-label">
          <span className="switch-title">启用 OpenViking</span>
          <span className="switch-desc">
            开启后 Agent 可通过 openviking__* 工具跨会话读写记忆
          </span>
        </div>
        <label className="switch" aria-label="启用 OpenViking">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving || !baseUrl}
            onChange={(event) => {
              void setOpenVikingEnabled(baseUrl, event.target.checked);
            }}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="switch-row">
        <div className="switch-label">
          <span className="switch-title">run 结束后自动提炼</span>
          <span className="switch-desc">
            将本轮对话要点写入 OpenViking（需服务就绪）
          </span>
          {!ovReady ? (
            <span className="switch-desc memory-distill-inactive">
              当前未生效：OpenViking 未就绪
            </span>
          ) : null}
          {lastDistill ? (
            <span className="switch-desc memory-distill-last">{lastDistill}</span>
          ) : null}
        </div>
        <label className="switch" aria-label="run 结束后自动提炼">
          <input
            type="checkbox"
            checked={autoDistill}
            disabled={saving || !baseUrl}
            onChange={(event) => {
              void setAutoDistill(baseUrl, event.target.checked);
            }}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="switch-row">
        <div className="switch-label">
          <span className="switch-title">自动召回长期记忆</span>
          <span className="switch-desc">
            开新对话时检索相关冻结记忆并注入；同会话复用，线索句可刷新
          </span>
          {!ovReady ? (
            <span className="switch-desc memory-distill-inactive">
              当前未生效：OpenViking 未就绪
            </span>
          ) : null}
        </div>
        <label className="switch" aria-label="自动召回长期记忆">
          <input
            type="checkbox"
            checked={autoRecall}
            disabled={saving || !baseUrl}
            onChange={(event) => {
              void setAutoRecall(baseUrl, event.target.checked);
            }}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="memory-embedding-block">
        <div className="switch-label">
          <span className="switch-title">Embedding（独立端点）</span>
          <span className="switch-desc">
            语义检索专用；勿填对话模型 API（如 DeepSeek）。密钥走 credentials /
            环境变量。
          </span>
        </div>
        <div className="field-group input-medium">
          <label className="field-label" htmlFor="ov-emb-base-url">
            Base URL
          </label>
          <input
            className="text-input"
            id="ov-emb-base-url"
            value={embBaseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(event) => setEmbBaseUrl(event.target.value)}
          />
        </div>
        <div className="field-group input-medium">
          <label className="field-label" htmlFor="ov-emb-model">
            模型名
          </label>
          <input
            className="text-input"
            id="ov-emb-model"
            value={embModel}
            placeholder="text-embedding-3-small"
            onChange={(event) => setEmbModel(event.target.value)}
          />
        </div>
        <div className="field-group input-medium">
          <label className="field-label" htmlFor="ov-emb-api-key-env">
            API Key 环境变量
          </label>
          <input
            className="text-input"
            id="ov-emb-api-key-env"
            value={embApiKeyEnv}
            placeholder={DEFAULT_EMBEDDING_API_KEY_ENV}
            onChange={(event) => setEmbApiKeyEnv(event.target.value)}
          />
        </div>
        <div className="field-group input-medium">
          <label className="field-label" htmlFor="ov-emb-api-key">
            API Key
          </label>
          <input
            className="text-input"
            id="ov-emb-api-key"
            type="password"
            value={embApiKeyDraft}
            placeholder={
              embKeyFromEnv
                ? "已由环境变量提供（只读）"
                : embCredential?.configured
                  ? "已保存，留空则保持不变"
                  : "粘贴 Embedding API Key"
            }
            disabled={embKeyFromEnv || saving || !baseUrl}
            onChange={(event) => setEmbApiKeyDraft(event.target.value)}
          />
          {embKeyFromEnv ? (
            <span className="field-hint">
              当前由环境变量 {embApiKeyEnv} 提供
            </span>
          ) : null}
        </div>
        <div className="field-group input-medium">
          <label className="field-label" htmlFor="ov-emb-dimension">
            维度（可选）
          </label>
          <input
            className="text-input"
            id="ov-emb-dimension"
            value={embDimension}
            placeholder="1536"
            inputMode="numeric"
            onChange={(event) => setEmbDimension(event.target.value)}
          />
        </div>
        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !baseUrl}
            onClick={() => {
              const dimRaw = embDimension.trim();
              const dimension =
                dimRaw === "" ? undefined : Number.parseInt(dimRaw, 10);
              void saveOpenVikingEmbedding(baseUrl, {
                baseUrl: embBaseUrl,
                model: embModel,
                apiKeyEnv: embApiKeyEnv,
                dimension:
                  dimension != null && Number.isFinite(dimension)
                    ? dimension
                    : undefined,
                apiKey: embApiKeyDraft || undefined,
              }).then(() => setEmbApiKeyDraft(""));
            }}
          >
            {saving ? "保存中…" : "保存 Embedding"}
          </button>
        </div>
      </div>

      <div className="memory-status-row">
        <div className="memory-status-left">
          <div className={`mcp-status-pill ${statusPillClass(status)}`}>
            <span className="mcp-status-dot" aria-hidden />
            <span className="memory-status-badge">{status}</span>
          </div>
          {detail ? <span className="memory-status-detail">{detail}</span> : null}
        </div>
        <div className="memory-status-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving || !baseUrl}
            onClick={() => void retryOpenVikingStatus(baseUrl)}
          >
            <RefreshCw width={14} height={14} aria-hidden />
            重试
          </button>
          <button
            type="button"
            className="mcp-link"
            onClick={onScrollToModels}
          >
            配置模型与 Provider
          </button>
        </div>
      </div>

      <div className="memory-advanced">
        <button
          type="button"
          className="memory-advanced-summary"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <span className="memory-advanced-title">高级</span>
          <span className="memory-advanced-hint">
            VLM 模型覆盖与 MCP URL
          </span>
          {advancedOpen ? (
            <ChevronUp width={16} height={16} aria-hidden />
          ) : (
            <ChevronDown width={16} height={16} aria-hidden />
          )}
        </button>
        {advancedOpen ? (
          <div className="memory-advanced-body">
            <div className="field-group input-medium">
              <label className="field-label" htmlFor="ov-vlm-model">
                VLM 模型覆盖
              </label>
              <input
                className="text-input"
                id="ov-vlm-model"
                value={vlmModel}
                placeholder="留空则用 Agent 默认模型"
                onChange={(event) => setVlmModel(event.target.value)}
              />
            </div>
            <div className="field-group input-medium">
              <label className="field-label" htmlFor="ov-mcp-url">
                MCP URL
              </label>
              <input
                className="text-input"
                id="ov-mcp-url"
                value={mcpUrl}
                readOnly
              />
              <span className="field-hint">只读；本机 OpenViking HTTP MCP 地址</span>
            </div>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !baseUrl}
                onClick={() => {
                  void saveOpenVikingOverrides(baseUrl, { vlmModel });
                }}
              >
                {saving ? "保存中…" : "保存 VLM 覆盖"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="memory-footer">
        <span className="helper-text">
          OpenViking 以 AGPLv3 提供。见 P2.5 / P2.5b · 提炼 P3 · 召回 P4
        </span>
        <a
          className="mcp-link"
          href={OPENVIKING_RUNTIME_README_URL}
          target="_blank"
          rel="noreferrer"
          title="仓库内 openviking-runtime README（AGPLv3）"
        >
          查看文档
        </a>
      </div>
    </div>
  );
}
