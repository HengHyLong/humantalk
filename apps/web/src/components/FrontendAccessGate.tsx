import { useEffect, useState, type ReactNode } from "react";
import { buildApiUrl } from "../lib/api";

export function FrontendAccessGate({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const response = await fetch(buildApiUrl("/frontend-access/status"), { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (mounted) { setAllowed(result.authenticated === true); setError(""); }
      } catch { if (mounted) setError("连接失败，请稍后重试或刷新页面。"); }
      finally { if (mounted) setChecking(false); }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 60000);
    window.addEventListener("focus", check);
    return () => { mounted = false; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, []);
  if (checking) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">正在连接…</div>;
  if (allowed) return <>{children}</>;
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
    <form className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-8" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try {
        const response = await fetch(buildApiUrl("/frontend-access/login"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
        if (!response.ok) { setError(response.status === 429 ? "尝试次数过多，请一分钟后重试。" : response.status === 401 ? "访问密码错误。" : "验证失败，请稍后重试。"); return; }
        setPassword(""); setAllowed(true);
      } catch { setError("连接失败，请稍后重试。"); }
      finally { setBusy(false); }
    }}>
      <h1 className="text-2xl font-semibold">数字人访问验证</h1>
      <p className="text-sm text-slate-400">请输入管理员提供的访问密码。</p>
      <label className="block text-sm">访问密码<input required minLength={5} maxLength={128} autoFocus autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-3 text-white" /></label>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-cyan-600 py-3 font-medium disabled:opacity-50">{busy ? "验证中…" : "进入数字人"}</button>
    </form>
  </main>;
}
