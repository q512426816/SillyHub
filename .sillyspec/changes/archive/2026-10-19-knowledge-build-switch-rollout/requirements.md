---
author: flow-machine-draft
created_at: 2026-10-19T06:59:20.582Z
---
# 需求规格（Requirements）— 2026-10-19-knowledge-build-switch-rollout

## 功能需求

### FR-01: deploy/.env 追加 KNOWLEDGE_SEARCH_SERVER_BUILD=0（gitignore 不入库），backend 镜像重建+容器 force-recreate 后容器内 settings.knowledge_search_server_build 实测为 False 且新代码在场

- 目标部署（本地 docker 平台）的 `deploy/.env` 必须追加 `KNOWLEDGE_SEARCH_SERVER_BUILD=0`（该文件 gitignore，完整值只落本机）；backend 镜像必须重建并以 `--force-recreate` 替换容器；替换后容器内必须可验证：`config.py` 命中 `knowledge_search_server_build` 且 `get_settings().knowledge_search_server_build` 实测为 `False`。若 postgres 运行实例与 compose 声明镜像（pgvector/pgvector:pg16）存在漂移，必须先完成镜像切换再启动新 backend（否则 pgvector 迁移 fail-closed crash-loop）。

#### 场景：主路径

- Given：运行中 backend 镜像早于开关代码、postgres 实例为 postgres:16-alpine（compose 已声明 pgvector 镜像）。
- When：追加 env → postgres 切 pgvector 镜像（数据卷沿用）→ backend `up --build --force-recreate`。
- Then：全栈 healthy；容器内开关值 False；新代码在场（grep 命中）。

### FR-02: 未建索引工作区首搜端到端实测：秒级返回 + reason=index_not_built + knowledge_search_state/chunks 零新增（证据落盘）

- 端到端实测必须覆盖至少两个未建索引工作区（其 knowledge_search_state 无行）：`POST /api/workspaces/{id}/knowledge/search` 必须返回 HTTP 200 + `model_ready=false` + `reason="index_not_built"`；查询前后 `knowledge_search_state` 与 `knowledge_search_chunks` 行数必须零新增（零建库零嵌入）；响应耗时必须不触发代理超时（对照原失败模式=全量嵌入 OOM/504 死循环）。实测证据（HTTP 码/耗时/reason/计数）必须落盘留档。

#### 场景：主路径

- Given：开关关闭、两个未建索引工作区（multi-agent-platform / sillyspec）、管理员 token。
- When：依次发起首搜请求并复核表计数。
- Then：200 + reason=index_not_built + 0|0 零新增；耗时边界如实记录（Windows Docker VM I/O 抖动）。

### FR-03: 发布记录按 deploy skill 规范写入 docs/releases/；known-issues 地雷条目状态更新（本地已配实证、生产剩 env 一动作）

- 必须按 deploy skill 规范写入发布记录到 `docs/releases/YYYY-MM-DD-NNN-<HEAD短SHA>.md`（seq 取号器、commit_from=上一记录 commit_to、commit_to=HEAD、commits 列表、📝 部署验证小节）；`deploy/.env.example` 必须文档化该开关；`known-issues.md` 地雷条目状态行必须更新为「本地已配实证、生产剩 env 一动作」。

#### 场景：主路径

- Given：FR-01/FR-02 完成且有证据。
- When：写发布记录 + 环境示例文档化 + 知识条目更新。
- Then：记录可通过平台 deploy-records 解析契约（frontmatter 字段齐全）；条目状态与事实一致（保持 🟡 直至生产落地）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：部署动作（env 配置 + 镜像重建）无单元测试面；验收判据=容器内 settings 实测 False + 代码 grep 命中 + 全栈 healthy
FR-02: 不适用：端到端部署实测无 pytest 面；验收判据=HTTP 200 + reason=index_not_built + state/chunks 零新增（证据落盘 .sillyspec/.runtime/logs 与 temp）
FR-03: 不适用：发布记录与知识条目为文档面；验收靠 deploy skill 契约字段核对与正文对照
