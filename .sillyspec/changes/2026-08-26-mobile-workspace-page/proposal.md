---
author: qinyi
created_at: 2026-08-27 00:19:07
---
# 提案书（Proposal）

## 动机

移动端骨架（/m/ 路由段 + UA 分流 + mobile 组件库）已建成，但工作区详情及之后的功能
在手机端被门禁挡住（`m/workspaces/page.tsx:199` 点卡片提示"请在电脑端打开"）。用户
核心诉求：把工作区最重要的两个操作面——**变更中心**（查看/审批变更）与**会话**
（与智能体对话）——移植到手机，随时随地掌控变更进度、审批卡点、续聊会话。

## 关键问题

1. **门禁一刀切**：手机上所有工作区功能不可用，变更到了"待提案审核/待归档确认"
   这类人工卡点时必须回到电脑才能推进，打断工作流。
2. **桌面页不适合手机**：直接用手机访问桌面 URL（关 UA 分流）会得到 320px 列表 +
   横向滚动的桌面布局，点击目标小、双栏挤压，不可用；需要一套真正的移动渲染层。
3. **已有可复用资产未上移动**：变更中心数据层（lib/changes.ts + react-query 智能轮询）、
   会话内核 SessionPanel（一内核·N 宿主已验证）都是现成的，缺的只是移动宿主与
   移动渲染层。

## 变更范围

- 新增 `/m/workspaces/[id]/**` 移动页面群：工作区主页（redirect）、变更列表、变更
  详情（钻取）、会话列表、会话对话（SessionPanel 第四宿主）、两条桌面深链兜底
  redirect。
- 新增移动组件：MobileWorkspaceHeader（段控双 Tab）、变更卡片、详情区块组、会话
  分组列表。
- 最小改动既有文件 5 处（均为零渲染变化的纯增量）：m/layout 钻取分支、m/workspaces
  解除门禁、changes/page.tsx 导出常量、PreSessionPicker 与 SessionPanel 各加可选
  variant prop（默认值保持桌面行为）。
- 数据层 100% 复用（lib/changes / lib/daemon / lib/quicklog），零后端改动。

## 不在范围内（Non-Goals，显式清单）

- 不做任务看板与任务详情/执行页移动端（D-002 核心版裁剪，详情页放桌面引导条）
- 不改后端（零 API/DTO/schema/api-types 变更）
- 不改桌面端功能与布局（`(dashboard)/**` 渲染零改动）
- 不做平板适配（平板走桌面，既有决策不变）
- 不做工作区其它 16 个子 tab（文件/知识库/组件/explorer 等）的移动端
- 不做 PWA 离线/推送/安装能力
- 不改 middleware 分流策略与底部 5 Tab 结构

## 成功标准（可验证）

1. 手机 UA 访问 `/workspaces/[id]`、`/workspaces/[id]/changes`、`/workspaces/[id]/
   changes/[cid]`、`/workspaces/[id]/sessions` 均获得移动页面（非 404、非"请在电脑
   端打开"）。
2. 变更中心：三 Tab 列表 + 搜索 + 筛选可用；详情可看阶段/时间线/文档/日志；审批
   通过/驳回真实生效（submitStageReview）；文档可全屏预览。
3. 会话：列表分组正确；对话页 SessionPanel 全功能可用（发消息/SSE 流式/中断/
   结束/消息队列/子代理目录）；新建会话两步浮层可用。
4. 桌面零回归：`(dashboard)/**` 既有测试全绿；SessionPanel/PreSessionPicker 不传
   variant 时行为与改动前一致。
5. 深链兜底：手机访问 `/workspaces/[id]/changes/[cid]/sessions` 重定向到移动会话
   列表而非 404。
6. 移动规范达标：触摸热区 ≥44px、正文 ≥14px、max-w-480px、双主题 token 无写死
   色值。
