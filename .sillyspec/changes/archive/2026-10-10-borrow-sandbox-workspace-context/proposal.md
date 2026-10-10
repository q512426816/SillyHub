---
author: qinyi
created_at: 2026-10-10T15:45:00+08:00
---
# 提案书（Proposal）— 2026-10-10-borrow-sandbox-workspace-context

## 动机

workspace 级 daemon 分享的借用会话被安全设计隔离在空沙箱目录（写守卫只准写
沙箱内），但 lease 不携带任何工作区信息，agent 完全不知道自己服务于哪个工作区、
代码在哪——与 borrow-for-business「借算力读源码出业务方案」的原始意图相悖
（实测会话 012cdcef：沙箱仅 .claude/ 空目录）。

## 关键问题

- 借用 agent 对工作区零感知：不知道工作区名称/repo/技术栈，答非所问。
- 真实代码路径不透明：agent 明明可以读（写守卫只拦写），却因不知道路径而
  「弱读隔离」，用户以为功能坏了。
- lease metadata 已有 workspace_id 但只用于 file 回收/审计，未形成 agent 可
  消费的上下文。

## 变更范围

- backend：placement.py 三处借用标记点查询 Workspace 行写
  `borrow_workspace_context` 单键进 lease metadata；context.py
  build_claim_payload interactive 分支白名单透传。
- daemon：LeaseCtx 增可选字段 + 归一化双读；marker 分支 prepareWorkspace
  成功后渲染 AGENTS.md 写入沙箱根（fail-open）。
- 测试：backend 三标记点/透传断言 + daemon 渲染纯函数与集成断言。

## 不在范围内（显式清单）

- 不做：借用会话写权限任何放开（写守卫 enforcement 零改动）。
- 不做：repo clone 进沙箱。
- 不做：平台共享智能体通道改动。
- 不做：前端 / 对外 API / 表结构改动。
- 不做：非借用 lease 的任何行为变化。

## 成功标准（可验证）

- 借用会话认领后，沙箱根存在 AGENTS.md，内容含工作区名称/slug/repo/分支/
  技术栈与真实 root_path，且声明「可读禁写」。
- 借用 agent 询问「这是什么工作区/代码在哪」时能基于 AGENTS.md 直接作答。
- 写守卫行为与本变更前逐字节一致（沙箱外写仍被拒）。
- 旧 backend ↔ 新 daemon、新 backend ↔ 旧 daemon 混布行为不劣化（缺键=
  现状）。
- 非借用 lease 的 metadata / claim payload 不出现新键。
