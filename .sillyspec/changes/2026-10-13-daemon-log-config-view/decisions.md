---
author: qinyi
created_at: 2026-10-13 16:27:10
generated_by: sillyspec-fourpiece-init
change: 2026-10-13-daemon-log-config-view
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 配置敏感字段脱敏掩码展示
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: daemon 配置文件含 token/api_key 等敏感凭据（sillyhub-daemon/src/config.ts:256-444 的 DaemonConfig），平台展示时如何处理？
- answer: 用户选「脱敏掩码」：默认显示为保留前后几位的掩码形式（如 sk-1***xyz），页面提供「显示明文」按钮可切换
- normalized_requirement: 配置展示接口返回的敏感字段（token、api_key 及同类凭据字段）默认掩码；前端可按需切换明文；下载配置文件时同样遵循掩码（下载的是脱敏后内容）
- impacts: [FR-配置查看, task-backend, task-frontend]
- 模块域: sillyhub-daemon, frontend
- evidence: 用户 2026-10-13 对话确认（AskUserQuestion 轮次 1）；sillyhub-daemon/src/config.ts:256（DaemonConfig 含 token/api_key）
- 故障面: 掩码逻辑漏掉某敏感字段名导致明文泄露；需在 daemon 侧按字段名清单掩码而非按值猜测

## D-002@v1: 日志采用拉取尾部+手动刷新（非实时流）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: daemon.log（无轮转、追加式）在平台以什么方式查看？
- answer: 用户选「拉取尾部+手动刷新」：点开查看最近 N 行（默认可调），带刷新按钮；不做 WebSocket 实时滚动
- normalized_requirement: 日志查看为一次性拉取（tail N 行，N 可选），前端提供手动刷新；走 WS RPC 转发模式（实现形态以 D-004 为准：daemon 专用 RPC，非 host_fs.read_file），不新增长连接通道
- impacts: [FR-日志查看, task-backend, task-frontend]
- 模块域: sillyhub-daemon, backend, frontend
- evidence: 用户 2026-10-13 对话确认（AskUserQuestion 轮次 1）；先例 backend/app/modules/platform_sync/router.py:852-927（agent 日志尾部 256KB 截断拉取）
- 故障面: 大日志文件全量读取导致 RPC 超时——须在 daemon 侧或 backend 侧限制返回尾部字节上限
- 退役判据: 未来出现「盯日志实时排障」高频诉求时，再评估升级为 WS 实时流（可基于现有 daemon:ws 通道扩展）

## D-003@v1: 功能范围=查看+下载（不做在线编辑）
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 「展示和提供 daemon 日志和配置」的范围边界？
- answer: 用户选「查看+下载」：日志和配置均支持查看与下载为文件；不做在线编辑（allowed_roots 编辑已有现有路径，其余配置改动仍在 daemon 本机做）
- normalized_requirement: 日志/配置支持只读查看与浏览器下载；不提供平台侧配置编辑入口；下载内容与展示内容一致（配置下载为脱敏后内容，见 D-001）
- impacts: [FR-日志查看, FR-配置查看, FR-下载, task-frontend]
- 模块域: frontend
- evidence: 用户 2026-10-13 对话确认（AskUserQuestion 轮次 1）；allowed_roots 编辑先例 frontend/src/app/(dashboard)/runtimes/page.tsx:823-907
- 故障面: 用户误以为平台可改配置——UI 上需明确标注「只读」
- 注: 下载口径细化见 D-007@v1（恒脱敏，明暗态一致）——本条「下载内容与展示内容一致」括号句以 D-007 为准

## D-004@v1: 采用方案 B——daemon 专用诊断 RPC（log_tail + config_get）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 「平台查看 daemon 日志+配置」的实现方案取舍（A 零 daemon 改动 / B daemon 专用诊断 RPC / C 心跳快照）？
- answer: 用户选方案 B：daemon 注册 daemon_log_tail 与 daemon_config_get 两个 RPC handler（路径由 daemon 侧 getLogFile()/loadConfig 权威解析，尾部截断与脱敏在源头做），backend 新增转发端点（复制 daemon_rpc.py 先例），前端 /runtimes 机器卡加入口。理由：路径权威（SILLYHUB_DAEMON_DIR 重定向不影响）、大文件不全量传、脱敏贴近数据源
- normalized_requirement: 日志/配置拉取走 daemon 新 RPC：daemon_log_tail(params: tail_lines) 返回尾部 N 行文本 + 文件元信息；daemon_config_get() 返回脱敏后的配置 JSON；backend 端点 GET /api/daemon/machines/{id}/logs 与 GET /api/daemon/machines/{id}/config 经 ws_hub.send_rpc 转发；老 daemon method_not_found 时 422，前端提示升级
- impacts: [FR-日志查看, FR-配置查看, task-daemon, task-backend, task-frontend]
- 模块域: sillyhub-daemon, backend, frontend
- evidence: 用户 2026-10-13 对话确认（方案选择轮次）；RPC 注册先例 sillyhub-daemon/src/daemon.ts:6988-7003；backend 转发先例 backend/app/modules/daemon/router/daemon_rpc.py:46-88；host_fs.read_file 需绝对路径且全量读的硬伤见 sillyhub-daemon/src/host-fs-handler.ts:871-879
- 故障面: 老 daemon（未升级）无这两个 RPC → method_not_found；需在 backend 映射 422 + 前端升级提示
- 退役判据: 若未来 host_fs RPC 支持按约定 key 寻址 + tail 参数，可考虑合并回通用文件读通道

## D-005@v1: 方案 A（零 daemon 改动，backend 拼 allowed_roots 路径 + host_fs.read_file）被否决
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 同 D-004 取舍问句
- answer: 否决。两个硬伤：① backend 拼不出 daemon 机器上 ~/.sillyhub/daemon/daemon.log 的绝对路径——host_fs.read_file 需绝对路径（sillyhub-daemon/src/host-fs-handler.ts:871 pathResolve），backend 不知道 daemon 侧 home 目录，且 SILLYHUB_DAEMON_DIR 环境变量可整体重定向状态目录（sillyhub-daemon/src/config.ts:57-62），重定向后 backend 拼的路径静默失效；② read_file 为全量读取（readFile utf8 无 tail 参数），daemon.log 无轮转纯追加，大文件全量传输有 RPC 超时/内存风险；③ 脱敏逻辑放 backend 会与 daemon 配置结构演进脱钩
- normalized_requirement: 不采用「backend 猜路径 + 通用文件读」模式实现 daemon 自身日志/配置拉取
- impacts: []
- evidence: 方案选择轮次 2026-10-13；sillyhub-daemon/src/host-fs-handler.ts:871-879（readFile 全量读+绝对路径）；sillyhub-daemon/src/config.ts:57-62（SILLYHUB_DAEMON_DIR 重定向）
- 否决理由: 路径不可靠（重定向即失效）+ 全量读大文件超时风险 + 脱敏逻辑远离数据源易漂移
- 复潮条件: host_fs RPC 若支持 ~ 约定寻址 + tail 参数 + 字节上限，硬伤①②消解时可重评

## D-006@v1: 方案 C（心跳携带日志/配置快照入库）被否决
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 同 D-004 取舍问句
- answer: 否决。心跳每 15s 一次（sillyhub-daemon/src/config.ts 默认 heartbeat_interval=15），携带日志尾部会让心跳 payload 持续膨胀；日志时效性锁定在最后一次心跳时刻，排障场景价值低；为低频排障需求引入持续存储开销与配置变更检测复杂度，收益成本倒挂
- normalized_requirement: 不在心跳通道携带 daemon 日志/配置内容
- impacts: []
- evidence: 方案选择轮次 2026-10-13；sillyhub-daemon/src/config.ts:462-514（DEFAULT_CONFIG heartbeat_interval=15）
- 否决理由: 心跳 payload 持续膨胀 + 日志时效性锁死于最后一次心跳 + 为低频排障引入持续存储开销
- 复潮条件: 出现「离线机器也要看最后快照」的强需求，且心跳带宽/存储不再敏感时可重评

## D-001@v2: 掩码公式收紧（len<16 全掩）与敏感字段清单明文枚举
- type: boundary
- priority: P0
- status: accepted
- supersedes: D-001@v1
- source: design-grill
- question: Design Grill BL-03：v1 掩码公式「前4***后4、len<8 全掩」对长度恰为 8 的凭据全量泄露（4+4=8），9 位泄露 8 位；且「同类凭据字段」无可测试清单
- answer: 公式收紧为 len<16 整值掩为 '***'、len≥16 前4+'***'+后4；字段清单明文枚举 SENSITIVE_CONFIG_FIELDS=['token','api_key']（DaemonConfig 实测凭据类字段仅此两项，config.ts:256-444 范围核对），新增凭据字段须同步维护
- normalized_requirement: getMaskedConfig 掩码公式：len<16 → '***'；len≥16 → 前4位+'***'+后4位；字段清单取常量 ['token','api_key']；边界单测覆盖 len=0/8/9/15/16/24
- impacts: [FR-03, FR-04, task-daemon]
- evidence: design-grill 首轮 BL-03（cross-check C6）；sillyhub-daemon/src/config.ts:256-444；design.md Phase 1 getMaskedConfig 节
- 故障面: 未来 DaemonConfig 新增凭据字段而漏加清单 → 明文泄露；靠「新增凭据字段时同步清单」评审纪律 + 清单常量注释兜底
- 退役判据: 若 daemon 配置引入统一的凭据字段声明机制（如 schema 标注），可改为声明驱动

## D-007@v1: 配置下载恒脱敏（明暗态一致）
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: Design Grill BL-01：明文态（点「显示明文」后）点下载，按初稿「所见即所得」会下载含明文凭据文件，与 D-001「下载遵循掩码」矛盾
- answer: 用户裁定「恒脱敏下载」：无论页面处于掩码态还是明文态，下载永远输出脱敏 JSON；要核对明文在页面上点「显示明文」看即可，下载（外带动作）不携带明文凭据
- normalized_requirement: 下载按钮产物恒为脱敏 JSON（与 reveal 状态无关）；页面明文态不影响下载内容；UI 下载按钮标注「下载内容始终脱敏」
- impacts: [FR-05, task-frontend]
- evidence: 用户 2026-10-13 裁定（Grill 后追认轮次）；D-001「下载遵循掩码」与 D-003 括号句据此权威化；design.md 设计目标 §4 / 自审 3
- 故障面: 用户预期「所见即所载」时可能困惑——UI 文案明确标注下载恒脱敏

## D-008@v1: 测试文件路径对齐 tests/modules/daemon/ 目录结构
- type: consistency
- priority: P2
- status: accepted
- source: user
- question: 执行期发现 design/TaskCard 把新 pytest 文件写在 backend/tests/ 根（test_daemon_machine_diag.py），但仓库实际结构是 tests/modules/daemon/（daemon 域测试全在该子目录）
- answer: 路径校正为 backend/tests/modules/daemon/test_daemon_machine_diag.py；design.md 文件清单与 task-02 allowed_paths/target_files 已同步
- normalized_requirement: 新测试文件落 tests/modules/daemon/ 子目录（与 daemon 域既有测试同址）
- impacts: [task-02]
- evidence: 执行期裁决 2026-10-13；backend/tests/modules/daemon/ 既有结构（test_runtimes_usage_endpoint.py 等）
- 故障面: 无（纯路径校正，语义不变）
