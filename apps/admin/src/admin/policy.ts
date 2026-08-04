import type { AdminRole, ButtonPermission, PermissionCode } from "./types";

export const ROLE_PERMISSIONS: Record<AdminRole, PermissionCode[]> = {
  sys_admin: [
    "dashboard:view", "asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle",
    "knowledge:document", "knowledge:base", "knowledge:memory", "knowledge:qa", "knowledge:script", "knowledge:publish", "interact:test",
    "interact:welcome", "interact:explain", "interact:shopping", "event:exhibition", "event:exhibitor",
    "event:exhibit", "event:venue", "event:point", "event:route", "event:schedule", "event:broadcast", "lead:view", "lead:view_sensitive", "lead:export", "lead:feedback", "report:interaction", "system:user", "system:role", "system:audit", "system:ops", "audit:trace", "ops:failover",
  ],
  content_ops: [
    "dashboard:view", "asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle",
    "knowledge:document", "knowledge:base", "knowledge:memory", "knowledge:qa", "knowledge:script", "knowledge:publish", "interact:test",
    "interact:welcome", "interact:explain", "interact:shopping", "event:exhibition", "event:exhibitor",
    "event:exhibit", "event:venue", "event:point", "event:route", "event:schedule", "event:broadcast", "lead:view", "lead:view_sensitive", "lead:export", "lead:feedback",
  ],
  data_viewer: ["dashboard:view", "lead:view", "lead:export", "report:interaction"],
  security_audit: ["dashboard:view", "report:interaction", "system:audit", "audit:trace"],
  readonly: [
    "dashboard:view", "asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle",
    "knowledge:document", "knowledge:base", "knowledge:memory", "knowledge:qa", "knowledge:script", "knowledge:publish", "interact:test",
    "interact:welcome", "interact:explain", "interact:shopping", "event:exhibition", "event:exhibitor",
    "event:exhibit", "event:venue", "event:point", "event:route", "event:schedule", "event:broadcast", "lead:view", "system:user", "system:role", "system:audit", "system:ops", "report:interaction",
  ],
};

export const ROLE_BUTTON_PERMISSIONS: Record<AdminRole, ButtonPermission[]> = {
  sys_admin: ["event:exhibition:write", "event:exhibitor:write", "event:exhibit:write", "event:venue:write", "event:point:write", "event:route:write", "event:schedule:write", "event:broadcast:write", "asset:gif:write", "asset:scene:write", "knowledge:qa:write", "knowledge:publish:approve", "knowledge:rollback", "report:export", "lead:write", "lead:feedback:write", "system:user:write", "system:role:write", "interact:welcome:write", "interact:explain:write", "interact:shopping:write", "audit:trace", "ops:failover"],
  content_ops: ["event:exhibition:write", "event:exhibitor:write", "event:exhibit:write", "event:venue:write", "event:point:write", "event:route:write", "event:schedule:write", "event:broadcast:write", "asset:gif:write", "asset:scene:write", "knowledge:qa:write", "knowledge:publish:approve", "report:export", "lead:write", "lead:feedback:write", "interact:welcome:write", "interact:explain:write", "interact:shopping:write"],
  data_viewer: ["report:export"],
  security_audit: [],
  readonly: [],
};

export function canAccess(role: AdminRole, permission?: PermissionCode): boolean {
  return !permission || ROLE_PERMISSIONS[role].includes(permission);
}

export function canUseButton(role: AdminRole, permission: ButtonPermission): boolean {
  return ROLE_BUTTON_PERMISSIONS[role].includes(permission);
}

export function roleLabel(role: AdminRole): string {
  return {
    sys_admin: "系统管理员",
    content_ops: "内容运营",
    data_viewer: "数据查看",
    security_audit: "安全审计",
    readonly: "只读用户",
  }[role];
}
