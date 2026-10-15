---
author: qinyi
created_at: 2026-10-15 16:05:50
generated_by: sillyspec-design-init
change: 2026-10-15-server-logs-panel
scale: "large"  # 依据=用户显式要求完整流程（CLAUDE.md 规则 3：新功能必须走 brainstorm→plan→execute→verify→archive）。技术轴如实声明：总量单会话可吞吐；Wave 仅为执行编排形态——后端簇（task-01 落盘/task-02 端点）与前端簇（task-03 组件）文件正交可真并行，task-04 页面集成顺序依赖前端组件。
---

# 设计文档（Design）— 2026-10-15-server-logs-panel

## 背景

服务器信息页（2026-10-14-admin-server-status 交付）需按用户新需求调整：去掉业务统计卡、新增服务器日志展示与下载。现状后端日志仅 structlog JSON → stderr（backend/app/core/logging.py:19-41：basicConfig(stderr) + PrintLoggerFactory(file=sys.stderr) + JSONRenderer），无日志文件；Docker 部署侧 compose 无日志特殊配置（json-file driver），容器内无 docker.sock——页面上"展示和下载"必须先解决日志落盘。

## 设计目标

1. 日志双写：文件轮转落盘（5MB×3）+ stderr 原链路零扰动，本地/Docker 一致。
2. 两端点提供 tail 结构化读取与白名单文件下载，复用 system_status:read。
3. 页面删统计卡、日志卡满宽居底，5s 自动刷新、级别着色、展开原始行、可选历史文件下载（D-007@v1）。

## 非目标

- MUST NOT 日志脱敏/过滤/搜索/zip 打包（proposal 不在范围内清单）
- 不改容器日志与部署编排；不新增权限枚举与迁移
- 不做运行日志文件的外部轮转（logrotate 类）——由应用自身 FileWriter 负责

## 拆分判断

单变更不拆批：落盘（task-01）与端点（task-02）共享文件路径单点（logging.py 导出的常量），前端组件（task-03）与页面集成（task-04）同交付面；拆开会出现"端点读不到文件/页面缺组件"的中间态。

## 总体方案

**Wave 1（可并行两簇）**

簇 A · 后端日志落盘（task-01）：
- backend/app/core/logging.py：模块级常量 `LOG_FILE_NAME="backend.log"`、`LOG_MAX_BYTES=5_000_000`、`LOG_BACKUP_COUNT=3`；新增 `FileWriter` processor **复用同一 JSONRenderer 实例**渲染行文本（`self._renderer = JSONRenderer()`，调用 `self._renderer(logger, method, event_dict)` 取字符串写文件——不自行 json.dumps，保证与 stderr 输出逐字一致，含回溯等；注意 JSONRenderer 默认 ensure_ascii=True，中文以转义形态落盘/输出，解析后无损——与既有 stderr 行为一致）；插在 processor 链 JSONRenderer **之前**（D-006@v1）；超限轮转 rename 链；写失败捕获降级。`get_log_file_path()` 导出当前文件绝对路径（health 侧单一源消费）。
- **文件句柄策略（审查修正②）**：per-write `open(path, "a", encoding="utf-8")` 即开即关——常驻句柄在 Windows 会阻断 rename 导致轮转永久失败（永不轮转），即开即关是跨平台正确性要件（CLAUDE.md 规则 13）。
- 文件目录：backend/app/core/config.py 增 `log_dir: str = ""`；**解析走 paths.py 惯例（审查修正⑤）**——paths.py 增 `resolve_log_dir(raw)`（空=默认 `<repo_root()/data/logs` 绝对路径，非空相对值对 repo_root 解析，绝对路径原样），对齐 resolve_spec_data_root 模式；configure_logging 调 resolve_log_dir + mkdir(parents=True, exist_ok=True)，建目录失败降级 stderr-only（D-001@v1 故障面）。
- 轮转实现：`size + len(line) > max_bytes` 时 `.2→.3`、`.1→.2`、`log→.1`、新写 log；超 backup_count 的最旧已随 rename 链删除；rename 失败捕获（继续写当前文件，下一轮再试）。
- 测试 backend/tests/test_server_log_filer.py：小 max_bytes 注入触发轮转（异常路径）、**双写逐字一致（同一渲染实例：中文 event 下文件行 == stderr 行）**、写失败不抛（只读目录/非法路径）、configure 幂等、**轮转后句柄无残留（Windows 语义模拟：轮转后文件可立即被再次打开）**。

簇 B · 前端日志组件（task-03，可与 task-01/02 并行）：
- frontend/src/lib/health.ts：`getServerLogs(lines)`、`downloadLogFile(name)`（返回 Blob；**复用 explorer.ts:64-94 同型下载链路——fetch 带 Bearer + 401 单飞刷新重试（审查修正⑥），裸 URL 会 401**）。
- NEW:frontend/src/components/server-log-panel.tsx：日志卡组件（卡内独立 5s 轮询，与页面既有轮询并行不冲突——端点不同无竞态；页面「立即刷新」按钮不联动本卡（审查修正⑦）；日志请求失败→卡内独立错误条，不影响页面其它卡）。行数分段控件、级别着色行、点行展开原始 JSON、文件选择（数据源=响应 available_files）+下载按钮、安全提示、页脚「显示最近 N 行（文件共 M 行）」。
- 测试 NEW:frontend/src/components/__tests__/server-log-panel.test.tsx：渲染结构化行/非 JSON 降级/行数切换触发请求/展开原始行/下载调用 Blob/失败错误条。

**Wave 2（依赖簇 A）**

簇 C · 后端端点（task-02）：
- NEW:backend/app/modules/health/log_reader.py：白名单常量（文件名 4 项）、`read_log_tail(path, n)`（**实现修正③：文件封顶 5MB，全文按块流式读入 splitlines 得 total_lines，取尾 N 行——消除"只尾读"与"必返总行数"的张力**；文件缺失返回空态）、`parse_log_lines(raw_lines)`（JSON 成功→{time,level,event,fields}；失败→{raw, parse_error:true}）、`list_log_files()`（**消费方钉死（审查修正⑨）：作为 GET /api/server-logs 响应的 available_files 数据源**——存在的白名单文件+size+mtime）。
- backend/app/modules/health/router.py 增两端点（挂 `require_permission_any(Permission.SYSTEM_STATUS_READ)`，写法对齐 router.py:84-94 既有先例）：GET /api/server-logs（lines 白名单 {100,200,500,1000} 非白名单→200；响应 {entries, total_lines, returned, file, available_files, hint}——file=实际读取的文件名或 null、hint=空态提示文案（**审查修正④字段命名钉死，decisions 命名统一 total_lines（修正③）**））；GET /api/server-logs/download（file 白名单→FileResponse(media_type="text/plain", filename=原文件名)；非白名单→400；不存在→404 中文错误）。
- 测试 backend/tests/test_server_logs_api.py：tail 正确性（多行/空文件/文件不存在）、解析（JSON/非 JSON 混合降级）、lines 白名单回退、下载白名单防遍历（`../etc/passwd` 类→400）、三态鉴权（401/403/200）。

**Wave 3（依赖 Wave 1 簇 B 与 Wave 2）**

簇 D · 页面集成（task-04）：
- frontend/src/app/(dashboard)/admin/server-status/page.tsx：删除业务统计卡（StatCell 组件及其 SectionCard 与 status.tasks/projects/milestones/users 消费）；引入 ServerLogPanel 满宽置底（`lg:col-span-2`）；性能卡与依赖卡保持 grid 均分；副标题文案更新（"服务器性能、依赖状态与运行日志"）。
- frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx：删统计卡断言（128/12/45/8 四值、StatCell 相关），改为日志卡在场断言与不回归核对；聚焦回归 admin 域。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/core/logging.py | FileWriter processor + 常量 + get_log_file_path（producer：文件路径单点；consumer：health/log_reader） |
| 修改 | backend/app/core/config.py | log_dir 配置项（默认空=repo_root()/data/logs） |
| 修改 | backend/app/core/paths.py | resolve_log_dir(raw) 解析器（路径惯例，审查修正⑤） |
| 新增 | NEW:backend/app/modules/health/log_reader.py | tail 读取/JSON 解析/文件白名单 |
| 修改 | backend/app/modules/health/router.py | GET /api/server-logs + GET /api/server-logs/download |
| 修改 | backend/openapi.json | gen:types 契约导出（两新端点 schema 入生成物，规则 21） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成（ServerLogsResponse 类型，规则 21 禁手写） |
| 修改 | sillyhub-daemon/src/api-types.ts | gen:types daemon 端契约钉子（闸门⑨双端同提交，plan 审查 gap1 落实） |
| 修改 | .gitignore | 增 data/logs/ 忽略（日志运行产物不入版本控制，task-01 落盘配套） |
| 新增 | NEW:backend/tests/test_server_log_filer.py | 落盘/轮转/降级测试 |
| 新增 | NEW:backend/tests/test_server_logs_api.py | 端点测试（tail/解析/白名单/三态） |
| 修改 | frontend/src/lib/health.ts | getServerLogs/downloadLogFile 数据层（类型引用 api-types 生成物） |
| 新增 | NEW:frontend/src/components/server-log-panel.tsx | 日志卡组件 |
| 新增 | NEW:frontend/src/components/__tests__/server-log-panel.test.tsx | 组件测试 |
| 修改 | frontend/src/app/(dashboard)/admin/server-status/page.tsx | 删统计卡+集成本组件 |
| 修改 | frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | 断言更新（删统计卡/日志卡在场） |

## 接口定义

本变更接口面：2 新端点（均 health 模块）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/server-logs | query lines ∈ {100,200,500,1000}（非白名单回退 200）；响应 {file, entries[], total_lines, returned, available_files:[{name,size,mtime}], hint}；entries 项 = {time, level, event, fields} 或 {raw, parse_error:true}；鉴权 require_permission_any(SYSTEM_STATUS_READ) |
| GET | /api/server-logs/download | query file ∈ 白名单 {backend.log, backend.log.1, backend.log.2, backend.log.3}；FileResponse(media_type="text/plain", filename 原文件名)；非白名单 400、不存在 404 中文；鉴权同上 |

## 生命周期契约表

本变更无生命周期契约变更（不涉及 session/lease/agent_run/daemon/lifecycle/state transition/claim/heartbeat——日志文件写入与只读端点，无状态机）。

## 数据模型

无 schema 变更（无新表/字段/迁移）；新增磁盘文件面：`<log_dir>/backend.log[.1..3]`（轮转文件，非数据库资产）。

## 兼容策略（brownfield 必填）

- stderr 输出链路 MUST 零变化：FileWriter 插在 JSONRenderer 之前只写文件不改变返回的 event_dict；既有测试（test_health 等）不回归。
- configure_logging 幂等性保持（重复调用不重复挂 processor——实现按调用重置 structlog.configure 的既有语义）。
- 未配置 log_dir：默认路径自动派生，行为开箱即用；文件系统只读/目录不可建时降级 stderr-only（旧行为），日志卡显示空+提示。
- 旧页面行为：业务统计卡删除是用户裁决的目标行为（D-007@v1），非回归；system-status 端点字段不变（页面不再消费四项计数——后端响应结构零变化）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 5s 轮询下全文读（含 total_lines 计数）在 5MB 上限文件的开销 | P2 | 单文件 5MB 封顶 + 按块流式读（不一次性载入）；实测毫秒级，轮询面可接受 |
| R-02 | 多 worker（uvicorn workers>1）并发写同一日志文件交错 | P3 | 部署为单 worker（现状 compose 未启多 worker）；轮转 rename 竞争概率低且损坏面=个别行交错 |
| R-03 | 日志含敏感信息被下载外传 | P2 | D-005@v1 页面固定提示；权限面=系统管理区管理员；文件名白名单防遍历 |
| R-04 | Windows 下文件重命名（轮转）被占用失败 | P2 | rename 失败捕获降级（继续写当前文件）；测试覆盖只读/占用场景 |
| R-05 | 既有 test_health 等依赖 configure_logging 的用例受 processor 链改动影响 | P2 | FileWriter 无路径配置时（log_dir="" 且默认建目录失败）不改变链行为；聚焦回归 test_health |
| R-06 | page.test.tsx 删统计卡断言后余留死代码（StatCell） | P3 | task-04 一并删除 StatCell 组件定义（探针 1 未实现标记扫描兜底） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01 · 簇 A | accepted（用户亲选） |
| D-002@v1 | FR-02, FR-04 · 簇 B/D | accepted（用户亲选） |
| D-003@v1 | FR-03, FR-04 · 簇 C/D | accepted（用户亲选） |
| D-004@v1 | 鉴权口径 · 簇 C | accepted（用户亲选） |
| D-005@v1 | 安全提示 · 簇 B | accepted（AI 定案） |
| D-006@v1 | FR-01 实现 · 簇 A | accepted（用户亲选） |
| D-007@v1 | FR-04 布局 · 簇 D | accepted（用户亲选） |
| D-008@v1 | 参数口径 · 簇 A/C | accepted（AI 定案） |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-008 全列）
- [x] 生命周期契约豁免短语已写（紧邻标题）
- [x] UI 原型分级核对：新增组件/交互=必须生成档，prototype-server-logs.html 已落变更目录（含删卡后布局+日志卡全要素）
- [x] 无未标注的自审存疑项
