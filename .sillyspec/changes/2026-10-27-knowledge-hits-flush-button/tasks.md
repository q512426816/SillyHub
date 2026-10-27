---
author: flow-machine-draft
created_at: 2026-10-27T08:16:17.881Z
---
# 任务注册表（Tasks）— 2026-10-27-knowledge-hits-flush-button

- [x] task-01: daemon hits 读取路径优先 .runtime/state/knowledge-hits.jsonl、旧路径回退，周期器对新路径恢复增量上行（本仓实测积压行补进 knowledge_hits 表）
- [x] task-02: daemon 注册 sillyspec_hits_flush RPC：收到指令即对该工作区强制执行一次上行（绕过 mtime 短路）并回执
- [ ] task-03: backend 新端点照 _sync_change_via_daemon 降级铁律：daemon 在线触发 RPC 返回结构化回执（triggered/ok/reason），未绑定/离线/超时均不抛
- [ ] task-04: 变更详情页新增「同步变更」按钮：点击调新端点、按回执提示成败原因、成功后刷新沉淀资产卡
- [ ] task-05: backend schema 有改动时同变更内跑前端与 daemon 的 pnpm gen:types 并提交
- [ ] task-06: 相关单测通过（backend 端点降级路、daemon 路径回退与 flush、frontend 按钮交互）
