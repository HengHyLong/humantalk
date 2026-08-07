import assert from "node:assert/strict";
import test from "node:test";

import { FetchAdminApiClient } from "../src/admin/api";
import type { AdminUser } from "../src/admin/types";
import type { EmergencyBroadcast, Exhibition, ExhibitionRoute } from "../src/admin/types";

const values = new Map<string, string>();
const dispatchedEvents: string[] = [];
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: { href: "http://localhost:5174/admin/login" },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    dispatchEvent: (event: Event) => dispatchedEvents.push(event.type),
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
  const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, authorization: new Headers(init?.headers).get("Authorization"), body: String(init?.body ?? "") });
    if (url.endsWith("/api/v1/auth/permissions")) return Response.json({ codes: ["dashboard:view"] });
    return Response.json({ token: "jwt-login", access_token: "jwt-login", refresh_token: "refresh-login", expires_at: 1785873600, user: { id: "user-admin", username: "admin", display_name: "管理员", roles: ["sys_admin"] } });
  };

  const session = await new FetchAdminApiClient().login("admin", "secret");
  assert.equal(calls[0].url, "http://localhost:5174/api/v1/auth/login");
  assert.deepEqual(JSON.parse(calls[0].body), { username: "admin", password: "secret" });
  assert.equal(calls[1].url.endsWith("/api/v1/auth/permissions"), true);
  assert.equal(calls[1].authorization, "Bearer jwt-login");
  assert.equal(values.get("opentalking-admin-token"), "jwt-login");
  assert.equal(values.get("opentalking-admin-refresh-token"), "refresh-login");
  assert.equal(session.user.role, "sys_admin");
  assert.deepEqual(session.user.permissions, ["dashboard:view"]);
});

test("real Admin clears its session and emits auth-expired after 401", async () => {
  values.clear();
  dispatchedEvents.length = 0;
  values.set("opentalking-admin-token", "expired-token");
  values.set("opentalking-admin-session", JSON.stringify({ token: "expired-token", user }));
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("Authorization") });
    return Response.json({ detail: "Token expired" }, { status: 401 });
  };

  await assert.rejects(() => new FetchAdminApiClient().getDashboard(), /Token expired/);
  assert.equal(calls[0].authorization, "Bearer expired-token");
  assert.equal(values.has("opentalking-admin-token"), false);
  assert.equal(values.has("opentalking-admin-session"), false);
  assert.deepEqual(dispatchedEvents, ["opentalking-admin-auth-expired"]);
});

test("real Admin refreshes an expired access token with the stored refresh token", async () => {
  values.clear();
  values.set("opentalking-admin-token", "expired-token");
  values.set("opentalking-admin-refresh-token", "refresh-token");
  const calls: Array<{ url: string; authorization: string | null; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, authorization: headers.get("Authorization"), body });
    if (url.endsWith("/api/v1/auth/refresh")) return Response.json({ access_token: "renewed-token", refresh_token: "rotated-refresh" });
    if (headers.get("Authorization") === "Bearer expired-token") return Response.json({ detail: "Token expired" }, { status: 401 });
    return Response.json({ interaction_count: 0, online_terminals: 0, pending_knowledge: 0, new_leads: 0, alerts: 0, todo: [] });
  };

  const data = await new FetchAdminApiClient().getDashboard();
  assert.equal(data.metrics.length, 5);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/api/v1/admin/report",
    "/api/v1/auth/refresh",
    "/api/v1/admin/report",
  ]);
  assert.equal(calls[1].authorization, null);
  assert.deepEqual(calls[1].body, { refresh_token: "refresh-token" });
  assert.equal(calls[2].authorization, "Bearer renewed-token");
  assert.equal(values.get("opentalking-admin-token"), "renewed-token");
  assert.equal(values.get("opentalking-admin-refresh-token"), "rotated-refresh");
});

test("real Admin errors expose the backend detail message", async () => {
  values.clear();
  globalThis.fetch = async () => Response.json(
    { code: "INVALID_CREDENTIALS", detail: "账号或密码错误", trace_id: "trace-login-1" },
    { status: 403 },
  );

  await assert.rejects(
    () => new FetchAdminApiClient().login("admin", "wrong"),
    (error: unknown) => error instanceof Error
      && error.message === "账号或密码错误",
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
    if (call.url.endsWith("/admin/event/exhibitions?page=1&page_size=100") && call.method === "GET") return Response.json({ items: [{ id: "event-1" }], total: 1, page: 1, page_size: 100 });
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ ...body, id: call.url.includes("routes") ? "route-created" : call.url.includes("broadcast") ? "broadcast-1" : "event-1" });
  };

  const api = new FetchAdminApiClient();
  assert.equal((await api.listExhibitions())[0].id, "event-1");
  await Promise.all([api.listExhibitors(), api.listExhibits(), api.listVenues(), api.listPoints(), api.listRoutes(), api.listSchedules(), api.listBroadcasts()]);
  assert.deepEqual(
    calls.slice(0, 8).map(({ url }) => new URL(url).pathname + new URL(url).search),
    ["exhibitions", "exhibitors", "exhibits", "venues", "points", "routes", "schedules", "broadcasts"]
      .map((resource) => `/api/v1/admin/event/${resource}?page=1&page_size=100`),
  );

  const exhibition = { id: "new-1722780000000", name: "测试展会", code: "TEST", mainVenueId: null, hostUnit: "主办", organizerUnit: "承办", coOrganizerUnits: "", startDate: "2026-09-01", endDate: "2026-09-03", status: "preparing", description: "", boundAvatarId: null, boundModel: "QuickTalk", boundVoiceId: null, boundVoiceProvider: null, boundVoiceModel: null, boundSttProvider: null, boundSttModel: null, boundScene: null, knowledgeBaseIds: [], lifecycleHistory: [], createdAt: "", updatedAt: "" } satisfies Exhibition;
  await api.saveExhibition(exhibition);
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body?.id, undefined);

  await api.saveExhibition({ ...exhibition, id: "event-1" });
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/exhibitions/event-1"), true);
  assert.equal(calls.at(-1)?.method, "PATCH");
  await api.transitionExhibition("event-1", "setup");
  assert.deepEqual(calls.at(-1)?.body, { status: "setup" });
  await api.saveExhibitionRuntimeConfig({ ...exhibition, id: "event-1", boundAvatarId: "avatar-1", knowledgeBaseIds: ["kb-1"] });
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/exhibitions/event-1/runtime-config"), true);
  assert.equal(calls.at(-1)?.method, "PUT");
  assert.equal(calls.at(-1)?.body?.name, "测试展会");
  assert.deepEqual(calls.at(-1)?.body?.knowledgeBaseIds, ["kb-1"]);
  await api.getExhibitionRuntimeConfig("event-1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/exhibitions/event-1/runtime-config"), true);
  assert.equal(calls.at(-1)?.method, "GET");
  await api.validateExhibitionRuntimeConfig({ ...exhibition, id: "event-1", boundAvatarId: "avatar-1", knowledgeBaseIds: ["kb-1"] });
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/exhibitions/event-1/runtime-config/validate"), true);
  assert.equal(calls.at(-1)?.method, "POST");

  const route = { id: "new-1722780000001", venueId: "venue A/1", name: "入口路线", type: "navigation", pointIds: ["p1", "p2"], directions: ["直行"], estimatedMinutes: 2, description: "", status: "draft", createdAt: "", updatedAt: "" } satisfies ExhibitionRoute;
  await api.saveRoute(route);
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/routes"), true);
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body?.id, undefined);

  const broadcast = { id: "broadcast-1", exhibitionId: "event-1", title: "安全提示", content: "请有序参观", priority: "high", targetTerminals: "全部终端", effectiveAt: "2026-09-01 08:00", status: "draft", createdAt: "", updatedAt: "" } satisfies EmergencyBroadcast;
  await api.transitionBroadcast(broadcast.id, "active");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/event/broadcasts/broadcast-1/activate"), true);
  await api.deleteBroadcast(broadcast.id);
  assert.equal(calls.at(-1)?.method, "DELETE");
});

test("real Admin infers exhibition scope when saving points and routes", async () => {
  values.clear();
  values.set("opentalking-admin-token", "event-token");
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url.includes("/admin/event/venues?")) return Response.json({ items: [{ id: "venue-1", exhibitionId: "expo-1" }] });
    if (url.endsWith("/admin/event/points") || url.endsWith("/admin/event/routes")) return Response.json({ ...(body?.data as Record<string, unknown>), id: "saved-event" });
    return Response.json({ items: [] });
  };

  const api = new FetchAdminApiClient();
  await api.savePoint({ id: "new-1", exhibitionId: "", venueId: "venue-1", code: "P-1", name: "点位", type: "other", floor: "1F", x: 1, y: 2, exhibitorId: null, exhibitId: null, description: "", status: "draft", createdAt: "", updatedAt: "" });
  await api.saveRoute({ id: "new-2", exhibitionId: "", venueId: "venue-1", name: "路线", type: "navigation", pointIds: ["p1", "p2"], directions: [], estimatedMinutes: 1, description: "", status: "draft", createdAt: "", updatedAt: "" });
  const writes = calls.filter((call) => call.method === "POST");
  assert.equal(writes.length, 2);
  assert.equal((writes[0].body?.data as Record<string, unknown>).exhibitionId, "expo-1");
  assert.equal((writes[1].body?.data as Record<string, unknown>).exhibitionId, "expo-1");
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
    if (url.endsWith("/admin/ops/gateway-policy") && method === "GET") return Response.json({ id: "default", whitelist: [], fallbackMode: "text" });
    if (url.includes("/admin/audit/trace/")) return Response.json({ id: "audit-1", traceId: "trace/1", spans: [] });
    if (url.endsWith("/acknowledge")) return Response.json({ id: "alert-1", status: "acknowledged", ...body });
    if (method === "DELETE" || url.endsWith("/reset-password")) return new Response(null, { status: 204 });
    if (method === "POST" || method === "PATCH") return Response.json({ ...body, id: "saved-1" });
    return Response.json({ items: [{ id: "item-1" }], total: 1, page: 1, page_size: 9 });
  };

  const api = new FetchAdminApiClient();
  await api.listAdminUsers({ keyword: "张 三", status: "active" });
  assert.equal(calls.some(({ url }) => url.includes("/admin/users?") && url.includes("keyword=%E5%BC%A0+%E4%B8%89&status=active")), true);
  await api.saveAdminUser({ id: "user-1722780000000", username: "test", displayName: "测试", gender: "未设置", phone: "", email: "", department: "研发部", status: "active", roleIds: [], createdAt: "2026-08-04", lastLoginAt: "-", lastLoginIp: "-" });
  assert.equal(calls.at(-1)?.url.endsWith("/admin/users"), true);
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body?.id, undefined);
  await api.resetAdminPassword("user/a");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/users/user%2Fa/reset-password"), true);
  await api.listRoles();
  assert.equal(calls.at(-1)?.url.includes("/admin/roles?page=1&page_size=100"), true);
  await api.listPermissionTree();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/permission-tree"), true);
  await api.listAuditLogs({ keyword: "登录失败" });
  assert.equal(calls.at(-1)?.url.includes("/admin/audit-logs?"), true);
  assert.equal(calls.at(-1)?.url.includes("keyword=%E7%99%BB%E5%BD%95%E5%A4%B1%E8%B4%A5"), true);
  assert.equal((await api.getTraceRecord("trace/1"))?.traceId, "trace/1");
  assert.equal(calls.some(({ url }) => url.endsWith("/admin/audit/trace/trace%2F1")), true);
  assert.match(await api.exportAuditLogs({ username: "admin" }), /id,name/);
  await api.exportAuditLogs({ keyword: "张三" });
  assert.equal(calls.at(-1)?.url.includes("/admin/audit-logs/export?keyword="), true);
  await api.getSystemMonitor();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/ops/system"), true);
  await api.listAlerts();
  await api.acknowledgeAlert("alert-1", "吴涓");
  assert.equal(calls.at(-1)?.body, undefined);
  await api.getGatewayPolicy();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/ops/gateway-policy"), true);
  await api.saveGatewayPolicy({ id: "default", name: "默认策略", whitelist: ["127.0.0.1"], rateLimitPerMinute: 60, timeoutMs: 15000, fallbackMode: "text", enabled: true, updatedAt: "" });
  assert.equal(calls.at(-1)?.method, "PUT");
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
  assert.equal(calls.some(({ url }) => url.includes("/admin/interaction/welcome-configs?") && url.includes("exhibition_id=event+A%2F1")), true);
  await api.saveWelcomeConfig({ id: "welcome-config-1722780000000", exhibitionId: "event-1", exhibitionName: "测试展", trigger: "person_detected", scriptId: "script-1", voiceId: "voice-1", enabled: true, cooldownSeconds: 30, updatedAt: "" });
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body?.id, undefined);
  await api.listExplainFlows("event-1");
  assert.equal(calls.some(({ url }) => url.includes("/admin/interaction/explain-flows?")), true);
  await api.deleteExplainFlow("flow/1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/interaction/explain-flows/flow%2F1"), true);
  await api.listShoppingStrategies("event-1");
  assert.equal(calls.some(({ url }) => url.includes("/admin/interaction/shopping-strategies?")), true);
  await api.deleteShoppingStrategy("strategy/1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/interaction/shopping-strategies/strategy%2F1"), true);
});

test("real Admin digital assets never fall back to Mock storage", async () => {
  values.clear();
  values.set("opentalking-admin-token", "asset-token");
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "GET") return Response.json({ items: [] });
    if (url.endsWith("/scene-bindings")) return Response.json(body?.bindings ?? []);
    return Response.json({ ...body, id: "saved-asset" });
  };
  const api = new FetchAdminApiClient();
  await api.listGifs();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/assets/gifs?page=1&page_size=100"), true);
  await api.updateGif("gif/1", { status: "inactive" });
  assert.equal(calls.at(-1)?.url.endsWith("/admin/assets/gifs/gif%2F1"), true);
  await api.listVoiceConfigs();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/assets/voice-configs?page=1&page_size=100"), true);
  await api.deleteVoiceConfig("voice/1");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/assets/voice-configs/voice%2F1"), true);
  await api.saveSceneBindings([{ scene: "welcome", assets: [] }]);
  assert.equal(calls.at(-1)?.method, "PUT");
  await api.listIdle();
  assert.equal(calls.at(-1)?.url.endsWith("/admin/assets/idle-contents?page=1&page_size=100"), true);
});

test("real Admin knowledge workflow maps documents, QA, scripts, packages and miss pool", async () => {
  values.clear(); values.set("opentalking-admin-token", "knowledge-token");
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => { const url = String(input); const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined; calls.push({ url, method, body }); if (method === "DELETE") return new Response(null, { status: 204 }); if (method === "GET") return Response.json({ items: [] }); return Response.json({ ...body, id: "saved-knowledge" }); };
  const api = new FetchAdminApiClient();
   await api.listDocuments(); assert.equal(calls.at(-1)?.url.endsWith("/admin/knowledge/documents"), true);
  await api.uploadDocument({ title: "展会手册", fileName: "manual.pdf", type: "PDF", exhibition: "测试展" }); assert.equal(calls.at(-1)?.method, "POST");
  await api.updateDocument("doc/1", { parseStatus: "failed" }); assert.equal(calls.at(-1)?.url.endsWith("/admin/knowledge/documents/doc%2F1"), true);
  await api.listQa(); assert.equal(calls.at(-1)?.url.endsWith("/admin/knowledge/qa?page=1&page_size=100"), true);
  await api.transitionQa("qa/1", "published"); assert.deepEqual(calls.at(-1)?.body, { status: "published", operator: "admin" });
  await api.listScripts(); assert.equal(calls.at(-1)?.url.endsWith("/admin/knowledge/scripts?page=1&page_size=100"), true);
  await api.listPackages(); assert.equal(calls.at(-1)?.url.endsWith("/admin/knowledge/packages?page=1&page_size=100"), true);
  await api.transitionPackage("pkg/1", "published"); assert.equal(calls.at(-1)?.url.endsWith("/admin/knowledge/packages/pkg%2F1/publish"), true);
  await api.listMissPool(); assert.equal(calls.at(-1)?.url.endsWith("/admin/knowledge/miss-pool?page=1&page_size=100"), true);
   await api.resolveMiss("miss/1", "converted_qa"); assert.deepEqual(calls.at(-1)?.body, { action: "create_qa", operator: "admin", note: "" });
});

test("real Admin uses the Cao Feiyang Dify proxy contract", async () => {
  values.clear(); values.set("opentalking-admin-token", "knowledge-token");
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/admin/knowledge/bases")) return Response.json({ items: [{ knowledge_base_id: "kb-1", name: "QA标准库" }] });
    if (url.includes("/admin/knowledge/documents/upload")) {
      assert.equal(method, "POST");
      const form = init?.body as FormData;
      assert.equal(form.get("exhibition_id"), "current");
      assert.equal(form.get("title"), "qa.txt");
      assert.equal(form.get("type"), "text/plain");
      return Response.json({ batch_id: "batch-1", status: "processing" });
    }
    if (url.includes("/admin/knowledge/documents")) return Response.json({ data: [{ id: "doc-1", name: "qa.txt", indexing_status: "completed", display_status: "available", word_count: 12 }] });
    return Response.json({});
  };
  const api = new FetchAdminApiClient();
  const bases = await api.listKnowledgeBases();
  assert.equal(bases[0]?.id, "kb-1");
  const documents = await api.listKnowledgeBaseDocuments("kb-1");
  assert.equal(documents[0]?.status, "ready");
  const uploaded = await api.uploadKnowledgeBaseDocument("kb-1", new File(["demo"], "qa.txt", { type: "text/plain" }));
  assert.equal(uploaded.id, "batch-1");
  assert.equal(calls.some(({ url }) => url.endsWith("/api/v1/admin/knowledge/bases?limit=20")), true);
  assert.equal(calls.some(({ url }) => url.endsWith("/api/v1/admin/knowledge/documents")), true);
  assert.equal(calls.some(({ url }) => url.endsWith("/api/v1/admin/knowledge/documents/upload")), true);
});

test("real Admin leads and feedback map filtering, state, export and trace workflow", async () => {
  values.clear(); values.set("opentalking-admin-token", "lead-token");
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => { const url = String(input); const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined; calls.push({ url, method, body }); if (url.includes("/export")) return new Response("id,status\n1,new"); if (method === "GET" && /\/lead\/[^?]+$/.test(url)) return Response.json({ id: "lead-1", traceId: "trace-1" }); if (method === "GET") return Response.json({ items: [] }); return Response.json({ ...body, id: "lead-1", traceId: "trace-1" }); };
  const api = new FetchAdminApiClient();
  await api.listLeads({ exhibitionId: "event 1", keyword: "机器人", status: "new" });
  assert.equal(calls.at(-1)?.url.includes("exhibition_id=event+1&keyword=%E6%9C%BA%E5%99%A8%E4%BA%BA&status=new"), true);
  assert.equal((await api.getLead("lead/1"))?.traceId, "trace-1");
  await api.updateLeadStatus("lead/1", "contacted", "已联系");
  assert.equal(calls.at(-1)?.url.endsWith("/admin/lead/lead%2F1/status"), true);
  assert.deepEqual(calls.at(-1)?.body, { status: "contacted", note: "已联系" });
  assert.match(await api.exportLeads({ from: "2026-08-01" }, "csv"), /id,status/);
  await api.listFeedback({ status: "pending" }); assert.equal(calls.at(-1)?.url.includes("status=pending"), true);
  await api.resolveFeedback("feedback/1", "已处理", "吴涓"); assert.deepEqual(calls.at(-1)?.body, { data: { note: "已处理" } });
});
