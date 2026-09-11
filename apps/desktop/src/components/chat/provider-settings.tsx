import { useEffect, useState } from "react";
import type { AppConfig } from "@agent2026/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionStore } from "@/stores/session-store";

const PRESETS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    apiBaseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  {
    id: "openai",
    label: "OpenAI",
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
  },
] as const;

function providerIdFromConfig(config: AppConfig): string {
  const slash = config.agents.default.model.indexOf("/");
  return slash > 0
    ? config.agents.default.model.slice(0, slash)
    : config.providers.default;
}

function modelNameFromConfig(config: AppConfig): string {
  const slash = config.agents.default.model.indexOf("/");
  return slash > 0
    ? config.agents.default.model.slice(slash + 1)
    : config.agents.default.model;
}

function apiBaseUrlFromConfig(config: AppConfig): string {
  const providerId = providerIdFromConfig(config);
  const entry = config.providers.entries[providerId];
  if (entry?.type === "openai_compatible") {
    return entry.baseUrl;
  }
  return "";
}

function apiKeyEnvFromConfig(config: AppConfig): string {
  const providerId = providerIdFromConfig(config);
  const entry = config.providers.entries[providerId];
  return entry?.apiKeyEnv ?? "OPENAI_API_KEY";
}

export function ProviderSettings() {
  const baseUrl = useSessionStore((s) => s.baseUrl);
  const config = useSessionStore((s) => s.config);
  const loadConfig = useSessionStore((s) => s.loadConfig);
  const saveProviderSettings = useSessionStore((s) => s.saveProviderSettings);
  const error = useSessionStore((s) => s.error);

  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKeyEnv, setApiKeyEnv] = useState("OPENAI_API_KEY");
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    void loadConfig();
  }, [baseUrl, loadConfig]);

  useEffect(() => {
    if (!config) {
      return;
    }
    setApiBaseUrl(apiBaseUrlFromConfig(config));
    setModel(modelNameFromConfig(config));
    setApiKeyEnv(apiKeyEnvFromConfig(config));
  }, [config]);

  return (
    <div className="mt-6 space-y-4" data-provider-settings>
      <div>
        <h3 className="text-sm font-medium">模型 Provider</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          密钥仍从环境变量读取（如 <code>{apiKeyEnv}</code>
          ），此处只改接口地址与模型名。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant="outline"
            data-provider-preset={preset.id}
            onClick={() => {
              setApiBaseUrl(preset.apiBaseUrl);
              setModel(preset.model);
              setSavedHint(null);
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">API Base URL</span>
        <Input
          value={apiBaseUrl}
          onChange={(e) => {
            setApiBaseUrl(e.target.value);
            setSavedHint(null);
          }}
          placeholder="https://api.deepseek.com"
          data-settings-api-base-url
          className="font-mono text-xs"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">模型名</span>
        <Input
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setSavedHint(null);
          }}
          placeholder="deepseek-chat"
          data-settings-model
          className="font-mono text-xs"
        />
      </label>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <div>
          密钥环境变量：<code>{apiKeyEnv}</code>（不在此填写密钥）
        </div>
        <div className="mt-1 font-mono">
          生效引用：openai/{model || "…"}
        </div>
      </div>

      <Button
        type="button"
        disabled={saving || !apiBaseUrl.trim() || !model.trim()}
        data-settings-save-provider
        onClick={() => {
          setSaving(true);
          setSavedHint(null);
          void saveProviderSettings({
            apiBaseUrl: apiBaseUrl.trim(),
            model: model.trim(),
          })
            .then(() => setSavedHint("已保存，下一轮对话立即生效"))
            .finally(() => setSaving(false));
        }}
      >
        {saving ? "保存中…" : "保存模型设置"}
      </Button>

      {savedHint ? (
        <p className="text-xs text-emerald-700" data-settings-save-ok>
          {savedHint}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-red-700" data-settings-save-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
