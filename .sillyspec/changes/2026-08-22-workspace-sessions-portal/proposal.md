---
author: qinyi
created_at: 2026-08-22 16:56:30
---
# 提案书（Proposal）

## 动机

基元统一（2026-08-22-session-panel-unify）后用户仍看到不一致：/workspaces/[id]/sessions
的会话区与 /sessions 长相/交互完全不同——两页虽渲染同一 SessionPanel，但模式不同
（page vs dialog），布局与功能集是两套。用户明确要求：以 /sessions 为准、统一一个组件。

## 关键问题

1. 工作区会话页渲染 dialog 模式面板（引擎选择器/新建结束按钮/attach 轮询），
   与 /sessions 的 page 模式（标题/状态/配置条/子代理目录/附件/重开）是两种体验；
2. 变更详情侧边卡的会话区是同款 dialog 模式的第二个消费面；
3. 两处自带的「reopen 再 attach」「?session= 深链」等装配逻辑与 /sessions 页
   各自为政，三处维护三套。

## 变更范围

- 抽 /sessions 页外壳为共享门户组件 SessionsPortal（scope=global/workspace/change
  判别联合），三个入口渲染同一组件：/sessions、/workspaces/[id]/sessions、
  新路由 /workspaces/[id]/changes/[cid]/sessions；
- SessionListPanel 加 scope（切列表数据源 + 仅本人过滤 + 隐藏服务端筛选保留本地
  搜索 + 瘦字段降级矩阵）；NewSessionForm 加锁定绑定（workspace/change）；
- 门户统一 ?session= 深链（迁移旧能力，全局入口同样受益）；
- 变更详情侧卡变入口（最近 3 条仅本人 + 打开工作台按钮）；
- 退役 workspace-session-section 与 change-session-section 及其测试（语义迁移
  清单见 design §4.E；ended 会话恢复从自动 reopen 改为 page 模式手动重开——
  以 /sessions 行为为准的有意变更）。

## 不在范围内（显式清单）

- 不动 /runtimes 弹窗（dialog 模式唯一保留消费面，弹窗场景合理）
- 不动 SessionPanel 组件本体（两模式实现不变，仅消费面重组）
- 不动团队功能（team-session-unify 刚合入的按钮/任务块）
- 后端零改动（三个列表端点均已存在）
- 不做 scope 级服务端筛选语义扩展

## 成功标准（可验证）

- 三个入口 grep 渲染点均为同一 SessionsPortal 组件；浏览器对照三入口布局/
  交互一致（仅列表范围/绑定/标题后缀不同）；
- 旧能力无回退：仅本人过滤、?session= 深链、创建绑定（workspace/change）、
  ended 会话恢复（page 模式 reopen）全部有测试覆盖；
- 全量 vitest/tsc/lint 零失败；3001 重建部署后三入口浏览器实证。
