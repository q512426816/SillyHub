---
author: flow-machine-draft
created_at: 2026-10-27T08:16:17.881Z
---
# 提案书（Proposal）— 2026-10-27-knowledge-hits-flush-button

## 动机

任务原话转写：知识遥测断流根因：sillyspec CLI 2026-10-18 把遥测文件迁至 .runtime/state/knowledge-hits.jsonl，daemon 仍读旧路径 .runtime/knowledge-hits.jsonl 致 10-17 后全平台零上行、变更详情「知识触达」恒空。用户拍板方案：CLI 直报为主（另仓变更）+ 平台按钮经 daemon 按需补数。本变更落平台仓三件：daemon 读新路径并注册 flush RPC、backend 触发端点、变更详情页同步按钮。

成功标准：
- daemon hits 读取路径优先 .runtime/state/knowledge-hits.jsonl、旧路径回退，周期器对新路径恢复增量上行（本仓实测积压行补进 knowledge_hits 表）
- daemon 注册 sillyspec_hits_flush RPC：收到指令即对该工作区强制执行一次上行（绕过 mtime 短路）并回执
- backend 新端点照 _sync_change_via_daemon 降级铁律：daemon 在线触发 RPC 返回结构化回执（triggered/ok/reason），未绑定/离线/超时均不抛
- 变更详情页新增「同步变更」按钮：点击调新端点、按回执提示成败原因、成功后刷新沉淀资产卡
- backend schema 有改动时同变更内跑前端与 daemon 的 pnpm gen:types 并提交
- 相关单测通过（backend 端点降级路、daemon 路径回退与 flush、frontend 按钮交互）

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. daemon hits 读取路径优先 .runtime/state/knowledge-hits.jsonl、旧路径回退，周期器对新路径恢复增量上行（本仓实测积压行补进 knowledge_hits 表）
2. daemon 注册 sillyspec_hits_flush RPC：收到指令即对该工作区强制执行一次上行（绕过 mtime 短路）并回执
3. backend 新端点照 _sync_change_via_daemon 降级铁律：daemon 在线触发 RPC 返回结构化回执（triggered/ok/reason），未绑定/离线/超时均不抛
4. 变更详情页新增「同步变更」按钮：点击调新端点、按回执提示成败原因、成功后刷新沉淀资产卡
5. backend schema 有改动时同变更内跑前端与 daemon 的 pnpm gen:types 并提交
6. 相关单测通过（backend 端点降级路、daemon 路径回退与 flush、frontend 按钮交互）

## 成功标准（可验证）

1. daemon hits 读取路径优先 .runtime/state/knowledge-hits.jsonl、旧路径回退，周期器对新路径恢复增量上行（本仓实测积压行补进 knowledge_hits 表）
2. daemon 注册 sillyspec_hits_flush RPC：收到指令即对该工作区强制执行一次上行（绕过 mtime 短路）并回执
3. backend 新端点照 _sync_change_via_daemon 降级铁律：daemon 在线触发 RPC 返回结构化回执（triggered/ok/reason），未绑定/离线/超时均不抛
4. 变更详情页新增「同步变更」按钮：点击调新端点、按回执提示成败原因、成功后刷新沉淀资产卡
5. backend schema 有改动时同变更内跑前端与 daemon 的 pnpm gen:types 并提交
6. 相关单测通过（backend 端点降级路、daemon 路径回退与 flush、frontend 按钮交互）
