import { useEffect, useState, type ReactNode } from "react";
import { adminApi } from "./api";
import { canAccess } from "./policy";
import {
  Badge,
  Button,
  Card,
  Field,
  Header,
  Modal,
  Pagination,
  usePagination,
} from "./CrudPages";
import type {
  AdminUser,
  AdminUserRecord,
  AlertEvent,
  AuditLog,
  GatewayPolicy,
  PermissionNode,
  RoleRecord,
  SystemMonitor,
} from "./types";

type SystemProps = {
  user: AdminUser;
  canWrite: boolean;
  canTrace?: boolean;
  canFailover?: boolean;
  onNavigate?: (path: string) => void;
};
const tones = {
  active: "green",
  inactive: "slate",
  ok: "green",
  warn: "amber",
  error: "rose",
  online: "green",
  offline: "rose",
  disabled: "slate",
  low: "slate",
  normal: "amber",
  high: "rose",
  urgent: "rose",
  acknowledged: "green",
  closed: "slate",
} as const;
function Status({
  value,
  label = value,
}: {
  value: keyof typeof tones;
  label?: string;
}) {
  return <Badge tone={tones[value]}>{label}</Badge>;
}
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700"
      >
        {children}
      </select>
    </label>
  );
}
const download = (content: string, name: string) => {
  const url = URL.createObjectURL(
    new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function UserManagementPage({ user, canWrite }: SystemProps) {
  const [items, setItems] = useState<AdminUserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<AdminUserRecord | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const reload = () =>
    void Promise.all([adminApi.listAdminUsers(), adminApi.listRoles()]).then(
      ([users, roleItems]) => {
        setItems(users);
        setRoles(roleItems);
      },
    );
  useEffect(reload, []);
  const filtered = items.filter(
    (item) =>
      (!status || item.status === status) &&
      (!keyword ||
        `${item.username} ${item.displayName} ${item.email}`
          .toLowerCase()
          .includes(keyword.toLowerCase())),
  );
  const pagination = usePagination(filtered);
  const save = async () => {
    if (!editing) return;
    const saved = await adminApi.saveAdminUser(editing);
    setItems((current) => [
      saved,
      ...current.filter((item) => item.id !== saved.id),
    ]);
    setEditing(null);
  };
  if (!canAccess(user.role, "system:user")) return <div className="flex min-h-full items-center justify-center p-8"><Card className="w-full max-w-lg p-10 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600"><span className="text-xl font-bold">403</span></div><h1 className="mt-5 text-lg font-semibold text-slate-900">无权限访问</h1><p className="mt-2 text-sm leading-6 text-slate-500">当前账号没有用户管理权限。请联系系统管理员申请权限，或返回首页继续操作。</p><div className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-left text-xs text-slate-500"><p className="font-semibold text-slate-700">权限码：system:user</p><p className="mt-1">服务端接口返回 403 时，页面会保持相同提示。</p></div></Card></div>;
  const roleName = (ids: string[]) =>
    ids
      .map((id) => roles.find((role) => role.id === id)?.name)
      .filter(Boolean)
      .join("、") || "未分配";
  return (
    <div className="p-6 xl:p-8">
      <Header
        eyebrow="系统管理"
        title="用户管理"
        description="管理后台账号、部门、状态和角色绑定。"
        action={
          <Button
            onClick={() =>
              setEditing({
                id: `user-${Date.now()}`,
                username: "",
                displayName: "",
                gender: "未设置",
                phone: "",
                email: "",
                department: "",
                status: "active",
                roleIds: [],
                createdAt: new Date().toISOString().slice(0, 10),
                lastLoginAt: "-",
                lastLoginIp: "-",
              })
            }
            disabled={!canWrite}
          >
            + 新增
          </Button>
        }
      />
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field
            label="用户名 / 昵称 / 邮箱"
            value={keyword}
            onChange={setKeyword}
            placeholder="输入名称或邮箱搜索"
          />
          <Select label="状态" value={status} onChange={setStatus}>
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </Select>
          <div className="flex items-end gap-2">
            <Button onClick={reload}>搜索</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setKeyword("");
                setStatus("");
              }}
            >
              重置
            </Button>
          </div>
        </div>
      </Card>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={!canWrite || !selected.length}
          onClick={() => {
            if (window.confirm(`确认删除选中的 ${selected.length} 个用户？`))
              void Promise.all(
                selected.map((id) => adminApi.deleteAdminUser(id)),
              ).then(() => {
                setSelected([]);
                reload();
              });
          }}
        >
          删除选中
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void adminApi
              .exportAuditLogs({ keyword })
              .then((csv) => download(csv, "用户列表.csv"))
          }
        >
          ↓ 导出
        </Button>
      </div>
      <Card className="mt-4 overflow-x-auto">
        <table className="min-w-[1050px] w-full text-left text-xs">
          <thead className="border-b border-slate-200 text-slate-400">
            <tr>
              <th className="px-4 py-4">
                <input
                  type="checkbox"
                  checked={
                    filtered.length > 0 && selected.length === filtered.length
                  }
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? filtered.map((item) => item.id)
                        : [],
                    )
                  }
                />
              </th>
              {[
                "用户名",
                "昵称",
                "性别",
                "电话",
                "邮箱",
                "部门",
                "角色",
                "状态",
                "创建日期",
                "操作",
              ].map((label) => (
                <th key={label} className="px-4 py-4 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagination.pageItems.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                </td>
                <td className="px-4 py-4 font-semibold text-slate-800">
                  {item.username}
                </td>
                <td className="px-4 py-4 text-slate-600">{item.displayName}</td>
                <td className="px-4 py-4 text-slate-500">{item.gender}</td>
                <td className="px-4 py-4 text-slate-500">{item.phone}</td>
                <td className="px-4 py-4 text-slate-500">{item.email}</td>
                <td className="px-4 py-4 text-slate-500">
                  {item.department}
                  <br />
                  <span className="text-[10px] text-cyan-700">
                    {roleName(item.roleIds)}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <Status
                    value={item.status}
                    label={item.status === "active" ? "启用" : "停用"}
                  />
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-slate-400">
                  {item.createdAt}
                </td>
                <td className="px-4 py-4">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      disabled={!canWrite}
                      onClick={() => setEditing(item)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!canWrite}
                      onClick={() => {
                        if (window.confirm("确认重置该用户密码？"))
                          void adminApi
                            .resetAdminPassword(item.id)
                            .then(() =>
                              window.alert(
                                "密码已重置，请通知用户使用临时密码登录。",
                              ),
                            );
                      }}
                    >
                      重置密码
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pagination.pageItems.length ? (
          <p className="px-4 py-12 text-center text-sm text-slate-400">
            暂无用户
          </p>
        ) : null}
      </Card>
      <Pagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        total={filtered.length}
        onChange={pagination.setPage}
      />
      {editing ? (
        <Modal
          title={editing.username ? "编辑用户" : "新增用户"}
          onClose={() => setEditing(null)}
          onSave={() => void save()}
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="用户名"
                value={editing.username}
                onChange={(value) =>
                  setEditing({ ...editing, username: value })
                }
              />
              <Field
                label="昵称"
                value={editing.displayName}
                onChange={(value) =>
                  setEditing({ ...editing, displayName: value })
                }
              />
              <Field
                label="手机"
                value={editing.phone}
                onChange={(value) => setEditing({ ...editing, phone: value })}
              />
              <Field
                label="邮箱"
                value={editing.email}
                onChange={(value) => setEditing({ ...editing, email: value })}
              />
              <Field
                label="部门"
                value={editing.department}
                onChange={(value) =>
                  setEditing({ ...editing, department: value })
                }
              />
            </div>
            <Select
              label="状态"
              value={editing.status}
              onChange={(value) =>
                setEditing({
                  ...editing,
                  status: value as AdminUserRecord["status"],
                })
              }
            >
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </Select>
            <Select
              label="角色"
              value={editing.roleIds[0] || ""}
              onChange={(value) =>
                setEditing({ ...editing, roleIds: value ? [value] : [] })
              }
            >
              <option value="">未分配</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function flat(nodes: PermissionNode[]): PermissionNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.children ? flat(node.children) : []),
  ]);
}
function Tree({
  nodes,
  checked,
  onToggle,
  expanded,
  onExpand,
}: {
  nodes: PermissionNode[];
  checked: Set<string>;
  onToggle: (node: PermissionNode) => void;
  expanded: Set<string>;
  onExpand: (id: string) => void;
}) {
  return (
    <div className="max-h-[520px] overflow-y-auto space-y-1 pr-2">
      {nodes.map((node) => (
        <div key={node.id} className="ml-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
            <button
              type="button"
              className="w-4 text-slate-400"
              onClick={() => onExpand(node.id)}
            >
              {node.children?.length ? (expanded.has(node.id) ? "⌄" : "›") : ""}
            </button>
            <input
              type="checkbox"
              checked={checked.has(node.code)}
              onChange={() => onToggle(node)}
            />
            <span className="text-sm text-slate-700">{node.name}</span>
            <Badge
              tone={
                node.type === "menu"
                  ? "cyan"
                  : node.type === "button"
                    ? "amber"
                    : "slate"
              }
            >
              {node.type}
            </Badge>
            <span className="ml-auto font-mono text-[10px] text-slate-400">
              {node.code}
            </span>
          </div>
          {node.children?.length && expanded.has(node.id) ? (
            <Tree
              nodes={node.children}
              checked={checked}
              onToggle={onToggle}
              expanded={expanded}
              onExpand={onExpand}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RoleManagementPage({ canWrite }: SystemProps) {
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [tree, setTree] = useState<PermissionNode[]>([]);
  const [selected, setSelected] = useState<RoleRecord | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set([
      "menu-event",
      "menu-asset",
      "menu-knowledge",
      "menu-interact",
      "menu-system",
    ]),
  );
  const [editing, setEditing] = useState<RoleRecord | null>(null);
  const reload = async () => {
    const [roleItems, permissionTree] = await Promise.all([
      adminApi.listRoles(),
      adminApi.listPermissionTree(),
    ]);
    setRoles(roleItems);
    setTree(permissionTree);
    setSelected((current) =>
      current
        ? (roleItems.find((role) => role.id === current.id) ?? roleItems[0])
        : roleItems[0],
    );
  };
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (selected) setChecked(new Set(selected.permissionIds));
  }, [selected]);
  const toggle = (node: PermissionNode) =>
    setChecked((current) => {
      const next = new Set(current);
      const codes = flat([node]).map((item) => item.code);
      if (next.has(node.code)) codes.forEach((code) => next.delete(code));
      else codes.forEach((code) => next.add(code));
      return next;
    });
  const savePermissions = async () => {
    if (!selected) return;
    const saved = await adminApi.saveRole({
      ...selected,
      permissionIds: [...checked],
    });
    setRoles((items) =>
      items.map((item) => (item.id === saved.id ? saved : item)),
    );
    setSelected(saved);
  };
  const saveRole = async () => {
    if (!editing) return;
    const saved = await adminApi.saveRole(editing);
    setRoles((items) => [
      saved,
      ...items.filter((item) => item.id !== saved.id),
    ]);
    setSelected(saved);
    setEditing(null);
  };
  return (
    <div className="p-6 xl:p-8">
      <Header
        eyebrow="系统管理"
        title="角色管理"
        description="通过角色集中配置数据范围和菜单权限。"
        action={
          <Button
            onClick={() =>
              setEditing({
                id: `role-${Date.now()}`,
                code: "custom_role",
                name: "",
                dataScope: "自定义",
                level: 4,
                description: "",
                permissionIds: [],
                createdAt: new Date().toISOString().slice(0, 10),
              })
            }
            disabled={!canWrite}
          >
            + 新增角色
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-900">
            角色列表
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-left text-xs">
              <thead className="border-b border-slate-100 text-slate-400">
                <tr>
                  {["名称", "数据权限", "级别", "描述", "创建日期", "操作"].map(
                    (label) => (
                      <th key={label} className="px-4 py-4 font-semibold">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roles.map((role) => (
                  <tr
                    key={role.id}
                    className={selected?.id === role.id ? "bg-cyan-50/50" : ""}
                    onClick={() => setSelected(role)}
                  >
                    <td className="px-4 py-4 font-semibold text-slate-800">
                      {role.name}
                      <br />
                      <span className="font-mono text-[10px] text-cyan-700">
                        {role.code}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {role.dataScope}
                    </td>
                    <td className="px-4 py-4 text-slate-600">{role.level}</td>
                    <td className="px-4 py-4 text-slate-500">
                      {role.description || "-"}
                    </td>
                    <td className="px-4 py-4 text-slate-400">
                      {role.createdAt}
                    </td>
                    <td className="px-4 py-4">
                      <Button
                        variant="ghost"
                        disabled={!canWrite}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditing(role);
                        }}
                      >
                        编辑
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <p className="font-semibold text-slate-900">菜单分配</p>
              <p className="mt-1 text-xs text-slate-400">
                {selected?.name || "请选择角色"}
              </p>
            </div>
            <Button
              onClick={() => void savePermissions()}
              disabled={!canWrite || !selected}
            >
              ✓ 保存
            </Button>
          </div>
          <div className="p-5">
            {selected ? (
              <Tree
                nodes={tree}
                checked={checked}
                onToggle={toggle}
                expanded={expanded}
                onExpand={(id) =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    next.has(id) ? next.delete(id) : next.add(id);
                    return next;
                  })
                }
              />
            ) : (
              <p className="text-sm text-slate-400">暂无角色</p>
            )}
          </div>
        </Card>
      </div>
      {editing ? (
        <Modal
          title={editing.name ? "编辑角色" : "新增角色"}
          onClose={() => setEditing(null)}
          onSave={() => void saveRole()}
        >
          <div className="space-y-4">
            <Field
              label="角色名称"
              value={editing.name}
              onChange={(value) => setEditing({ ...editing, name: value })}
            />
            <Field
              label="权限编码"
              value={editing.code}
              onChange={(value) => setEditing({ ...editing, code: value })}
            />
            <Select
              label="数据权限"
              value={editing.dataScope}
              onChange={(value) =>
                setEditing({
                  ...editing,
                  dataScope: value as RoleRecord["dataScope"],
                })
              }
            >
              <option value="全部数据">全部数据</option>
              <option value="本部门">本部门</option>
              <option value="自定义">自定义</option>
              <option value="仅本人">仅本人</option>
            </Select>
            <Field
              label="描述"
              value={editing.description}
              onChange={(value) =>
                setEditing({ ...editing, description: value })
              }
              textarea
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function PermissionManagementPage({ canWrite }: SystemProps) {
  const [tree, setTree] = useState<PermissionNode[]>([]);
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PermissionNode | null>(null);
  const reload = () =>
    void adminApi.listPermissionTree().then((items) => {
      setTree(items);
      setExpanded(
        new Set(
          flat(items)
            .filter((item) => item.children?.length)
            .map((item) => item.id),
        ),
      );
    });
  useEffect(reload, []);
  const visible = flat(tree).filter(
    (item) =>
      (!type || item.type === type) &&
      (!keyword ||
        `${item.name} ${item.code} ${item.path}`
          .toLowerCase()
          .includes(keyword.toLowerCase())),
  );
  return (
    <div className="p-6 xl:p-8">
      <Header
        eyebrow="系统管理"
        title="权限管理"
        description="维护菜单、按钮和 API 权限节点，角色分配使用同一棵权限树。"
        action={
          <Button
            onClick={() =>
              setEditing({
                id: `permission-${Date.now()}`,
                parentId: null,
                name: "",
                code: "",
                type: "menu",
                path: "",
                apiPattern: "",
              })
            }
            disabled={!canWrite}
          >
            + 新增权限
          </Button>
        }
      />
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field
            label="搜索"
            value={keyword}
            onChange={setKeyword}
            placeholder="节点名称、权限编码、路径"
          />
          <Select label="类型" value={type} onChange={setType}>
            <option value="">全部类型</option>
            <option value="menu">菜单</option>
            <option value="button">按钮</option>
            <option value="api">API</option>
          </Select>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setKeyword("");
                setType("");
              }}
            >
              重置
            </Button>
          </div>
        </div>
      </Card>
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <span className="font-semibold text-slate-900">权限树</span>
          <span className="text-xs text-slate-400">
            匹配 {visible.length} 个节点
          </span>
        </div>
        <div className="p-5">
          <Tree
            nodes={tree}
            checked={new Set()}
            onToggle={(node) => setEditing(node)}
            expanded={expanded}
            onExpand={(id) =>
              setExpanded((current) => {
                const next = new Set(current);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })
            }
          />
        </div>
      </Card>
      {editing ? (
        <Modal
          title="权限节点"
          onClose={() => setEditing(null)}
          onSave={
            canWrite
              ? () =>
                  void adminApi.savePermissionNode(editing).then(() => {
                    setEditing(null);
                    reload();
                  })
              : undefined
          }
        >
          <div className="space-y-4">
            <Field
              label="节点名称"
              value={editing.name}
              onChange={(value) => setEditing({ ...editing, name: value })}
            />
            <Field
              label="权限编码"
              value={editing.code}
              onChange={(value) => setEditing({ ...editing, code: value })}
            />
            <Select
              label="类型"
              value={editing.type}
              onChange={(value) =>
                setEditing({
                  ...editing,
                  type: value as PermissionNode["type"],
                })
              }
            >
              <option value="menu">菜单</option>
              <option value="button">按钮</option>
              <option value="api">API</option>
            </Select>
            <Field
              label="路径"
              value={editing.path}
              onChange={(value) => setEditing({ ...editing, path: value })}
            />
            <Field
              label="API Pattern"
              value={editing.apiPattern}
              onChange={(value) =>
                setEditing({ ...editing, apiPattern: value })
              }
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function AuditLogPage({ canTrace, onNavigate }: SystemProps) {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [filters, setFilters] = useState({
    username: "",
    ip: "",
    keyword: "",
    from: "",
    to: "",
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const reload = () => void adminApi.listAuditLogs(filters).then(setItems);
  useEffect(reload, []);
  const pagination = usePagination(items);
  return (
    <div className="p-6 xl:p-8">
      <Header
        eyebrow="系统管理"
        title="审计日志 / Trace"
        description="查询全链路操作记录，展开后查看服务节点、Span 时间线和前后数据。"
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                void adminApi
                  .exportAuditLogs(filters)
                  .then((csv) => download(csv, "审计日志.csv"))
              }
            >
              ↓ 导出
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm("确认清空当前 Mock 审计日志？"))
                  void Promise.resolve();
              }}
            >
              清空
            </Button>
          </div>
        }
      />
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field
            label="用户名"
            value={filters.username}
            onChange={(value) => setFilters({ ...filters, username: value })}
          />
          <Field
            label="IP"
            value={filters.ip}
            onChange={(value) => setFilters({ ...filters, ip: value })}
          />
          <Field
            label="描述 / Trace ID"
            value={filters.keyword}
            onChange={(value) => setFilters({ ...filters, keyword: value })}
          />
          <div className="flex items-end">
            <Button onClick={reload}>搜索</Button>
          </div>
        </div>
      </Card>
      <Card className="mt-4 overflow-x-auto">
        <table className="min-w-[1080px] w-full text-left text-xs">
          <thead className="border-b border-slate-200 text-slate-400">
            <tr>
              {[
                "",
                "用户名",
                "IP",
                "IP 来源",
                "描述",
                "浏览器",
                "请求耗时",
                "创建日期",
              ].map((label, index) => (
                <th key={index} className="px-4 py-4 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagination.pageItems.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="px-4 py-4">
                  <button
                    type="button"
                    className="text-lg text-slate-400"
                    onClick={() =>
                      setExpanded(expanded === item.id ? null : item.id)
                    }
                  >
                    {expanded === item.id ? "⌄" : "›"}
                  </button>
                </td>
                <td className="px-4 py-4 font-semibold text-slate-800">
                  {item.username}
                </td>
                <td className="px-4 py-4 text-slate-500">{item.ip}</td>
                <td className="px-4 py-4 text-slate-500">{item.ipLocation}</td>
                <td className="px-4 py-4 text-slate-600">
                  {item.description}
                  <br />
                  <span className="font-mono text-[10px] text-cyan-700">
                    {item.traceId}
                  </span>
                </td>
                <td className="px-4 py-4 text-slate-500">{item.browser}</td>
                <td className="px-4 py-4">
                  <Badge tone="cyan">{item.durationMs}ms</Badge>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-slate-400">
                  {item.createdAt}
                </td>
              </tr>
            ))}
            {expanded ? (
              <tr>
                <td colSpan={8} className="bg-slate-50 px-6 py-5">
                  {canTrace ? (
                    <TraceDetail
                      item={items.find((item) => item.id === expanded)!}
                      onNavigate={onNavigate}
                    />
                  ) : (
                    <p className="text-xs text-slate-500">
                      当前角色没有 audit:trace 权限。
                    </p>
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <Pagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        total={items.length}
        onChange={pagination.setPage}
      />
    </div>
  );
}
function TraceDetail({
  item,
  onNavigate,
}: {
  item: AuditLog;
  onNavigate?: (path: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <p className="font-semibold text-slate-900">
          Trace 详情 · {item.traceId}
        </p>
        <div className="mt-3 grid gap-2 text-xs text-slate-600">
          <p>
            资源：{item.resource} · 操作：{item.action}
          </p>
          <p>
            请求参数：
            <code className="ml-1 rounded bg-white px-2 py-1">
              {JSON.stringify(item.after || {})}
            </code>
          </p>
          <p>
            返回状态：
            <Status value="ok" label="200 OK" />
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {item.spans.map((span) => (
          <div
            key={span.id}
            className="rounded-xl border border-slate-200 bg-white p-3 text-xs"
          >
            <div className="flex justify-between">
              <span className="font-semibold text-slate-700">
                {span.service} / {span.operation}
              </span>
              <Badge tone={span.status === "ok" ? "green" : "rose"}>
                {span.durationMs}ms
              </Badge>
            </div>
            <p className="mt-1 font-mono text-[10px] text-slate-400">
              {span.startAt} · {JSON.stringify(span.attributes)}
            </p>
          </div>
        ))}
      </div>
      {onNavigate ? (
        <button
          type="button"
          className="text-left text-xs text-cyan-700"
          onClick={() => onNavigate(`/system/audit?traceId=${item.traceId}`)}
        >
          复制并定位 Trace ID
        </button>
      ) : null}
    </div>
  );
}

function HistoryBars({ values, color }: { values: number[]; color: string }) {
  return (
    <div className="flex h-28 items-end gap-2 rounded-xl bg-slate-50 px-4 pb-3 pt-4">
      {values.map((value, index) => (
        <div key={index} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={`w-full rounded-t-md ${color}`}
            style={{ height: `${Math.max(4, value)}%` }}
            title={`${value}%`}
          />
          <span className="text-[10px] text-slate-400">{value}%</span>
        </div>
      ))}
    </div>
  );
}
export function OpsMonitoringPage({ canFailover }: SystemProps) {
  const [monitor, setMonitor] = useState<SystemMonitor | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [gateway, setGateway] = useState<GatewayPolicy | null>(null);
  const [savingGateway, setSavingGateway] = useState(false);
  const reload = async () => {
    const [snapshot, alertItems, gatewayPolicy] = await Promise.all([
      adminApi.getSystemMonitor(),
      adminApi.listAlerts(),
      adminApi.getGatewayPolicy(),
    ]);
    setMonitor(snapshot);
    setAlerts(alertItems);
    setGateway(gatewayPolicy);
  };
  useEffect(() => {
    void reload();
  }, []);
  const acknowledge = async (id: string) => {
    const saved = await adminApi.acknowledgeAlert(id, "当前用户");
    setAlerts((items) =>
      items.map((item) => (item.id === saved.id ? saved : item)),
    );
  };
  const saveGateway = async () => {
    if (!gateway || !canFailover) return;
    setSavingGateway(true);
    try {
      setGateway(await adminApi.saveGatewayPolicy(gateway));
    } finally {
      setSavingGateway(false);
    }
  };
  if (!monitor)
    return (
      <div className="p-6 xl:p-8">
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          正在读取监控快照…
        </p>
      </div>
    );
  const metrics = [
    ["CPU 使用率", monitor.cpuPercent, "cyan"],
    ["内存使用率", monitor.memoryPercent, "cyan"],
    ["交换区使用率", monitor.swapPercent, "slate"],
    ["磁盘使用率", monitor.diskPercent, "cyan"],
  ] as const;
  return (
    <div className="p-6 xl:p-8">
      <Header
        eyebrow="系统管理"
        title="监控告警"
        description="展示真实服务健康、终端状态、告警以及网关白名单和降级策略。"
        action={<Button onClick={() => void reload()}>↻ 刷新快照</Button>}
      />
      <Card className="px-5 py-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-500">
          <span>⚙ 系统：{monitor.os}</span>
          <span>IP：{monitor.ip}</span>
          <span>项目已不间断运行：{monitor.uptime}</span>
          <span className="ml-auto text-slate-400">
            刷新于 {monitor.refreshedAt}
          </span>
        </div>
      </Card>
      <Card className="mt-3 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-900">
          状态
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(([label, value, color]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <div className="mt-3 flex items-end justify-between">
                <span className="text-3xl font-semibold tracking-tight text-slate-900">
                  {value.toFixed(2)}%
                </span>
                <div
                  className={`h-2 w-20 rounded-full bg-${color === "cyan" ? "cyan" : "slate"}-500`}
                />
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-cyan-500"
                  style={{ width: `${Math.min(100, value)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">CPU 使用率监控</h2>
          <div className="mt-4">
            <HistoryBars values={monitor.cpuHistory} color="bg-cyan-400" />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">内存使用率监控</h2>
          <div className="mt-4">
            <HistoryBars values={monitor.memoryHistory} color="bg-cyan-400" />
          </div>
        </Card>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">服务健康</h2>
          <div className="mt-4 divide-y divide-slate-100">
            {monitor.services.map((service) => (
              <div
                key={service.id}
                className="flex items-center gap-3 py-3 text-xs"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="w-28 font-semibold text-slate-700">
                  {service.name}
                </span>
                <Status
                  value={service.status}
                  label={
                    service.status === "ok"
                      ? "正常"
                      : service.status === "warn"
                        ? "告警"
                        : "异常"
                  }
                />
                <span className="ml-auto text-slate-400">
                  {service.latencyMs}ms · {service.checkedAt}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">终端状态</h2>
          <div className="mt-4 divide-y divide-slate-100">
            {monitor.terminals.map((terminal) => (
              <div key={terminal.id} className="py-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-700">
                    {terminal.name}
                  </span>
                  <Status
                    value={terminal.status}
                    label={
                      terminal.status === "online"
                        ? "在线"
                        : terminal.status === "offline"
                          ? "离线"
                          : "禁用"
                    }
                  />
                  <span className="ml-auto text-slate-400">
                    CPU {terminal.cpuPercent}% · 内存 {terminal.memoryPercent}%
                  </span>
                </div>
                <p className="mt-1 text-slate-400">
                  {terminal.location} · 最近心跳 {terminal.lastHeartbeatAt}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {gateway ? (
        <Card className="mt-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">网关与降级策略</h2>
              <p className="mt-1 text-xs text-slate-400">
                管理访问白名单、限流、超时以及后端异常时的终端降级行为。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Status value={gateway.enabled ? "active" : "inactive"} label={gateway.enabled ? "已启用" : "已停用"} />
              <Button disabled={!canFailover || savingGateway} onClick={() => void saveGateway()}>
                {savingGateway ? "保存中…" : "保存策略"}
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="策略名称" value={gateway.name} onChange={(name) => setGateway({ ...gateway, name })} />
            <Field label="每分钟限流" value={String(gateway.rateLimitPerMinute)} onChange={(value) => setGateway({ ...gateway, rateLimitPerMinute: Math.max(1, Number(value) || 1) })} />
            <Field label="请求超时（毫秒）" value={String(gateway.timeoutMs)} onChange={(value) => setGateway({ ...gateway, timeoutMs: Math.max(1000, Number(value) || 1000) })} />
            <Select label="降级模式" value={gateway.fallbackMode} onChange={(fallbackMode) => setGateway({ ...gateway, fallbackMode: fallbackMode as GatewayPolicy["fallbackMode"] })}>
              <option value="text">文字播报</option>
              <option value="cached">缓存内容</option>
              <option value="offline">离线模式</option>
            </Select>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
            <Field label="IP 白名单（逗号分隔）" value={gateway.whitelist.join(", ")} onChange={(value) => setGateway({ ...gateway, whitelist: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
            <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={gateway.enabled} disabled={!canFailover} onChange={(event) => setGateway({ ...gateway, enabled: event.target.checked })} />
              启用网关策略
            </label>
          </div>
        </Card>
      ) : null}
      <Card className="mt-3 overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-900">
          告警列表
        </div>
        <table className="min-w-[900px] w-full text-left text-xs">
          <thead className="border-b border-slate-100 text-slate-400">
            <tr>
              {[
                "告警类型",
                "严重级别",
                "对象",
                "内容",
                "状态",
                "发生时间",
                "确认人",
                "操作",
              ].map((label) => (
                <th key={label} className="px-5 py-4 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td className="px-5 py-4 text-slate-700">{alert.type}</td>
                <td className="px-5 py-4">
                  <Status value={alert.severity} label={alert.severity} />
                </td>
                <td className="px-5 py-4 text-slate-600">{alert.target}</td>
                <td className="px-5 py-4 text-slate-500">{alert.content}</td>
                <td className="px-5 py-4">
                  <Status
                    value={alert.status}
                    label={alert.status === "active" ? "待确认" : "已确认"}
                  />
                </td>
                <td className="px-5 py-4 text-slate-400">{alert.occurredAt}</td>
                <td className="px-5 py-4 text-slate-500">
                  {alert.acknowledgedBy || "-"}
                </td>
                <td className="px-5 py-4">
                  <Button
                    variant="ghost"
                    disabled={!canFailover || alert.status !== "active"}
                    onClick={() => {
                      if (window.confirm("确认该告警并记录审计？"))
                        void acknowledge(alert.id);
                    }}
                  >
                    确认
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
