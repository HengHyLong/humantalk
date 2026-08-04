import assert from "node:assert/strict";
import test from "node:test";

import { AdminApiError, FetchAdminApiClient } from "../src/admin/api";
import type { AdminUser } from "../src/admin/types";
import type { EmergencyBroadcast, Exhibition, ExhibitionRoute } from "../src/admin/types";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: { href: "http://localhost:5174/admin/login" },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  },
});

const user: AdminUser = {
  id: "user-admin",
  username: "admin",
  displayName: "管理员",
  role: "sys_admin",
  permissions: ["dashboard:view"],
  buttonPermissions: [],
};

test("real Admin login persists token and uses the /api/v1 prefix", async () => {
  values.clear();
  let requestedUrl = "";
  let requestedBody = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body);
    return Response.json({ token: "jwt-login", expires_at: "2026-08-04T20:00:00.000Z", user });
  };

  const session = await new FetchAdminApiClient().login("admin", "secret");
  assert.equal(requestedUrl, "http://localhost:5174/api/v1/auth/login");
  assert.deepEqual(JSON.parse(requestedBody), { username: "admin", password: "secret" });
  assert.equal(values.get("opentalking-admin-token"), "jwt-login");
  assert.equal(session.expiresAt, Date.parse("2026-08-04T20:00:00.000Z"));
});

test("real Admin requests refresh once after 401 and retry with the new token", async () => {
  values.clear();
  values.set("opentalking-admin-token", "expired-token");
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("Authorization") });
    if (calls.length === 1) return Response.json({ detail: "Token expired" }, { status: 401 });
    if (calls.length === 2) return Response.json({ token: "fresh-token", user, expiresAt: Date.now() + 60_000 });
    return Response.json({ metrics: [], todos: [] });
  };

  await new FetchAdminApiClient().getDashboard();
  assert.equal(calls[0].authorization, "Bearer expired-token");
  assert.equal(calls[1].url.endsWith("/api/v1/auth/refresh"), true);
  assert.equal(calls[2].authorization, "Bearer fresh-token");
});

test("real Admin errors expose backend code and trace id", async () => {
  values.clear();
  globalThis.fetch = async () => Response.json(
    { code: "INVALID_CREDENTIALS", detail: "账号或密码错误", trace_id: "trace-login-1" },
    { status: 403 },
  );

  await assert.rejects(
    () => new FetchAdminApiClient().login("admin", "wrong"),
    (error: unknown) => error instanceof AdminApiError
      && error.message === "账号或密码错误"
      && error.code === "INVALID_CREDENTIALS"
      && error.traceId === "trace-login-1",
  );
});

test("real Admin event operations map list, create, update, lifecycle and activation endpoints", async () => {
  values.clear();
  values.set("opentalking-admin-token", "event-token");
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    const call = { url: String(input), method: init?.method ?? "GET", body };
    calls.push(call);
    if (call.url.endsWith("/admin/event/exhibitions") && call.method === "GET") return Response.json({ items: [{ id: "event-1" }], total: 1, page: 1, page_size: 9 });
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ ...body, id: call.url.includes("routes") ? "route-created" : call.url.includes("broadcast") ? "broadcast-1" : "event-1" });
  };

  const api = new FetchAdminApiClient();
  assert.equal((await api.listExhibitions())[0].id, "event-1");

  const exhibition = { id: "new-event", name: "测试展会", code: "TEST", mainVenueId: null, hostUnit: "主办", organizerUnit: "承办", coOrganizerUnits: "", startDate: "2026-09-01", endDate: "2026-09-03", status: "preparing", description: "", boundAvatarId: null, boundModel: "QuickTalk", boundVoiceId: null, boundVoiceProvider: null, boundVoiceModel: null, boundSttProvider: null, boundSttModel: null, boundScene: null, knowledgeBaseIds: [], lifecycleHistory: [], createdAt: "", updatedAt: "" } satisfies Exhibition;
  await api.saveExhibition(exhibition);
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body?.id, undefined);

  await api.saveExhibition({ ...exhibition, id: "event-1" });
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/exhibitions/event-1"), true);
  assert.equal(calls.at(-1)?.method, "PATCH");
  await api.transitionExhibition("event-1", "setup");
  assert.deepEqual(calls.at(-1)?.body, { status: "setup" });

  const route = { id: "new-route", venueId: "venue A/1", name: "入口路线", type: "navigation", pointIds: ["p1", "p2"], directions: ["直行"], estimatedMinutes: 2, description: "", status: "draft", createdAt: "", updatedAt: "" } satisfies ExhibitionRoute;
  await api.saveRoute(route);
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/venues/venue%20A%2F1/routes"), true);
  assert.equal(calls.at(-1)?.body?.id, undefined);

  const broadcast = { id: "broadcast-1", exhibitionId: "event-1", title: "安全提示", content: "请有序参观", priority: "high", targetTerminals: "全部终端", effectiveAt: "2026-09-01 08:00", status: "draft", createdAt: "", updatedAt: "" } satisfies EmergencyBroadcast;
  await api.transitionBroadcast(broadcast.id, "active");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/emergency-broadcasts/broadcast-1/activate"), true);
  await api.deleteBroadcast(broadcast.id);
  assert.equal(calls.at(-1)?.method, "DELETE");
});

test("real Admin system management maps RBAC, audit, monitor, alert and CSV endpoints", async () => {
  values.clear();
  values.set("opentalking-admin-token", "system-token");
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url.includes("/export")) return new Response("id,name\n1,admin", { headers: { "Content-Type": "text/csv" } });
    if (url.endsWith("/admin/ops/monitor")) return Response.json({ services: [], terminals: [], cpuHistory: [], memoryHistory: [] });
    if (url.includes("/admin/audit/trace/")) return Response.json({ id: "audit-1", traceId: "trace/1", spans: [] });
    if (url.endsWith("/acknowledge")) return Response.json({ id: "alert-1", status: "acknowledged", ...body });
    if (method === "DELETE" || url.endsWith("/reset-password")) return new Response(null, { status: 204 });
    if (method === "POST" || method === "PATCH") return Response.json({ ...body, id: "saved-1" });
    return Response.json({ items: [{ id: "item-1" }], total: 1, page: 1, page_size: 9 });
  };

  const api = new FetchAdminApiClient();
  await api.listAdminUsers({ keyword: "张 三", status: "active" });
  assert.equal(calls.at(-1)?.url.includes("keyword=%E5%BC%A0+%E4%B8%89&status=active"), true);
  await api.saveAdminUser({ id: "user-1722780000000", username: "test", displayName: "测试", gender: "未设置", phone: "", email: "", department: "研发部", status: "active", roleIds: [], createdAt: "2026-08-04", lastLoginAt: "-", lastLoginIp: "-" });
  assert.equal(calls.at(-1)?.url.endsWith("/admin/rbac/user"), true);
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body?.id, undefined);
  await api.resetAdminPassword("user/a");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/rbac/user/user%2Fa/reset-password"), true);
  await api.listRoles();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/rbac/role"), true);
  await api.listPermissionTree();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/rbac/permission"), true);
  await api.listAuditLogs({ keyword: "登录失败" });
  assert.equal(calls.at(-1)?.url.includes("/admin/audit-logs?keyword="), true);
  assert.equal((await api.getTraceRecord("trace/1"))?.traceId, "trace/1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/audit/trace/trace%2F1"), true);
  assert.match(await api.exportAuditLogs({ username: "admin" }), /id,name/);
  await api.getSystemMonitor();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/ops/monitor"), true);
  await api.listAlerts();
  await api.acknowledgeAlert("alert-1", "吴涓");
  assert.deepEqual(calls.at(-1)?.body, { operator: "吴涓" });
});

test("real Admin interaction management maps exhibition-scoped strategy endpoints", async () => {
  values.clear();
  values.set("opentalking-admin-token", "interaction-token");
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "POST" || method === "PATCH") return Response.json({ ...body, id: "saved-1" });
    return Response.json({ items: [], total: 0 });
  };

  const api = new FetchAdminApiClient();
  await api.listWelcomeConfigs("event A/1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/interactions/welcome-configs?exhibition_id=event+A%2F1"), true);
  await api.saveWelcomeConfig({ id: "welcome-1722780000000", exhibitionId: "event-1", exhibitionName: "测试展", trigger: "person_detected", scriptId: "script-1", voiceId: "voice-1", enabled: true, cooldownSeconds: 30, updatedAt: "" });
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body?.id, undefined);
  await api.listExplainFlows("event-1");
  assert.equal(calls.at(-1)?.url.includes("/admin/interactions/explain-flows?"), true);
  await api.deleteExplainFlow("flow/1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/interactions/explain-flows/flow%2F1"), true);
  await api.listShoppingStrategies("event-1");
  assert.equal(calls.at(-1)?.url.includes("/admin/interactions/shopping-strategies?"), true);
  await api.deleteShoppingStrategy("strategy/1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/interactions/shopping-strategies/strategy%2F1"), true);
});
