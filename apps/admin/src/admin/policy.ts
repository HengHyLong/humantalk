import type { AdminRole, ButtonPermission, PermissionCode } from "./types";

export const ROLE_PERMISSIONS: Record<AdminRole, PermissionCode[]> = {
  sys_admin: [
    "dashboard:view", "asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle",
    "knowledge:document", "knowledge:base", "knowledge:memory", "knowledge:qa", "knowledge:script", "knowledge:publish", "interact:test",
    "interact:welcome", "interact:explain", "interact:shopping", "event:exhibition", "event:exhibitor",
    "event:exhibit", "event:venue", "event:route", "event:schedule", "lead:view", "report:interaction", "system:user",
  ],
  content_ops: [
    "dashboard:view", "asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle",
    "knowledge:document", "knowledge:base", "knowledge:memory", "knowledge:qa", "knowledge:script", "knowledge:publish", "interact:test",
    "interact:welcome", "interact:explain", "interact:shopping", "event:exhibition", "event:exhibitor",
    "event:exhibit", "event:venue", "event:route", "event:schedule", "lead:view",
  ],
  data_viewer: ["dashboard:view", "lead:view", "report:interaction"],
  security_audit: ["dashboard:view", "report:interaction", "system:user"],
  readonly: [
    "dashboard:view", "asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle",
    "knowledge:document", "knowledge:base", "knowledge:memory", "knowledge:qa", "knowledge:script", "knowledge:publish", "interact:test",
    "interact:welcome", "interact:explain", "interact:shopping", "event:exhibition", "event:exhibitor",
    "event:exhibit", "event:venue", "event:route", "event:schedule", "lead:view", "report:interaction", "system:user",
  ],
};

export const ROLE_BUTTON_PERMISSIONS: Record<AdminRole, ButtonPermission[]> = {
  sys_admin: ["event:exhibition:write", "event:exhibitor:write", "event:exhibit:write", "event:venue:write", "event:route:write", "event:schedule:write", "asset:gif:write", "asset:scene:write", "knowledge:qa:write", "knowledge:publish:approve", "knowledge:rollback", "report:export"],
  content_ops: ["event:exhibition:write", "event:exhibitor:write", "event:exhibit:write", "event:venue:write", "event:route:write", "event:schedule:write", "asset:gif:write", "asset:scene:write", "knowledge:qa:write", "knowledge:publish:approve"],
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
