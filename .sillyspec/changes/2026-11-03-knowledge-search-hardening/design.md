---
author: flow-machine-draft
created_at: 2026-11-03T01:27:47.446Z
---
# 设计记录（Design Record）— 2026-11-03-knowledge-search-hardening

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：落地用户拍板的 B+D+C 三项止血（A 治本另立 brainstorm，不在本变更内）。B：backend `mem_limit` 2500m→3500m——2026-11-03 生产诊断实证（宿主 dmesg：10 月 40 次、11-02 2 次 cgroup OOM kill，被杀者 oom_score_adj=0 的模型 worker 子进程，anon-rss ~2.4G；2500m 对「服务本体 ~460M + 嵌入/翻译双 worker 并存」峰值偏紧），宿主 7.5G 下全栈限额总和升至 ~4.25G 仍充裕。D：`KnowledgeSearchState.updated_at` 补 `onupdate`（对齐 mcp_registry/model.py 先例）——该列原只有 `default_factory`，同步成功不刷新，DB 恒显示建行时间，本次排障先被误导；onupdate 是 SQLAlchemy 客户端侧行为，不改列 DDL，无需迁移。C：前端等待文案与降级徽标对齐真实机制——等待文案改「增量同步」口径；徽标按 `reason` 区分 `index_not_built`（索引未预建）与其余（模型不可用）。搜索同步的架构性改造（内联差量嵌入移出请求路径）留给 A 立项头脑风暴，本变更不触碰 search_sync 编排。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- HTTP/API 面：无任何变化（端点签名、响应字段、状态码全不动）。
- ORM：`KnowledgeSearchState.updated_at` 列新增 `onupdate`（客户端侧刷新器）；列类型/可空性/DDL 不变，**无 alembic 迁移**；行为变化仅「该行执行 UPDATE 时该列被刷新」。
- compose：仅 backend `mem_limit` 数值与注释变化；服务名、端口、卷、依赖不动。
- 前端：`page.tsx` 两处静态文案字符串；组件结构、data-testid、状态逻辑、请求链路不动。
- 文档：deploy-to-server SKILL.md「内存与 OOM 排障」段的限额数字与配额总和更新（原文停在 1100m 时代，已两次过时）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立。`updated_at` 刷新只发生在同进程 per-workspace 锁内的同步事务里（单写者），不存在乱序写；快路径零 UPDATE，不会出现「未同步却刷新」的假信号。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：同步主体在 per-workspace asyncio 锁内 single-flight；跨进程并发在当前单 uvicorn worker 部署下不成立（既有 design 已声明该前提，扩 workers 前须补 DB 唯一约束——非本变更面）。`updated_at` 刷新与 state 指纹写入同一事务同一 commit，无半态可见。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全。请求中断/容器重启 → 未 commit 事务回滚，`updated_at` 与索引数据一致回滚；无内存态依赖，重启后行为不变。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会。state 行以 workspace_id 唯一约束隔离，`onupdate` 只作用于被 UPDATE 的行；compose 限额与前端文案均为全局单例面，无工作区维度。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是 3500m 放宽 cgroup 顶后宿主瞬时内存压力上界抬高（当前全栈实际用量 ~2.8G，距 7.5G 远）；OOM 保护设计（主进程 oom_score_adj=-500、worker 闲置自灭）不变，最坏情形是 worker 仍偶发被杀——与本变更前等价，不会更差。考虑过的替代：mem_limit 直接提 4G——放弃：3500m 已覆盖实测峰值（~2.56G 双 worker 并存 + 余量），抬 4G 会挤压宿主上 ppdmq-* 项目容器的安全边际，且无证据证明必要。防复潮关联：D-deploy-001@v1（嵌入独立容器 + 长轮询）落选不复活——本变更只调限额，不动部署拓扑；内联同步改后台化属 A 立项范围，其 brainstorm 必须正面处理 D-backend-023/024/021 否决的复潮条件（生产内存已升级 + 内联差量实证受损 60-80s，与当年小内存否决语境不同）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | deploy/docker-compose.yml | backend mem_limit 2500m→3500m + 注释记 OOM 依据 |
| 修改 | backend/app/modules/knowledge/search.py | KnowledgeSearchState.updated_at 补 onupdate |
| 修改 | backend/app/modules/knowledge/tests/test_knowledge_search.py | 新增 updated_at 刷新/快路径冻结测试 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | 等待文案改增量同步口径；降级徽标按 reason 区分 index_not_built |
| 修改 | .zcode/skills/deploy-to-server/SKILL.md | 「内存与 OOM 排障」段限额数字更新至 3500m 现实 |
