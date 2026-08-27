---
author: qinyi
created_at: 2026-08-28 03:12:40
---
# 提案书（Proposal）

## 动机

会话已支持关联 SillySpec 变更与快速修复并自动注入上下文（2026-08-25-session-spec-binding 基座），但 PPM 模块（已上线）的「个人进行中计划任务」（PlanTask）与「问题清单」（PpmProblemList）与会话零关联：用户在会话里讨论 PPM 任务时 agent 拿不到任务描述、状态、附件，需要跨系统复制粘贴。本变更把绑定基座扩展到 PPM 任务/问题，并顺手修复「发起团队」预选缺失 bug。

## 关键问题

1. **上下文断裂**：PPM 任务的文字字段（标题/描述/状态/项目/责任人/周期）与附件（file_urls 存平台文件中心 file_id）无法随会话首句注入，agent 每次都要用户手动贴信息。
2. **无反向入口**：任务/问题详情处看不到「有哪些会话在讨论我」，也无法一键发起绑定会话；会话输入框 @联想只覆盖变更/快速修复。
3. **「发起团队」bug**：PPM 项目页点击「发起团队」后仅注入页面上下文——派团队弹层不自动打开、项目与关联工作区不预选、objective 为空（team-trigger-popover.tsx 无 defaultProjectId prop、projectId 初始空串、宿主 workspaceId 恒 null），预选链路在 UI 层完全未实现。

## 变更范围

- 后端：新表 `ppm_item_session_links`（单表 kind 区分 plan_task/problem，D-005）+ 绑定 helper + `GET /api/ppm/item-sessions` 读取端点；`SessionCreateRequest`/`SessionInjectRequest` 新增 ppm 绑定字段；`build_ppm_item_context_preamble` 前导（文字全字段）+ PPM 附件物化 SessionAttachment 真注入（D-006，无权/超限/非 Claude 降级文字清单，D-007）；会话列表筛选 ppm 维度。
- 前端：任务/问题侧「发起会话」入口（store pendingPpmItem 挂起位通道 + 工作区自动选第一个，D-004@v2）与「关联会话」卡片；@联想新增 PPM 任务/问题分组（默认进行中可切全部，D-002）；会话列表「关联」筛选 ppm 选项；「发起团队」自动打开弹层 + 项目/工作区预选 + objective 预填。
- sillyhub-daemon：零改动（附件走既有 SessionInjectAttachment 协议）。

## 不在范围内（显式清单）

- 不重构现有 change/quicklog 绑定链路（方案 C 已否决）
- 不改变 PPM 任务/问题状态机与既有 API 行为
- 不做移动端（app/m/）PPM 任务会话入口与 @联想适配
- 不做任务/问题状态变化对会话的联动通知

## 成功标准（可验证）

- 不带 ppm 参数的创建/追问/列表请求行为与现状完全一致（零回归）
- 从任务/问题发起的会话首条 user 消息含【PPM 任务上下文】/【问题上下文】前导与任务附件（Claude 引擎真附件；其余降级文字清单）
- 任务/问题详情能看到关联会话列表并深链打开；会话内 @联想可选 PPM 任务/问题并绑定
- PPM 项目页「发起团队」→ 预会话自动弹开派团队弹层，项目与第一个关联工作区已预选
- `pnpm gen:types` 再生成 api-types.ts 且与后端 schema 同步提交
