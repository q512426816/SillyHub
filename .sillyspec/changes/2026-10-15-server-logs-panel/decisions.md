---
author: qinyi
created_at: 2026-10-15 16:05:50
generated_by: sillyspec-fourpiece-init
change: 2026-10-15-server-logs-panel
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 日志源=应用侧落文件+轮转（用户亲选）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 服务器日志展示下载的日志源怎么落地？现状后端日志仅 structlog JSON→stderr（backend/app/core/logging.py:19-41），无文件，直接展示下载无从读起。
- answer: 用户亲选「落文件+轮转」——logging 配置同时保留 stderr（现状不动，容器日志聚合不受影响）+ 新增轮转文件（5MB×3 备份，RotatingFileHandler 自动清理）；本地开发/Windows/macOS/Docker 行为一致，有历史可查可下载。
- normalized_requirement: configure_logging 增加文件 handler（路径经 settings 可配、默认基于 repo_root()/data 派生）；轮转策略 maxBytes=5MB backupCount=3；stderr 输出行为零变化；日志文件路径与轮转参数单点定义可测试。
- impacts: [FR-01, task-01]
- evidence: backend/app/core/logging.py:16-41（当前实现）；backend/app/core/paths.py:32（repo_root 惯例）；backend/app/core/config.py:101（log_level 已有）
- 故障面: 文件 handler 写失败（磁盘满/权限）不得拖垮进程——emit 异常由 logging 模块内部兜底，启动期建目录失败降级回 stderr-only。
- 退役判据: 若未来引入集中日志聚合（Loki/ELK），页面日志卡改为查询聚合后端时本机制可退役。

## D-002@v1: 展示形式=结构化+自动刷新（用户亲选）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 日志在页面上怎么展示？
- answer: 用户亲选「结构化+自动刷新」——默认最近 200 行，随页面 5s 轮询自动刷新；JSON 日志行解析为「时间/级别/事件/详情」结构化展示，点行展开原始 JSON；行数可切 100/500/1000。
- normalized_requirement: GET /api/server-logs 支持 lines 参数（白名单 {100,200,500,1000}，非白名单一律回退 200——与 D-008@v1 统一）；响应含解析后条目（time/level/event/fields）与原始行文本；非法 JSON 行按原文降级展示不丢行；页面卡内独立 5s 轮询同一请求。
- impacts: [FR-02, task-02, task-03]
- evidence: 承接页 frontend/src/app/(dashboard)/admin/server-status/page.tsx（5s 轮询既有）；日志 JSON 行格式 backend/app/core/logging.py:25-41（TimeStamper iso/day + add_log_level + JSONRenderer）

## D-003@v1: 下载范围=单文件可选历史（用户亲选）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 下载功能的范围？
- answer: 用户亲选「单文件可选历史」——下载区提供当前日志文件与轮转归档（backend.log.1/.2/.3）的选择，逐文件下载（不打包 zip）。
- normalized_requirement: GET /api/server-logs/download?file=<name> 仅接受白名单文件名（目录遍历防护，禁 ../）；Content-Disposition attachment 带原文件名；前端 fetch blob+objectURL 下载（JWT 裸 URL 会 401，先例 frontend/src/lib/explorer.ts:64-87）。
- impacts: [FR-03, task-02, task-03]
- evidence: frontend/src/lib/explorer.ts:9（JWT 鉴权裸 URL 401 先例，下载链路复用含 401 单飞刷新 :77-84）；backend/app/modules/agent/router.py:518（FastAPI 流式响应族先例）

## D-004@v1: 权限=复用 system_status:read（用户亲选）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 日志查看下载用什么权限？
- answer: 用户亲选「复用 system_status:read」——日志比性能数字更敏感，但页面本就在系统管理区、受众相同；不新增权限枚举，持 system_status:read 或 platform:admin 即可（端点同挂 require_permission_any）。
- normalized_requirement: 两新端点均挂 require_permission_any(Permission.SYSTEM_STATUS_READ)；无新权限枚举、无迁移；未登录 401/无权限 403 与既有三态口径一致。
- impacts: [FR-02, FR-03, FR-04, task-02]
- evidence: backend/app/modules/health/router.py:84-94（system-status 鉴权先例）；decisions 2026-10-14-admin-server-status D-004@v1（免种子模式）

## D-005@v1: 敏感信息处置=原始日志+页面提示（AI 定案，可否决）
- type: risk
- priority: P2
- status: accepted
- source: code
- question: 日志含文件路径/用户邮箱等敏感信息，展示与下载是否脱敏？
- answer: 展示与下载均为原始日志（不引入运行时脱敏管道——脱敏重写日志文本工程量大且在管理员受众下端到端收益低）；页面日志卡固定显示提示语「日志含运行路径与账号信息，请勿外传」；security_log_desensitization 设置项语义不变（不勾连本功能）。
- normalized_requirement: 页面含固定安全提示文案；后端不做内容脱敏重写；下载文件名不含用户输入。
- impacts: [FR-02, FR-03]
- evidence: settings 页安全策略含 security_log_desensitization（frontend/src/app/(dashboard)/settings/page.tsx:231）；受众=系统管理区（D-004@v1 权限面）

## D-006@v1: 日志落盘实现=单点插入文件写入（用户亲选，方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 日志写文件的技术实现？A 单点插入（processor 链尾写文件+stderr 照旧）vs B 重构为标准多 handler 架构。
- answer: 用户亲选方案 A——在 structlog processor 链 JSONRenderer 之前插入自定义 FileWriter processor（event_dict 先 json.dumps 写轮转文件、再透传 JSONRenderer 输出 stderr）；改动局限 backend/app/core/logging.py 单文件，stderr 输出链路零扰动。
- normalized_requirement: FileWriter processor 复用同一 JSONRenderer 实例渲染行文本（与 stderr 逐字一致）；per-write open/close 句柄策略（Windows rename 可轮转）；超限 rename 链（.1/.2/.3）+ rename 失败捕获；写失败不抛出（进程安全）。
- impacts: [FR-01, task-01]
- evidence: backend/app/core/logging.py:33-41（processor 链现状）；D-001@v1（轮转 5MB×3）
- 故障面: 轮转瞬间的并发写（单进程单线程 event loop 下 logging 同步调用，无并发面）；文件被外部 truncate 时 write 继续追加。
- 退役判据: 同 D-001@v1（引入集中日志聚合后退役）。

## D-007@v1: 页面布局=日志卡满宽居底（用户亲选）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 日志卡在页面上的位置？
- answer: 用户亲选「满宽居底」——删除业务统计卡后页面剩三卡：服务器性能（左半）、依赖与版本（右半或满宽调整）、服务器日志（满宽，页面最下方）。
- normalized_requirement: 业务统计卡（StatCell 四格组件）从 page.tsx 移除；日志卡 SectionCard 满宽置底；性能卡与依赖卡布局按删卡后视觉平衡调整（沿用现 grid lg:grid-cols-2 均分）。
- impacts: [FR-02, task-03]
- evidence: frontend/src/app/(dashboard)/admin/server-status/page.tsx（现三卡 grid 布局，业务统计卡在 :201-238 一带）

## D-008@v1: 日志条数参数与轮转参数的可配口径（AI 定案，可否决）
- type: definition
- priority: P2
- status: accepted
- source: code
- question: lines 参数与轮转大小的取值口径？
- answer: lines 白名单 {100,200,500,1000}（非白名单值回退默认 200，不报错）；轮转 maxBytes=5MB/backupCount=3 常量于 logging.py 模块级（非 settings 项——避免配置面膨胀，需要时再升 settings）。
- normalized_requirement: lines 越界/非法→200；GET /api/server-logs 响应含 total_lines（文件总行数）与 available_files（白名单文件列表，供下载下拉）；空态 hint 文案。
- impacts: [FR-02, task-01]
- evidence: D-002@v1（展示口径）；D-001@v1（轮转口径）
