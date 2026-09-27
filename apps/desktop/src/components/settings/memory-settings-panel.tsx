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
    return "需要配置 Provider / API Key";
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
  const saving = useSettingsStore((s) => s.saving);
  const setOpenVikingEnabled = useSettingsStore((s) => s.setOpenVikingEnabled);
  const setAutoDistill = useSettingsStore((s) => s.setAutoDistill);
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

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState(
    config.openviking?.embeddingModel ?? "",
  );
  const [vlmModel, setVlmModel] = useState(config.openviking?.vlmModel ?? "");

  useEffect(() => {
    setEmbeddingModel(config.openviking?.embeddingModel ?? "");
    setVlmModel(config.openviking?.vlmModel ?? "");
  }, [config.openviking?.embeddingModel, config.openviking?.vlmModel]);

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
            OV embedding / VLM 模型名覆盖与 MCP URL
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
              <label className="field-label" htmlFor="ov-embedding-model">
                Embedding 模型覆盖
              </label>
              <input
                className="text-input"
                id="ov-embedding-model"
                value={embeddingModel}
                placeholder="留空则按 Provider 默认推断"
                onChange={(event) => setEmbeddingModel(event.target.value)}
              />
            </div>
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
                  void saveOpenVikingOverrides(baseUrl, {
                    embeddingModel,
                    vlmModel,
                  });
                }}
              >
                {saving ? "保存中…" : "保存覆盖"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="memory-footer">
        <span className="helper-text">
          OpenViking 以 AGPLv3 提供。见 docs/learning/P2.5-OPENVIKING.md ·
          自动提炼见 docs/learning/P3-MEMORY-DISTILL.md
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
