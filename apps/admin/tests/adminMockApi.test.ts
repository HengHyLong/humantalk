import assert from "node:assert/strict";
import test from "node:test";

import { MockAdminApiClient } from "../src/admin/api";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    setTimeout,
  },
});

test("Mock Admin API covers login and P1 CRUD/state flows", async () => {
  const api = new MockAdminApiClient();
  await assert.rejects(() => api.login("admin", "wrong"), /账号或密码/);
  const session = await api.login("admin", "Admin@123456");
  assert.equal(session.user.role, "sys_admin");
  assert.equal((await api.getDashboard()).metrics.length, 5);

  const gif = await api.createGif({ id: "", name: "测试动作", kind: "gif", previewUrl: "data:image/gif;base64,AA==", scene: "qa", tags: ["测试"], status: "active", width: 320, height: 240, frames: 2, durationMs: 80, fileName: "test.gif", sizeBytes: 20 });
  assert.equal((await api.updateGif(gif.id, { name: "测试动作-已编辑" })).name, "测试动作-已编辑");
  await api.deleteGif(gif.id);
  assert.equal((await api.listGifs()).some((item) => item.id === gif.id), false);

  const voice = await api.saveVoiceConfig({ id: "voice-config-test", provider: "xiaomi_mimo", targetModel: "mimo-v2.5-tts", voiceId: "mimo_default", name: "测试 MiMo 音色", previewText: "测试", status: "active", source: "local" });
  assert.equal((await api.listVoiceConfigs()).find((item) => item.id === voice.id)?.targetModel, "mimo-v2.5-tts");
  await api.deleteVoiceConfig(voice.id);

  const bindings = await api.saveSceneBindings([{ scene: "qa", assets: [{ assetId: "gif-welcome", isPrimary: true, order: 0 }] }]);
  assert.equal(bindings[0].scene, "qa");

  const doc = await api.uploadDocument({ title: "测试文档", fileName: "test.md", type: "官方口径", exhibition: "2026 西部博览会" });
  assert.equal((await api.updateDocument(doc.id, { title: "测试文档-已编辑" })).title, "测试文档-已编辑");
  await api.deleteDocument(doc.id);
  assert.equal((await api.listDocuments()).some((item) => item.id === doc.id), false);

  const qa = await api.saveQa({ id: "qa-test", question: "测试问题", keywords: ["测试"], answer: "测试答案", category: "服务", exhibition: "2026 西部博览会", status: "draft", version: 1, creator: "测试", updatedAt: "", history: [] });
  assert.equal((await api.transitionQa(qa.id, "pending_review")).status, "pending_review");
  assert.equal((await api.transitionQa(qa.id, "published")).status, "published");
  await api.deleteQa(qa.id);

  const script = await api.saveScript({ id: "script-test", name: "测试话术", scene: "welcome", content: "欢迎", exhibition: "2026 西部博览会", status: "active", updatedAt: "" });
  assert.equal((await api.listScripts()).some((item) => item.id === script.id), true);
  await api.deleteScript(script.id);

  const pack = await api.createPackage({ name: "测试发布包", exhibition: "2026 西部博览会", qaCount: 1, documentCount: 1 });
  assert.equal((await api.transitionPackage(pack.id, "pending_review")).status, "pending_review");
  assert.equal((await api.transitionPackage(pack.id, "published")).status, "published");

  const miss = (await api.listMissPool())[0];
  assert.equal((await api.resolveMiss(miss.id, "converted_qa")).status, "converted_qa");
  const idle = await api.saveIdle({ id: "idle-test", type: "标语轮播", title: "测试待机", content: "欢迎", interval: 6, exhibition: "2026 西部博览会", enabled: true });
  assert.equal((await api.listIdle()).some((item) => item.id === idle.id), true);
});

test("Mock Admin API covers event operations CRUD and relationships", async () => {
  const api = new MockAdminApiClient();
  const exhibition = await api.saveExhibition({ id: "event-test-exhibition", name: "测试展会", code: "TEST-2026", mainVenueId: null, hostUnit: "主办单位", organizerUnit: "承办单位", coOrganizerUnits: "协办单位一、协办单位二", startDate: "2026-09-01", endDate: "2026-09-03", status: "preparing", description: "测试", boundAvatarId: null, boundModel: "QuickTalk", boundVoiceId: null, boundScene: null, knowledgeBaseIds: [], lifecycleHistory: [], createdAt: "", updatedAt: "" });
  const exhibitor = await api.saveExhibitor({ id: "event-test-exhibitor", exhibitionId: exhibition.id, name: "测试展商", boothCode: "T-01", category: "测试", contact: "测试联系人", phone: "000", status: "active", description: "测试", createdAt: "", updatedAt: "" });
  const exhibit = await api.saveExhibit({ id: "event-test-exhibit", exhibitionId: exhibition.id, exhibitorId: exhibitor.id, name: "测试展品", category: "设备", modelNo: "T-001", description: "测试", status: "draft", createdAt: "", updatedAt: "" });
  const venue = await api.saveVenue({ id: "event-test-venue", exhibitionId: exhibition.id, name: "测试场地", address: "测试地址", description: "测试", status: "active", createdAt: "", updatedAt: "" });
  await api.saveExhibition({ ...exhibition, mainVenueId: venue.id });
  const entrance = await api.savePoint({ id: "event-test-point-entrance", venueId: venue.id, code: "ENT-TEST", name: "测试入口", type: "entrance", floor: "1F", x: 10, y: 20, exhibitorId: null, exhibitId: null, description: "测试", status: "active", createdAt: "", updatedAt: "" });
  const booth = await api.savePoint({ id: "event-test-point-booth", venueId: venue.id, code: "BOOTH-TEST", name: "测试展位", type: "booth", floor: "1F", x: 50, y: 60, exhibitorId: exhibitor.id, exhibitId: exhibit.id, description: "测试", status: "active", createdAt: "", updatedAt: "" });
  const route = await api.saveRoute({ id: "event-test-route", exhibitionId: exhibition.id, venueId: venue.id, name: "测试路线", type: "navigation", pointIds: [entrance.id, booth.id], keywords: ["怎么去测试区"], aliases: ["测试区"], fuzzyMatch: true, directions: ["沿主通道直行"], spokenText: "请沿主通道直行。", imageUrls: ["data:image/png;base64,test"], estimatedMinutes: 1, description: "测试", status: "draft", createdAt: "", updatedAt: "" });
  const schedule = await api.saveSchedule({ id: "event-test-schedule", exhibitionId: exhibition.id, venueId: venue.id, pointId: booth.id, title: "测试活动", type: "论坛", startAt: "2026-09-01 09:00", endAt: "2026-09-01 10:00", location: "测试厅", speaker: "测试方", description: "测试", status: "draft", createdAt: "", updatedAt: "" });
  const broadcast = await api.saveBroadcast({ id: "event-test-broadcast", exhibitionId: exhibition.id, title: "测试播报", content: "请有序参观", priority: "high", targetTerminals: "全部终端", effectiveAt: "2026-09-01 08:00", status: "draft", createdAt: "", updatedAt: "" });
  assert.equal((await api.transitionBroadcast(broadcast.id, "active")).status, "active");
  assert.equal((await api.transitionBroadcast(broadcast.id, "ended")).status, "ended");
  assert.equal((await api.transitionExhibition(exhibition.id, "setup")).status, "setup");
  await assert.rejects(() => api.saveExhibition({ ...exhibition, status: "operating" }), /生命周期/);
  assert.equal((await api.listExhibitors()).find((item) => item.id === exhibitor.id)?.exhibitionId, exhibition.id);
  assert.equal((await api.listExhibits()).find((item) => item.id === exhibit.id)?.exhibitorId, exhibitor.id);
  assert.equal((await api.listVenues()).find((item) => item.id === venue.id)?.exhibitionId, exhibition.id);
  assert.equal((await api.listRoutes()).find((item) => item.id === route.id)?.name, "测试路线");
  assert.deepEqual((await api.listRoutes()).find((item) => item.id === route.id)?.aliases, ["测试区"]);
  assert.deepEqual((await api.listRoutes()).find((item) => item.id === route.id)?.pointIds, [entrance.id, booth.id]);
  assert.equal((await api.listSchedules()).find((item) => item.id === schedule.id)?.title, "测试活动");
  await assert.rejects(() => api.deleteVenue(venue.id), /关联/);
  await assert.rejects(() => api.deleteExhibit(exhibit.id), /关联/);
  await assert.rejects(() => api.deletePoint(booth.id), /路线或活动/);
  await api.deleteExhibition(exhibition.id);
  assert.equal((await api.listExhibitions()).some((item) => item.id === exhibition.id), false);
  assert.equal((await api.listVenues()).some((item) => item.id === venue.id), false);
  assert.equal((await api.listPoints()).some((item) => item.id === entrance.id || item.id === booth.id), false);
  assert.equal((await api.listRoutes()).some((item) => item.id === route.id), false);
  assert.equal((await api.listSchedules()).some((item) => item.id === schedule.id), false);
  assert.equal((await api.listBroadcasts()).some((item) => item.id === broadcast.id), false);
  assert.equal((await api.listExhibits()).some((item) => item.id === exhibit.id), false);
  assert.equal((await api.listExhibitors()).some((item) => item.id === exhibitor.id), false);
});

test("Mock Admin API accepts cross-venue routes and generates segment directions", async () => {
  const api = new MockAdminApiClient();
  const exhibition = await api.saveExhibition({ id: "cross-route-exhibition", name: "跨馆路线展会", code: "CROSS-ROUTE", mainVenueId: null, hostUnit: "", organizerUnit: "", coOrganizerUnits: "", startDate: "2026-09-01", endDate: "2026-09-03", status: "preparing", description: "", boundAvatarId: null, boundModel: "QuickTalk", boundVoiceId: null, boundScene: null, knowledgeBaseIds: [], lifecycleHistory: [], createdAt: "", updatedAt: "" });
  const venueA = await api.saveVenue({ id: "cross-route-venue-a", exhibitionId: exhibition.id, name: "A馆", address: "", description: "", status: "active", createdAt: "", updatedAt: "" });
  const venueB = await api.saveVenue({ id: "cross-route-venue-b", exhibitionId: exhibition.id, name: "B馆", address: "", description: "", status: "active", createdAt: "", updatedAt: "" });
  const pointA = await api.savePoint({ id: "cross-route-point-a", venueId: venueA.id, code: "A-OUT", name: "A馆出口", type: "entrance", floor: "1F", x: 10, y: 20, exhibitorId: null, exhibitId: null, description: "", status: "active", createdAt: "", updatedAt: "" });
  const pointB = await api.savePoint({ id: "cross-route-point-b", venueId: venueB.id, code: "B-01", name: "机器人展区", type: "booth", floor: "1F", x: 20, y: 30, exhibitorId: null, exhibitId: null, description: "", status: "active", createdAt: "", updatedAt: "" });

  const route = await api.saveRoute({ id: "cross-route", exhibitionId: exhibition.id, venueId: "", name: "A馆到B馆", type: "navigation", pointIds: [pointA.id, pointB.id], keywords: ["机器人展区怎么走"], aliases: ["机器人馆"], fuzzyMatch: true, directions: [], spokenText: "", imageUrls: [], estimatedMinutes: 5, description: "", status: "draft", createdAt: "", updatedAt: "" });

  assert.equal(route.venueId, venueA.id);
  assert.deepEqual(route.directions, ["从A馆的A馆出口出发，离馆后前往B馆的机器人展区。"]);
});

test("Mock Admin API covers lead filtering, state flow, role permissions, trace and alerts", async () => {
  const api = new MockAdminApiClient();
  assert.equal((await api.listLeads({ exhibitionId: "exhibition-1" })).every((item) => item.exhibitionId === "exhibition-1"), true);
  const lead = (await api.listLeads())[0];
  assert.equal((await api.updateLeadStatus(lead.id, "contacted", "已电话联系")).status, "contacted");
  assert.equal((await api.getLead(lead.id))?.statusHistory.at(-1)?.note, "已电话联系");
  assert.match(await api.exportLeads({ exhibitionId: "exhibition-1" }), /线索ID/);
  const feedback = (await api.listFeedback({ status: "pending" }))[0];
  assert.equal((await api.resolveFeedback(feedback.id, "已跟进", "测试人员")).status, "handled");
  const roles = await api.listRoles();
  const permissions = await api.listPermissionTree();
  assert.ok(roles.some((role) => role.code === "sys_admin"));
  const collectMenus = (nodes: typeof permissions): typeof permissions => nodes.flatMap((node) => [node, ...(node.children ? collectMenus(node.children) : [])]);
  const menuNodes = collectMenus(permissions);
  assert.ok(menuNodes.some((node) => node.code === "system:user"));
  assert.equal(menuNodes.some((node) => node.code === "system:permission"), false);
  assert.equal(menuNodes.every((node) => node.type === "menu"), true);
  assert.ok(menuNodes.find((node) => node.code === "event:group:live")?.children?.some((node) => node.code === "lead:view"));
  assert.equal((await api.getTraceRecord("trace-20260803-001"))?.spans.length, 2);
  const alert = (await api.listAlerts()).find((item) => item.status === "active");
  assert.equal((await api.acknowledgeAlert(alert!.id, "测试人员")).status, "acknowledged");
  assert.equal((await api.getSystemMonitor()).services.length > 0, true);
});

test("Mock Admin API covers interaction strategy configuration", async () => {
  const api = new MockAdminApiClient();
  const scripts = await api.listScripts();
  assert.ok(scripts.some((item) => item.id === "script-3" && item.scene === "explain"));
  const welcome = (await api.listWelcomeConfigs("exhibition-1"))[0];
  assert.ok(welcome.triggers.includes("终端启动"));
  assert.deepEqual(welcome.wakeWords, ["你好小展"]);
  assert.equal(welcome.wakeActiveSeconds, 30);
  assert.equal((await api.listWelcomeConfigs("exhibition-2")).length, 0);
  const updatedWelcome = await api.saveWelcomeConfig({ ...welcome, notices: "请有序参观", wakeActiveSeconds: 45 });
  assert.equal(updatedWelcome.notices, "请有序参观");
  assert.equal(updatedWelcome.wakeActiveSeconds, 45);
  const flow = (await api.listExplainFlows("exhibition-1"))[0];
  assert.equal(flow.exhibitionId, "exhibition-1");
  assert.equal((await api.saveExplainFlow({ ...flow, status: "inactive" })).status, "inactive");
  const strategy = (await api.listShoppingStrategies("exhibition-1"))[0];
  assert.deepEqual(strategy.exhibitIds, ["exhibit-1"]);
  assert.equal(strategy.exhibitCategories.includes("工业软件"), false);
  assert.equal((await api.saveShoppingStrategy({ ...strategy, intentThreshold: 80 })).intentThreshold, 80);
});
