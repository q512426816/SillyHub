---
author: qinyi
created_at: 2026-10-27 10:16:21
generated_by: sillyspec-fourpiece-init
change: 2026-10-27-archive-reparse-oom-governance
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 治本目标定为增量方案（又快又稳）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 归档/文档变更在变更中心的可见时效允许放到多宽（决定方案激进程度：增量 vs 保守合并窗）
- answer: 用户确认「增量方案：又快又稳」——结构性事件（归档/删除）秒级~1 分钟内可见、普通文档推送 ≤2 分钟、内存峰值大降不再 OOM；若调研后发现增量方案有安全隐患，退回合并窗方案并回来找用户重新拍板
- normalized_requirement: reparse 链路增量化：结构性事件收敛 ≤60s、普通推送收敛 ≤120s、单次收敛内存峰值不得随变更总数线性增长（不再全量遍历整棵变更树）
- impacts: [FR-01, FR-02, FR-03]
- evidence: 用户 2026-10-27 会话问答（时效取舍→追问「为什么那么慢」→确认增量方案）；事故证据 dmesg OOM kill anon-rss≈2.37G
- 故障面: 增量判定漏路径时部分变更不收敛（需全量兜底通道与对账探针）
- 退役判据: 变更树规模长期 ≤50 且无并发归档场景时可回退合并窗简化版

## D-002@v1: mem_limit 再上调只作方案附录建议，不在本次实施
- type: process
- priority: P1
- status: accepted
- source: user
- question: 过渡兜底（后端容器 2500m→3500m）是否纳入本次一并执行
- answer: 用户选「只做治本评估，不动线上」——mem_limit 调整作为治本方案的配套运维建议写入附录供后续单独决策，本变更不动任何线上配置
- normalized_requirement: 本变更零部署动作；deploy/docker-compose.yml:178 mem_limit 数值不在本变更 diff 中
- impacts: [Non-Goals]
- evidence: 用户 2026-10-27 修复选择问答（选「只做治本评估」未选「止血：调内存限额+重启」）

## D-003@v1: 「进行中列表过滤缝隙」修正列 Non-Goal
- type: scope
- priority: P1
- status: accepted
- source: user
- question: 归档未收敛行混入「进行中」列表的过滤缝隙是否并入本变更
- answer: 我的判断：不并入——用户修复选择时未选含该项的「止血+小修」组合；该缝隙独立小、可单独立轻量变更处理，混入治本变更会模糊评审焦点。增量化落地后缝隙窗口本身从 ≤2 分钟缩到 ≤60s，痛感自然减小
- normalized_requirement: 本变更不改 change/service.py list_ 的 location 过滤条件
- impacts: [Non-Goals]
- evidence: backend/app/modules/change/service.py:270-292（active 分支精确等值无 status 排除）

## D-004@v1: 治本方案选定方案C（scoped 增量承接归档 + 探针对账兜底）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: OOM 治本三方案（A 免 reparse 靶向改库 / B 全量合并窗 / C scoped 增量承接归档）取哪个
- answer: 用户选方案C——归档移动从 archive_hit→全量 reparse 改为 scoped=[归档名] 定向重扫（parser 三区按 name 匹配既有能力，backend/app/modules/change/parser.py:143-202 三区 iterdir 均带 scope_set 过滤，遍历成本 ∝ scope 不 ∝ 全树）；全量 reparse 退位为手动端点/异常兜底（不做常态化全量对账，尊重 knowledge decisions 拒C 先例）；配套漂移探针 + bundle gzip 构建串行化/按需化 + 内存水位日志
- normalized_requirement: 归档推送后不再触发 scope=None 全量 reparse；scoped 重扫成本与变更总数解耦；单次收敛内存峰值不随变更总数线性增长
- impacts: [FR-01, FR-02, FR-03, FR-04]
- evidence: 用户 2026-10-27 方案选择轮（AskUserQuestion 选「方案C：scoped 增量」）；parser scoped 遍历事实 backend/app/modules/change/parser.py:150,171,202；archive_hit 现行逻辑 backend/app/modules/spec_workspace/service.py:3091-3122
- 故障面: scoped 语义边界外漏路径（同窗既有删除+归档交错）时部分行不收敛——由漂移探针+手动全量兜底
- 退役判据: 变更树回归百级以下且无并发归档时可选回退合并窗简化版

## D-005@v1: 方案A（免 reparse 靶向改库）落选
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-004 取舍问句
- answer: 落选——归档 ops 直翻行状态绕开 parser 建第二真相写径，与知识库既有架构决策「平台以镜像文件树为唯一权威、经 reparse 收敛」（knowledge/decisions/backend.md 2026-08-29 变更 D-005 家族）正面冲突；ops 流缺失/乱序时行与磁盘漂移且无自愈通道
- normalized_requirement: 本变更不引入绕过 parser 的 Change 行直写路径
- impacts: [Non-Goals]
- evidence: 方案对比轮用户未选A；knowledge/decisions/backend.md:28-30（镜像树唯一权威+拒墓碑直驱的同类裁决）
- 否决理由: 第二真相写径破坏单一权威架构，漂移无自愈
- 复潮条件: 平台改为「ops 流为权威、文件树为投影」的整体架构重构时

## D-006@v1: 方案B（全量合并窗治理）落选
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-004 取舍问句
- answer: 落选——时效回落分钟级违反 D-001「又快又稳」用户目标；全量遍历成本仍随变更总数线性增长，治标不治本（470→2000 变更规模时再爆）
- normalized_requirement: 归档收敛不依赖「定时全量重扫」作为主通道
- impacts: [Non-Goals]
- evidence: 方案对比轮用户未选B；用户此前已追问「为什么那么慢」明确拒绝慢路
- 否决理由: 违反 D-001 时效目标且峰值随规模线性涨
- 复潮条件: scoped 增量方案论证发现不可消解安全隐患（退回保守路线时按 D-001 预案回访用户）

## D-007@v1: 双通道时效分档（结构性立即 / 普通推送 2 分钟合并窗）
- type: architecture
- priority: P1
- status: confirmed
- source: user
- question: 归档提速通道与防刷屏合并窗如何共存
- answer: 设计确认轮用户确认——结构性事件（归档/删除）走立即 single-flight 通道（≤60s 收敛），普通文档推送维持既有 120s 合并窗（≤120s 收敛）；single-flight（同 workspace 同时仅一个 reparse）两通道共享不破
- normalized_requirement: 结构性 scope 触发不受 120s 节流窗拦截（仍受 in-flight 互斥）；非结构 scope 维持现节流语义
- impacts: [FR-01]
- evidence: 用户 2026-10-27 设计确认轮（选「确认设计，继续」，段3 分档方案随设计整体确认）；backend/app/modules/spec_workspace/service.py:3161-3169（现行节流判定）
- 故障面: 结构性事件风暴（短窗大量归档）时立即通道产生密集 scoped reparse——成本∝单变更，可承受；保底 single-flight 串行

## D-008@v1: 漂移探针只告警不自动修复
- type: boundary
- priority: P1
- status: confirmed
- source: user
- question: 漂移检测发现行与磁盘不一致时是否自动触发全量重扫自愈
- answer: 设计确认轮用户确认——探针周期抽样核对（DB 行 location vs 磁盘目录形态），发现漂移仅告警日志；修复通道=人工调既有手动 reparse 端点。依据：知识库已否决「全量对账常态化」（Windows stat 断崖+全量 93s 超时史），自动修复即变相常态化
- normalized_requirement: 探针代码路径零写操作（只读核对+日志），不自动触发 scope=None reparse
- impacts: [FR-04]
- evidence: 用户 2026-10-27 设计确认轮；knowledge/decisions/backend.md:30（拒C 全量对账常态化先例）
- 退役判据: 手动兜底频率过高（周级多次）时重议自动化

## D-009@v1: bundle gzip 构建加同版本 single-flight
- type: architecture
- priority: P2
- status: confirmed
- source: user
- question: 打包缓存是否需要防重复构建
- answer: 设计确认轮用户确认——同 (workspace, spec_version) 在建期间其余请求等待复用产物，不重复构建（当前可能并发重复打包白耗内存/CPU）
- normalized_requirement: 同版本并发 bundle 请求只产生一次构建；等待者直接取缓存产物
- impacts: [FR-03]
- evidence: 用户 2026-10-27 设计确认轮（段5）；backend/app/modules/spec_workspace/service.py:197-201（现行 _bundle_gzip_cache 无在建互斥）

## D-010@v1: structural 触发撞在途 reparse 时尾随改「完成回调即时补发」
- type: architecture
- priority: P2
- status: accepted
- source: code
- question: Grill P2-1——structural 立即通道遇 in-flight reparse 时，现行尾随是硬 sleep(120s) 定时器，收敛时延≈满窗突破 ≤60s 承诺（事故场景六会话同窗恰是并发叠加态）
- answer: 我的判断（评审核证采纳）：structural 触发遇 in-flight 时不入 120s 定时尾随，改挂「当前 reparse 完成回调」即时补发（完成即重算 scope 执行）；非结构尾随维持 120s 合并窗不变。承诺保持 ≤60s
- normalized_requirement: structural in-flight 补发时延=当前 reparse 剩余时长（无固定 120s 等待）；非结构尾随语义零回归
- impacts: [FR-01]
- evidence: Grill review P2-1；backend/app/modules/spec_workspace/service.py:3263-3270（现行 _fire 硬 sleep）
- 故障面: 完成回调链异常需兜底（回调丢失时退化为下轮触发兜底，探针可发现）

## D-011@v1: bundle 等待者 Future 失败传播 + 降级自建
- type: boundary
- priority: P2
- status: accepted
- source: code
- question: Grill P2-2——现行缓存 put 仅在流完整消费后发生（断连半包不入缓存），同版本等待者若以「缓存回填」为完成信号，首请求半包断连则等待者悬挂
- answer: 我的判断（评审核证采纳）：single-flight Future 携带成功/失败双态——构建方异常/断连时 Future 置失败并传播，等待者捕获后降级为自建（各自构建，失败不传染不悬挂）
- normalized_requirement: 等待者永不因构建方失败而无限悬挂；失败传播后降级路径有测试锁
- impacts: [FR-03]
- evidence: Grill review P2-2；backend/app/modules/spec_workspace/service.py:282 及 :1193 注释（半包不入缓存语义）
