import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost } from "../lib/api";

type ExhibitSurvey = {
  token: string;
  exhibitName: string;
  exhibitorName: string;
  exhibitionName: string;
  description: string;
  imageUrls: string[];
};

type SurveyForm = { companyName: string; contactName: string; phone: string; email: string; intentSummary: string; consent: boolean };
const emptyForm: SurveyForm = { companyName: "", contactName: "", phone: "", email: "", intentSummary: "", consent: false };
const publicImageUrl = (value: string) => value.startsWith("/scene-assets/") ? `/api${value}` : value;

export function ExhibitSurveyPage({ token }: { token: string }) {
  const [survey, setSurvey] = useState<ExhibitSurvey | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<ExhibitSurvey>(`v1/public/exhibit-surveys/${encodeURIComponent(token)}`)
      .then((value) => { if (active) setSurvey(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "调研表单加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.contactName.trim() || (!form.phone.trim() && !form.email.trim()) || !form.consent) {
      setError("请填写联系人、至少一种联系方式，并同意信息使用说明。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await apiPost(`v1/public/exhibit-surveys/${encodeURIComponent(token)}/submissions`, form);
      setSubmitted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">正在加载调研表单…</main>;
  if (!survey) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-semibold text-slate-900">表单暂不可用</h1><p className="mt-3 text-sm text-slate-500">{error || "请联系现场工作人员确认二维码。"}</p></div></main>;

  return <main className="min-h-screen bg-gradient-to-b from-cyan-50 via-white to-slate-50 px-4 py-8 sm:py-12"><div className="mx-auto max-w-2xl"><header className="mb-5 text-center"><p className="text-xs font-semibold tracking-[0.24em] text-cyan-700">展品调研</p><h1 className="mt-3 text-2xl font-bold text-slate-950 sm:text-3xl">{survey.exhibitName}</h1><p className="mt-2 text-sm text-slate-500">{survey.exhibitionName} · {survey.exhibitorName}</p></header><section className="overflow-hidden rounded-3xl border border-white bg-white shadow-xl shadow-cyan-900/5">{survey.imageUrls[0] ? <img src={publicImageUrl(survey.imageUrls[0])} alt={survey.exhibitName} className="h-52 w-full object-cover" /> : null}<div className="p-5 sm:p-8">{survey.description ? <p className="mb-6 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{survey.description}</p> : null}{submitted ? <div className="py-10 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div><h2 className="mt-5 text-xl font-semibold text-slate-950">感谢您的反馈</h2><p className="mt-2 text-sm text-slate-500">信息已同步至线索运营，工作人员将根据您的需求与您联系。</p></div> : <form onSubmit={submit} className="space-y-5"><div><h2 className="text-lg font-semibold text-slate-950">留下您的合作需求</h2><p className="mt-1 text-sm text-slate-500">带 * 为必填项，手机号与邮箱至少填写一项。</p></div><div className="grid gap-4 sm:grid-cols-2"><SurveyField label="单位名称" value={form.companyName} onChange={(value) => setForm({ ...form, companyName: value })} autoComplete="organization" /><SurveyField required label="联系人" value={form.contactName} onChange={(value) => setForm({ ...form, contactName: value })} autoComplete="name" /><SurveyField label="手机号" type="tel" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} autoComplete="tel" /><SurveyField label="邮箱" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} autoComplete="email" /></div><label className="block text-sm font-semibold text-slate-700">您关注的问题或合作需求<textarea value={form.intentSummary} onChange={(event) => setForm({ ...form, intentSummary: event.target.value })} rows={4} maxLength={2000} placeholder={`例如：希望进一步了解${survey.exhibitName}的方案、报价或合作方式`} className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 font-normal text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label><label className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600"><input type="checkbox" checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} className="mt-1" /><span>我同意将以上信息用于本次展品调研及后续业务联系。信息将同步至展会线索运营系统。</span></label>{error ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}<button type="submit" disabled={submitting} className="w-full rounded-xl bg-cyan-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-600/20 transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "提交中…" : "提交调研"}</button></form>}</div></section><p className="mt-5 text-center text-xs text-slate-400">四川博览集团数字人展会服务</p></div></main>;
}

function SurveyField({ label, value, onChange, required = false, type = "text", autoComplete }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; autoComplete?: string }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}{required ? " *" : ""}<input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} maxLength={200} autoComplete={autoComplete} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>;
}
