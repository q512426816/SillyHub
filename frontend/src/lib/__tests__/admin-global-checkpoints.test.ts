/**
 * task-02 checkpoint: 平台管理员全局 daemon/workspace 管理前端契约与交互验收点。
 *
 * Change 2026-06-25-admin-global-daemon-workspace-management — frontend side.
 * Covers FR-03/FR-04/FR-05/FR-06, D-004@v1/D-006@v1.
 *
 * 这些 checkpoint 用 it.todo 声明验收点：相关 client 方法
 * (listDaemonRuntimesPage / updateDaemonRuntime) 与页面 DOM 由 task-06/07/08
 * 落地，task-10 收口时把 .todo 去掉、补 mock + 断言转为可执行测试。
 *
 * 故意不静态 import 尚未导出的 client 方法 —— 避免本文件在 task-06 前
 * 因 import error 导致 collection 失败（违反 task-02 AC）。
 */

import { describe, it } from "vitest";

// ── daemon client 契约（task-06 实现）──────────────────────────────────────

describe("listDaemonRuntimesPage (task-06)", () => {
  it.todo("请求 /api/daemon/runtimes/page 并序列化 q/type/status/user_id/limit/offset，offset=0 不丢");
  it.todo("无参调用不附加空 query，返回 {items,total,limit,offset}");
  it.todo("items[0].owner.{user_id,email,display_name} 与 display_alias 可读取");
  it.todo("非 2xx 响应 reject ApiError");
});

describe("updateDaemonRuntime (task-06)", () => {
  it.todo("PATCH /api/daemon/runtimes/{encoded id}，body 只含 display_alias");
  it.todo("display_alias:null 清空别名；字段省略不变");
  it.todo("runtimeId 含空格/斜杠经 encodeURIComponent 正确编码");
});

describe("listDaemonRuntimes 数组契约 (FR-06)", () => {
  it.todo("仍请求 /api/daemon/runtimes 且返回 DaemonRuntimeRead[]，未被分页对象替代");
});

// ── workspace client 契约（task-06 实现）────────────────────────────────────

describe("listWorkspaces(params) (task-06)", () => {
  it.todo("无参调用仍请求 /api/workspaces 并返回 {items,total}");
  it.todo("传参时通过 apiFetch query 发送 q/type/status/user_id/limit/offset/include_deleted");
  it.todo("offset=0 与 limit 保留，空串/undefined 省略");
});

describe("updateWorkspace display_alias (task-06)", () => {
  it.todo("PATCH /api/workspaces/{id}，body 含 display_alias 字符串或 null");
  it.todo("Workspace 类型含 display_alias:string|null 与 owner:OwnerRead|null");
});

// ── /runtimes 页面交互（task-07 实现）──────────────────────────────────────

describe("RuntimesPage 全局筛选分页 (task-07)", () => {
  it.todo("平台管理员看到人员搜索，选择人员后以 user_id 重拉 listDaemonRuntimesPage");
  it.todo("普通账号不显示人员搜索，也不调用 listUsers");
  it.todo("搜索词/类型/状态变化重置 offset=0 并调用 listDaemonRuntimesPage");
  it.todo("下一页按钮按 PAGE_SIZE 推进 offset 并刷新卡片；末页禁用");
  it.todo("runtime 卡片优先显示 display_alias，空别名回退 name/provider，并展示 owner");
  it.todo("别名编辑保存/清空调 updateDaemonRuntime 并刷新标题");
  it.todo("usage 统计、session 弹窗、?session= 恢复行为不回归");
});

// ── /workspaces 页面与 WorkspaceCard 交互（task-08 实现）─────────────────────

describe("WorkspacesPage 全局筛选分页 (task-08)", () => {
  it.todo("平台管理员看到人员搜索，选择人员后以 user_id 重拉 listWorkspaces");
  it.todo("普通账号不显示人员搜索，也不调用 listUsers");
  it.todo("搜索词/类型/状态变化重置 offset=0 并调用 listWorkspaces");
  it.todo("下一页按钮按 PAGE_SIZE 推进 offset；末页禁用");
  it.todo("响应保持 {items,total}，不新增顶层 limit/offset");
});

describe("WorkspaceCard 别名/owner (task-08)", () => {
  it.todo("卡片标题优先 display_alias，副标题保留 slug，有别名补显原 name");
  it.todo("负责人显示 owner.display_name ?? owner.email ?? 未记录；owner=null 不崩");
  it.todo("别名编辑保存调 updateWorkspace({display_alias}) 并 onChanged 刷新");
  it.todo("display_alias 为 null/空时标题回退 name");
});
