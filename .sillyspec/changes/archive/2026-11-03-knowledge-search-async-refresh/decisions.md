---
author: qinyi
created_at: 2026-11-03 10:49:17
generated_by: sillyspec-fourpiece-init
change: 2026-11-03-knowledge-search-async-refresh
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 同步架构选 A1——后台同步 + 立回存量索引（stale-while-revalidate）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 差量嵌入同步跑在搜索请求内（backend/app/modules/knowledge/search.py 的 search_sync 懒同步段），文件变更后首搜实测 63-81s（生产 slow.request 日志 2026-11-03），选哪条架构路线？
- answer: 用户回复「继续」确认按上一轮汇报推荐项 A1 推进（汇报明示 A1 为推荐；选项 A1 后台同步+立回旧索引 / A2 daemon 事件预建 / A3 维持内联）。复潮裁决：D-backend-023@v1（后台常驻同步协程）与 D-backend-024@v1（首查触发+周期刷新混合）否决于小内存时代（防周期空转与双路径复杂度，见 knowledge/decisions/backend.md，变更 2026-10-15-knowledge-search-pgvector）；现复潮条件成立——生产已 8G 宿主/3500m 容器限额（2026-11-03-knowledge-search-hardening），且内联同步实证受损（63-81s 阻塞 + worker OOM 打断重头再来）；A1 为事件驱动（搜索触发、无周期空转、无持久化队列、单一路径），与被否决的「常驻轮询空转」有本质区别。A2（daemon 事件预建）落选：跨 daemon/backend 两仓联动周期长，平台无法兜底 daemon 离线；A3 落选：不改架构则首搜阻塞永存且随语料增长恶化。
- normalized_requirement: 搜索请求禁止同步等待任何嵌入计算；语料指纹与库内失配时必须调度后台同步并立即返回存量索引检索结果。
- impacts: [FR-01, FR-02, FR-03, FR-04]
- 故障面: 后台同步任务随进程重启丢失（自愈：下次搜索重触发）；后台嵌入与前台服务共享容器内存（3500m 限额内，嵌入 worker 闲置自灭机制沿用）。
- 退役判据: 若 A2（daemon spec-sync 后预建端点）未来落地且覆盖全部同步触发场景，事件驱动后台同步可简化移除。

## D-002@v1: 无索引工作区首搜统一后台化（含全量建库）
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: server_build=True（生产现状，.env 未配开关）下无 state 行工作区首搜走全量建库（数千 chunks 分钟级，known-issues「首搜建库地雷」），A1 下如何处理？
- answer: 我的判断：统一后台化——首搜（及一切同步触发态）请求不等待建库，立即返回词面降级结果（reason 用可区分值，如 index_building），后台任务执行全量/差量同步；同步完成后下次搜索走正常向量路。与 2026-10-19-knowledge-search-build-switch 的「禁建库降级」语义兼容：server_build=False 保持只读不调度。
- normalized_requirement: 全量与差量同步（含无索引首建）一律不得阻塞搜索响应；server_build=False 时禁止调度任何写库同步。
- impacts: [FR-02, FR-03]
- evidence: backend/app/modules/knowledge/search.py:789-810（search_sync 懒同步分支与禁建库分支现状）

## D-003@v1: 后台任务生命周期——进程内 task + 懒触发自愈，不做持久化队列
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 后台同步任务的生命周期与失败重试策略？
- answer: 我的判断：进程内 asyncio task（沿用 per-workspace single-flight 锁防并发重复同步）；不做持久化队列、不设定时器重试——进程重启丢任务由下次搜索重触发自愈（懒触发语义保留），失败后同样等下次搜索再触发。此取舍刻意对齐 D-backend-023 否决理由（防周期空转），并在 design 风险登记为 R-xx。
- normalized_requirement: 同步任务失败/中断禁止自动周期重试；每次搜索在指纹失配且无在途任务时才允许调度。
- impacts: [FR-02]
- 故障面: 长期无搜索的静默工作区索引不刷新（可接受：无搜索即无读方；updated_at 可观测）。
- 退役判据: 出现「搜索少但索引新鲜度要求高」的消费方（如定时报告）时引入显式触发端点。

## D-004@v1: 响应契约增量可选字段 index_sync 告知新鲜度
- type: compatibility
- priority: P2
- status: accepted
- source: code
- question: 前端如何得知「本次结果基于存量索引、新变更已在后台同步」？
- answer: 我的判断：KnowledgeSearchOut 增加可选字段 index_sync（"fresh" | "scheduled" | "building"），additive 向后兼容（旧客户端忽略）；前端可在搜索框下方展示轻提示（轻于现有降级徽标的口径）。API 响应形态变化随本变更走契约文档与 api-types 再生成。
- normalized_requirement: index_sync 必须为可选字段，缺失时前端行为与现版一致。
- impacts: [FR-04]

## D-005@v1: 后台同步的实现结构——检索函数内联调度（asyncio.create_task），不新建调度器模块
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: A1 方向下的实现结构：检索路径内联调度后台任务，还是建应用级统一同步调度器/队列模块？
- answer: 我的判断（按 brainstorm 分层规则：两方案用户可见行为完全一致，不改变产物，属工程取舍）：方案 1 内联调度——search_sync 检测指纹失配/无 state 行时 `asyncio.create_task` 拉起同步协程后立即走只读查询。依据：①单一消费方（知识搜索）为它建调度器模块属过度设计；②per-ws single-flight 锁 + 「在途任务注册表」已覆盖去重（方案 2 的 dedupe 能力方案 1 同样具备）；③改动面最小、懒触发语义与既有代码位置一脉相承。方案 2（应用级队列）落选理由：新增基础设施面（生命周期/背压/可观测）只为单一 caller 服务，与 D-backend-023 否决理由同源的复杂度顾虑。
- normalized_requirement: 后台调度必须内嵌于检索路径（无独立调度模块）；同 workspace 在途任务唯一（注册表判重，per-ws 锁沿用）。
- impacts: [FR-02]
- 故障面: create_task 的强引用需自行持有（asyncio 只持弱引用——任务注册表同时充当强引用集，任务完成时移除，防 GC 静默吞任务）。
- 退役判据: 出现第二个需要 spec 同步的后台消费方时，再抽应用级调度器。

## D-006@v1: 差量 UPDATE 路径必须同步 title/anchor（存量数据正确性 bug 修复）
- type: consistency
- priority: P1
- status: implemented
- source: code
- question: 语料编辑改写小节标题/条目锚点但保持行号坐标时，差量同步后索引呈现什么？
- answer: 执行期隔离复现实证（2026-11-03，最小复现两次 _ensure_synced 直调）：`_sync_delta` 的 UPDATE 路径只更新 text/kind/content_hash/embedding/start_line，**漏更 title/anchor**——文本已新而标题/锚点恒旧，且 state 指纹已推进不再重试，属静默永久陈旧（标题词面打分与展示面持续失真）。修复：UPDATE 路径补 `row.title = c.title; row.anchor = c.anchor`。该 bug 自 2026-10-15-knowledge-search-pgvector 引入 delta 起即存在（既有测试只覆盖 INSERT 路径，UPDATE 路径零覆盖），与调度化改造无关，但被本变更的新用例首次暴露。
- normalized_requirement: 差量 UPDATE 后，索引行的 title/anchor 必须与当前语料内容一致（由用例断言新标题可搜）。
- impacts: [FR-01, FR-02]
- evidence: backend/app/modules/knowledge/search.py `_sync_delta` UPDATE 分支（本次修复处）
- 遗留面: 修复前已发生「text 新 + title/anchor 旧」的存量行，因 content_hash 已是新版、后续差量不再触碰，需全量重建才净化（生产处置见变更汇报，不在本变更展开）。



