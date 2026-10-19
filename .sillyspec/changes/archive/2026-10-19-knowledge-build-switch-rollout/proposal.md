---
author: flow-machine-draft
created_at: 2026-10-19T06:59:20.582Z
---
# 提案书（Proposal）— 2026-10-19-knowledge-build-switch-rollout

## 动机

任务原话转写：禁建库开关本地部署落地与首搜实测
上变更交付的 KNOWLEDGE_SEARCH_SERVER_BUILD 开关需在真实部署环境落地并端到端验证：本地 docker 平台（backend 容器 mem_limit 1100m，与生产同款 OOM 面）配 =0、重建镜像，实测未建索引工作区首搜走词面降级不触发建库。

成功标准：
- deploy/.env 追加 KNOWLEDGE_SEARCH_SERVER_BUILD=0（gitignore 不入库），backend 镜像重建+容器 force-recreate 后容器内 settings.knowledge_search_server_build 实测为 False 且新代码在场
- 未建索引工作区首搜端到端实测：秒级返回 + reason=index_not_built + knowledge_search_state/chunks 零新增（证据落盘）
- 发布记录按 deploy skill 规范写入 docs/releases/；known-issues 地雷条目状态更新（本地已配实证、生产剩 env 一动作）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. deploy/.env 追加 KNOWLEDGE_SEARCH_SERVER_BUILD=0（gitignore 不入库），backend 镜像重建+容器 force-recreate 后容器内 settings.knowledge_search_server_build 实测为 False 且新代码在场
2. 未建索引工作区首搜端到端实测：秒级返回 + reason=index_not_built + knowledge_search_state/chunks 零新增（证据落盘）
3. 发布记录按 deploy skill 规范写入 docs/releases/；known-issues 地雷条目状态更新（本地已配实证、生产剩 env 一动作）

## 成功标准（可验证）

1. deploy/.env 追加 KNOWLEDGE_SEARCH_SERVER_BUILD=0（gitignore 不入库），backend 镜像重建+容器 force-recreate 后容器内 settings.knowledge_search_server_build 实测为 False 且新代码在场
2. 未建索引工作区首搜端到端实测：秒级返回 + reason=index_not_built + knowledge_search_state/chunks 零新增（证据落盘）
3. 发布记录按 deploy skill 规范写入 docs/releases/；known-issues 地雷条目状态更新（本地已配实证、生产剩 env 一动作）
