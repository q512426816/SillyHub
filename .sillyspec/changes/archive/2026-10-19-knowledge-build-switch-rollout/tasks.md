---
author: flow-machine-draft
created_at: 2026-10-19T06:59:20.582Z
---
# 任务注册表（Tasks）— 2026-10-19-knowledge-build-switch-rollout

- [x] task-01: deploy/.env 追加 KNOWLEDGE_SEARCH_SERVER_BUILD=0（gitignore 不入库），backend 镜像重建+容器 force-recreate 后容器内 settings.knowledge_search_server_build 实测为 False 且新代码在场
- [x] task-02: 未建索引工作区首搜端到端实测：秒级返回 + reason=index_not_built + knowledge_search_state/chunks 零新增（证据落盘）
- [x] task-03: 发布记录按 deploy skill 规范写入 docs/releases/；known-issues 地雷条目状态更新（本地已配实证、生产剩 env 一动作）
