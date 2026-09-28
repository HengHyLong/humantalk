import { useEffect, useState } from "react";
import { adminApi } from "./api";
import { Badge, Button, Card, Field, Header } from "./CrudPages";
import type { SttConfig, SttConfigInput } from "./types";

type Draft = SttConfigInput;

export function SttConfigPage({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<SttConfig[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<SttConfig["provider"], Draft>>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = async () => {
    const configs = await adminApi.listSttConfigs();
    setItems(configs);
    setDrafts(Object.fromEntries(configs.map((item) => [item.provider, {
      appId: item.appId,
      baseUrl: item.baseUrl,
      model: item.model,
      apiKey: "",
      apiSecret: "",
    }])));
  };
  useEffect(() => { void reload().catch((caught) => setError(caught instanceof Error ? caught.message : "语音识别配置读取失败。")); }, []);

  const update = (provider: SttConfig["provider"], field: keyof Draft, value: string) => {
    setDrafts((current) => ({ ...current, [provider]: { ...current[provider], [field]: value } }));
  };
  const save = async (provider: SttConfig["provider"]) => {
    setBusy(provider); setError(""); setNotice("");
    try {
      await adminApi.saveSttConfig(provider, drafts[provider] || {});
      await reload();
      setNotice("配置已保存。另一家语音识别服务的配置保持不变。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败。"); }
    finally { setBusy(""); }
  };
  const activate = async (provider: SttConfig["provider"]) => {
    setBusy(provider); setError(""); setNotice("");
    try {
      await adminApi.activateSttConfig(provider);
      await reload();
      setNotice(`已将${provider === "xfyun" ? "科大讯飞" : "小米 MiMo"}设为默认语音识别服务。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "切换失败。"); }
    finally { setBusy(""); }
  };

  return <div className="p-6 xl:p-8">
    <Header eyebrow="系统管理" title="语音识别配置" description="分别保存科大讯飞和小米 MiMo 的凭据；切换默认服务不会清除另一家的配置。" />
    {error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
    {notice ? <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p> : null}
    <div className="grid gap-5 xl:grid-cols-2">
      {items.map((item) => {
        const draft = drafts[item.provider] || {};
        const ready = item.apiKeyConfigured && (item.provider === "xfyun" ? Boolean(item.appId && item.apiSecretConfigured) : Boolean(item.baseUrl && item.model));
        return <Card key={item.provider} className="p-5">
          <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-slate-900">{item.name}</h2><Badge tone={item.isActive ? "green" : ready ? "cyan" : "amber"}>{item.isActive ? "当前默认" : ready ? "已配置" : "待配置"}</Badge></div>
          <div className="space-y-4">
            {item.provider === "xfyun" ? <>
              <Field label="AppID" value={draft.appId || ""} onChange={(value) => update(item.provider, "appId", value)} placeholder="科大讯飞 AppID" />
              <p className="text-xs text-slate-500">接口：wss://iat.cn-huabei-1.xf-yun.com/v1 · 模型：slm</p>
            </> : <>
              <Field label="Base URL" value={draft.baseUrl || ""} onChange={(value) => update(item.provider, "baseUrl", value)} placeholder="https://api.xiaomimimo.com/v1" />
              <Field label="模型名称" value={draft.model || ""} onChange={(value) => update(item.provider, "model", value)} placeholder="mimo-v2.5-asr" />
            </>}
            <label className="block text-xs font-semibold text-slate-600">API Key<input type="password" autoComplete="new-password" value={draft.apiKey || ""} onChange={(event) => update(item.provider, "apiKey", event.target.value)} placeholder={item.apiKeyConfigured ? "已配置，留空保持原值" : "请输入 API Key"} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-cyan-400" /></label>
            {item.provider === "xfyun" ? <label className="block text-xs font-semibold text-slate-600">API Secret<input type="password" autoComplete="new-password" value={draft.apiSecret || ""} onChange={(event) => update(item.provider, "apiSecret", event.target.value)} placeholder={item.apiSecretConfigured ? "已配置，留空保持原值" : "请输入 API Secret"} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-cyan-400" /></label> : null}
          </div>
          <div className="mt-6 flex flex-wrap gap-2"><Button onClick={() => void save(item.provider)} disabled={!canWrite || Boolean(busy)}>保存配置</Button><Button variant="secondary" onClick={() => void activate(item.provider)} disabled={!canWrite || Boolean(busy) || !ready || item.isActive}>设为默认 STT</Button></div>
          <p className="mt-3 text-xs text-slate-500">保存后密钥不会在页面回显；修改密钥时重新输入即可。</p>
        </Card>;
      })}
    </div>
  </div>;
}
