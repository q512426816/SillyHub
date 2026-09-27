---
author: qinyi
created_at: 2026-09-24 16:16:00
generated_by: sillyspec-fourpiece-init
change: 2026-09-25-observation-events-v3-r16sf
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: v3 落位形态=原地演进+功能开关（用户裁决）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: observation events v3 是原地演进既有变更事件通道，还是并行新建独立服务（新表+新端点）？
- answer: 用户本轮裁决选「原地演进+开关」：同一组端点 POST/GET /changes/{name}/events + 同一张表 platform_change_events，行为由功能开关控制，开关关（缺省）=v2 行为逐字不变，开=v3 语义。依据：推送方是外部 sillyspec CLI watcher 固定打现有 URL（本仓任务范围仅后端/前端，并行新端点在仓内是死代码）；v2 前端卡本名「观测事件」即同一服务。
- normalized_requirement: 不新增并行表/端点；v3 全部语义变更挂在单一功能开关后，开关缺省关闭时既有 v2 行为（含 API 契约）逐字不变。
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
- evidence: 用户问答轮次1（R16-SF 会话A）；backend/app/modules/platform_sync/router.py:387-467（既有端点）；backend/app/modules/platform_sync/service.py:1918-2128（append_events/list_events v2 语义）
- 故障面: 同一代码路径双语义并存——开关两态都需测试锁定，防止 v3 条件分支泄漏进 v2 关态行为。
- 退役判据: v3 稳定运行一个迭代周期后可删 v2 关态分支（届时另立决策）。

## D-002@v1: since 增量语义基于 received_at（服务端接收时间）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: GET since 增量游标的时间基准用什么？
- answer: v3 开启后 since 基于 received_at（行 created_at，服务端接收时间）而非事件业务 ts——业务 ts 可能乱序到达，基于业务 ts 的游标会永久丢失晚到的早 ts 事件。v2 关态保持 ts > since 语义不变。
- normalized_requirement: 开关开时 since 过滤条件为 created_at > since（严格大于），spec/design/实现/响应字段命名四处逐字对齐；开关关时维持 ts > since。
- impacts: [FR-04]
- evidence: 任务书条目2；backend/app/modules/platform_sync/service.py:2113-2115（v2 ts > since 现状）
- 故障面: 服务端时钟回拨时 created_at 游标短暂回退→增量重复给行（幂等展示，客户端按 dedup 去重可忍）。
- 退役判据: v3 全量切流后删除 ts-based since 分支（与 D-001 退役同步）。
- 故障面: 客户端若混用两种游标语义（开关切换瞬间）会漏/重——回放语义由 truncated+total 兜底，前端明确不做增量游标（D-007）不受影响。

## D-003@v1: 窗口 5000 条按接收序剪枝，并发容忍少量超删
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 超 5000 条窗口的剪枝序用什么？并发下剪枝精确性要求？
- answer: 按接收序（created_at, id）删最旧修剪；并发写入下允许少量超删（不追求精确到 5000 的强一致），design 如实登记该取舍。v2 关态保持 (ts, created_at, id) 剪枝序不变。
- normalized_requirement: 开关开时剪枝 order by (created_at asc, id asc) 删超出量；design「取舍」节明文登记并发超删容忍；开关关时维持 v2 剪枝序。
- impacts: [FR-03]
- evidence: 任务书条目1；backend/app/modules/platform_sync/service.py:2025-2048（v2 (ts,created_at,id) 剪枝现状）
- 故障面: 并发批各自 count+delete 致瞬时超删（窗口 <5000）——任务书明示容忍，读端 truncated/total 口径不受影响。
- 退役判据: 若未来要求精确窗口，改 SELECT ... OFFSET 或行级锁方案（另立决策）。
- 故障面: 接收序剪枝会把「业务时间早但晚到」的事件更快挤出窗口——观测语义下可接受（读端以接收时间轴为准，D-002 同源）。

## D-004@v1: 读端点缺省返回最近 2000 条并带 truncated 标记
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 读端点缺省返回多少条？如何标记截断？
- answer: v3 开启时缺省返回最近 2000 条，响应带 truncated 标记（过滤后总数 > 返回条数时 true）。v2 关态维持缺省 500、无 truncated 字段。
- normalized_requirement: 开关开时 limit 缺省 2000；响应含 truncated: bool；开关关时 limit 缺省 500 且响应不携带 truncated 字段。spec/design/实现三层逐字对齐。
- impacts: [FR-04]
- evidence: 任务书条目2；backend/app/modules/platform_sync/router.py:424（v2 缺省 500 现状）

## D-005@v1: 单条 detail 载荷上限 64KB，schema 宽松接收+落库截断
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: detail 64KB 上限在哪层执行——schema 层 422 拒收还是落库截断？
- answer: 对齐 v2「宽松接收」先例：schema 层不限长，落库前截断 64KB（v2 为 2000 字符，v3 开启后放宽到 64KB，ORM 列需 String(2000)→Text 无损加宽迁移；关态写路径仍按 2000 截断）。spec/design/实现三层逐字对齐「64KB、截断在 service 落库层」。
- normalized_requirement: 开关开时 _CHANGE_EVENT_DETAIL_MAX=64*1024，ORM detail 列 Text；开关关时截断 2000 不变；迁移只加宽不缩窄（可回退）。
- impacts: [FR-01, FR-02]
- evidence: 任务书条目2；backend/app/modules/platform_sync/service.py:161-163（v2 截 2000 先例）；backend/app/modules/platform_sync/model.py:379-403（ORM）
- 故障面: Text 列放宽后单行可达 64KB×批量 500=32MB/请求级写入压力——靠批上限 500 与 30s 推送周期天然限流，design 登记。

## D-006@v1: 写入端点鉴权仅 shpsync_ token 派生工作区，body 不收 workspace
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 写入端点鉴权与 workspace 归属来源？
- answer: 沿用既有 require_platform_sync_write（仅 shpsync_ 可写：无凭据 401/其他轨 403），workspace_id 从 token 派生，请求体不接受 workspace 字段（extra=ignore 吞掉）。批量上限 v3 开启时 500（v2 关态维持 200）。
- normalized_requirement: 开关两态鉴权与 workspace 派生零变更；schema events max_items 开关开=500/关=200；去重键=（规范化 ts + 去重键）复合，规范化 ts 为 int 毫秒（v2 _change_event_dedup_key 先例）。
- impacts: [FR-01, FR-02]
- evidence: 任务书条目1；backend/app/modules/platform_sync/router.py:387-416（v2 _write_auth 范式）；backend/app/modules/platform_sync/service.py:166-172（dedup 键归一先例）

## D-007@v1: 前端 30s 全量重拉不做增量游标；告警条每个告警只决策一次
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 前端消费方式与告警条交互语义？
- answer: 前端维持 30s 轮询全量重拉列表（不实现 since 增量游标）；新增告警条（severity 告警级事件）：自动展开，每个告警只自动决策一次——用户手动收起后该告警不再自动展开（收起状态按告警 id 记忆，会话期内持久）。未配置新功能（开关关）时前端不渲染告警条，既有折叠卡行为不变。
- normalized_requirement: 30s refetchInterval 全量拉取（无 since 参数）；告警条 auto-expand 决策对同一告警 id 至多一次；开关关时前端渲染与 v2 逐像素一致。
- impacts: [FR-05, FR-06]
- evidence: 任务书条目3；frontend/src/components/changes/detail/change-events-card.tsx:26-31（v2 30s 轮询现状）

## D-008@v1: 功能开关走平台设置 KV，缺省关=既有行为不变，回退=关开关
- type: compatibility
- priority: P0
- status: accepted
- source: code
- question: 功能开关机制放哪里？回退路径？
- answer: 沿用 settings 模块平台设置 KV 先例（_read_setting_json/_write_setting_json，审计+管理员门控，mcp-whitelist 同款）承载开关；缺省（未配置）=关=v2 行为不变。回退路径=管理员把开关置关（或删除该设置键），无数据迁移不可逆操作——detail 列只加宽不缩窄，v3 期间写入的行在关态读路径完全可读。
- normalized_requirement: 开关缺省值 false（未配置键时按 false 处理）；写路径每次批量写入读一次开关；回退零迁移零数据损失。
- impacts: [FR-06, task 层开关读写任务]
- evidence: backend/app/modules/settings/router.py:198-209（platform settings KV 先例）、:237-250（mcp-whitelist 端点范式）
- 故障面: 开关读取增加每批一次 settings 查询——低频批量写（30s 周期）可忽略；design 可选进程内短 TTL 缓存，不强制。

## D-009@v1: 实现方案=A 原地分支+同步剪枝（用户裁决）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: v3 实现方案三选一（A 原地分支+同步剪枝 / B 策略拆分+显式 received_at 列 / C 异步剪枝任务）？
- answer: 用户轮次2裁决选 A：router 每请求读一次平台设置开关→语义参数传入 service；append_events/list_events 内部按参数分支（v3=接收序剪枝/since=created_at/detail 64KB/缺省 2000+truncated；v2 原逻辑不动）；received_at 复用 created_at 列（INSERT 时服务端落值=接收时间，语义等价），响应字段名 receivedAt；剪枝保持与本批插入同事务；唯一迁移=detail 列 String(2000)→Text 无损加宽。
- normalized_requirement: 单代码路径双语义参数分支；不新增 received_at 列、不新增常驻剪枝任务；schema 批上限（200/500）与 limit 缺省（500/2000）按开关运行时区分。
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-06]
- evidence: 用户问答轮次2（R16-SF 会话A）；对比方案 B/C 见 brainstorm step4 --wait 登记
- 故障面: 函数内双语义分支——开关两态需各自测试矩阵锁死（防 v3 分支泄漏进关态）。
- 退役判据: v3 全量切流稳定后删除 v2 分支与关态测试矩阵（另立决策）。
