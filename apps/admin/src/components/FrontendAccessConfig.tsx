import { useEffect, useState } from "react";
import { loadFrontendAccess, saveFrontendPassword } from "../lib/api";

export function FrontendAccessConfig({ canWrite }: { canWrite: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void loadFrontendAccess().then(() => setReady(true)).catch(() => setMessage("密码配置读取失败，请刷新后重试。")); }, []);
  return <section className="rounded-lg border border-slate-200 bg-white p-4">
    <h2 className="text-sm font-semibold">数字人前端访问密码</h2>
    <p className="my-2 text-xs text-slate-500">浏览器会话内保持登录，关闭浏览器后需重新验证。修改密码后，旧验证失效。</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={async e => {
      e.preventDefault(); if (password !== confirm) { setMessage("两次输入的密码不一致。"); return; }
      setBusy(true);
      try { await saveFrontendPassword(password); setPassword(""); setConfirm(""); setMessage("访问密码已更新，旧验证已失效。"); }
      catch { setMessage("保存失败，请检查登录权限后重试。"); }
      finally { setBusy(false); }
    }}>
      <label className="text-xs text-slate-600">新密码<input required type="password" minLength={5} maxLength={128} autoComplete="new-password" className="mt-2 block rounded border border-slate-200 p-2 text-sm" value={password} onChange={e => setPassword(e.target.value)} disabled={!canWrite || busy} /></label>
      <label className="text-xs text-slate-600">确认新密码<input required type="password" minLength={5} maxLength={128} autoComplete="new-password" className="mt-2 block rounded border border-slate-200 p-2 text-sm" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={!canWrite || busy} /></label>
      <button disabled={!canWrite || !ready || busy} className="rounded bg-cyan-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "保存中…" : "更新访问密码"}</button>
    </form>
    {message && <p role="status" className="mt-3 text-sm text-slate-600">{message}</p>}
  </section>;
}
