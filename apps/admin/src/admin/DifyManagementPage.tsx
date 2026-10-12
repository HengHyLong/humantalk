import { useEffect, useState } from "react";
import { DifyConfig } from "../components/DifyConfig";
import { FrontendAccessConfig } from "../components/FrontendAccessConfig";
import { applyRuntimeConfig, loadRuntimeConfig, type RuntimeConfigApplyInput, type RuntimeConfigResponse } from "../lib/api";

export function DifyManagementPage({ canWrite }: { canWrite: boolean }) {
  const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void loadRuntimeConfig().then(setConfig).catch(() => setError("配置读取失败，请稍后重试。")); }, []);
  const apply = async (input: RuntimeConfigApplyInput) => {
    setSaving(true);
    try { setConfig(await applyRuntimeConfig(input)); setError(""); }
    finally { setSaving(false); }
  };
  return <div className="mx-auto max-w-5xl space-y-4 p-6">
    <h1 className="text-xl font-semibold">数字人智能体配置</h1>
    {error && <p className="text-sm text-rose-600">{error}</p>}
    <DifyConfig config={config} onApply={apply} applying={saving || !canWrite || !config} />
    <FrontendAccessConfig canWrite={canWrite} />
    <p className="text-sm text-slate-500">在 Dify 中维护模型、提示词、知识库和对话记忆。展商、展品及路线仍在展会管理中维护，数字人形象和声音仍在数字人中心配置。</p>
  </div>;
}
