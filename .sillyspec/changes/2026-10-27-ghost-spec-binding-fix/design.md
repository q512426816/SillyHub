---
author: flow-machine-draft
created_at: 2026-10-27T00:51:08.037Z
---
# 设计记录（Design Record）— 2026-10-27-ghost-spec-binding-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因（2026-10-27 会话 9d190177 实证）：`sillyspec flow start --change task-wakeup-precision-fix`（缺日期前缀）被 CLI exit 2 拒绝，但平台命令解析绑定通道（`binding.py`）只解析命令文本不看执行结果，为该名字建出 placeholder 变更行（draft/active/无文档）+ 会话链接；该名字永远无文件系统目录，reparse 删除环又因"从未同步过文档的占位行保护"不收敛，幽灵条目永挂会话弹窗「进行中」。本变更双层修复：

1. **写侧防新增**（`binding.py bind_session_to_change`）：查库未命中且名字不带日期前缀（CLI 强制规则，必被 exit 2 拒）→ 跳过建行，log.warning + 返回 None。选「查库未命中」作校验前提是为了兼容历史旧格式名变更——CLI 明确"已存在的旧名变更不受影响"，已有行照常绑定（校验下沉到 bind 函数而非纯解析函数 `extract_spec_bindings` 的原因：后者不查库，无法区分"旧名已有行"与"无前缀必被拒"）。
2. **读侧兜底存量**（`service.py list_changes_for_session`）：过滤「draft + active + 无 change_documents + created_at 超 30 分钟」四条件同时满足的行。覆盖写侧拦不住的残留（带前缀但 `--input` 不合规被拒、本次事故已落库的存量幽灵、本地库 2026-07-07 `default` 历史残留）。存量数据无需清理脚本，读侧过滤即时生效。

放弃的方案：①绑定通道感知命令成败——tool_call/tool_result 帧均无结构化 exit code / is_error 字段（会话导出 full.json 实证，仅 tool_result.content 文本以 "Exit code N" 开头），文本解析脆弱且 tool_result 可能跨批上报（绑定在收口时刻发生，时序不可靠）；②reparse 删除环收编幽灵——占位保护（7 天窗）与墓碑豁免逻辑交错，动删除环影响面大且全量 reparse 低频，时效差；③一次性 SQL 清理存量——读侧过滤已让幽灵不可见，无需触达生产库。

用户执行期扩面（D-001@v1，2026-10-27 会话插入）：弹窗实时性一并修复——「真实创建成功的变更没能立刻展示、失效变更没能立刻消失、要刷新页面才回显」。定性：`useSessionChanges` 轮询策略 `refetchInterval: active ? 15_000 : false`——弹窗未打开时零刷新（徽标数/列表滞留旧值直至组件重挂载），打开瞬间 staleTime 10s 内直用缓存且 interval 要等 15s 首跳。第三层修复（前端）：关闭态改 30s 低频轮询保底（挂载面单实例 session-panel-page 一处，轻 JOIN 接口，请求量可忽略）+ 打开下拉/弹窗时立即 refetch（所见即最新），打开态 15s 轮询不变。

用户第二份会话导出实证**第二条幽灵通道**（D-002@v1）：会话 5f088f10（调查会话自身）弹窗在 08:51 又出现一条 `task-wakeup-precision-fix` 全量/未开始——根因是 `iter_command_segments` 按 `&&`/`;`/`|`/换行分段**不感知引号**，该会话 `flow start` 的 `--input` 引号长文本里引用了示例命令「sillyspec flow start --change task-wakeup-precision-fix」，引号内文本被切成独立"命令段"，`extract_spec_bindings` 对段中 token 序列的**中缀容忍匹配**（原注释允许"包装剥除后残留 exec 等中缀"被泛化成任意位置命中）误解析出幽灵绑定。第四层修复（仍在 binding.py）：run/flow 两族 `sillyspec` 定位收紧为**段首 token 或紧随 `exec`**——引号内文本所在段首是中文描述 token，不再命中；`pnpm exec sillyspec` 剥包装后 exec 中缀容忍保留，零回退。不改共享分段函数 `iter_command_segments`（tool_kind 打标同源消费，引号感知属行为重写）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `bind_session_to_change(db, workspace_id, change_key, session_id) -> uuid.UUID | None`：新增拒绝分支——查库未命中 + `change_key` 不匹配 `^\d{4}-\d{2}-\d{2}-` 时返回 None（此前该输入建 placeholder 返回新 id）。既有调用方（`submit_commit.py` 绑定块、`backfill_service.py`）返回值已按可空处理，零适配。
- `extract_spec_bindings(command) -> list[SpecCommandBinding]`：签名不变；匹配语义收紧——run/flow 两族的 `sillyspec` token 必须是段首或紧随 `exec`（原实现允许 token 序列出现在段中任意位置）。引号内字面量文本不再产出绑定；`pnpm exec sillyspec` / `pnpm sillyspec` 等包装形态保留（剥包装后 exec 中缀 / 段首）。`tool_kind.classify_tool_kind` 消费的是 `iter_command_segments`（分段函数不动），打标行为零变化。
- `GET /api/workspaces/{wid}/changes/-/by-session/{sid}`（`list_changes_for_session`）：返回集合新增幽灵过滤规则（四条件同时满足才滤），响应 schema 不变。
- `useSessionChanges(workspaceId, sessionId, options?: { active?: boolean })`（`frontend/src/lib/changes.ts`）：轮询策略改为 `refetchInterval: options?.active ? 15_000 : 30_000`——关闭态从「false 不轮询」变「30s 低频轮询」，参数签名与返回类型不变，既有消费方零适配。
- `SessionChangeFilesHover`（`session-change-files-hover.tsx`）：消费 `useQuery` 返回的 `refetch`，在 Popover `onOpenChange` 打开沿与 Dialog 打开时各触发一次立即拉新；渲染逻辑不变。
- 新增模块级常量：`binding.py` 编译正则 `_DATED_CHANGE_KEY_RE`；`service.py` 阈值 `_GHOST_PLACEHOLDER_MIN_AGE = timedelta(minutes=30)`。
- 对外行为变化两处可感知：①失败命令的幽灵条目不再出现（写侧不再建、读侧滤存量）；②新变更出现/失效变更消失最迟 30 秒自动回显（无需刷新页面），打开面板瞬间即最新。真实变更内容展示零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

镜像文档同步与命令解析绑定到达顺序不保证——真实 `flow start` 后绑定（秒级）先于文档落库（daemon 同步周期）是常态。读侧 30 分钟 TTL 即为此窗口设计：窗口内不过滤，文档到达后四条件自然不满足；文档长期未到（daemon 离线）时该行被暂时隐藏，文档一到即恢复显示，无永久误伤。段首收紧对乱序免疫（纯命令文本解析，与到达时序无关）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

bind 走 `begin_nested` savepoint + flush（现状不变），拒绝分支在同一 savepoint 内正常 return（无脏数据可回滚）；两会话并发绑同名——既有行则都走 link 幂等路径，都无行则各自建行受 unique 兜底（现状语义，本变更未触碰）。读侧过滤是纯读投影，无写竞态。段首收紧是纯函数行为变化，无并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

拒绝分支返回 None 后，`submit_commit.py` 的 `current_change_id` 回写块已有 `is not None` 守卫，自然跳过；存量幽灵行留在库中不删（R-09 审计保护口径——软删/物理删留给既有删除环），仅读侧不投影，链接行保留不影响其他页面（变更中心列表口径独立）。本会话 08:51 误建的第二条幽灵在修复部署后由读侧 TTL（30 分钟）自动消失，无需手工清库。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

过滤仅作用于 `list_changes_for_session` 单会话查询内部，不改变变更中心 / 归档 tab / usage 统计等其它读路径；日期前缀正则对 workspace 无耦合（CLI 规则全局统一）；多实例部署下各实例共享同一 DB 行为一致。前端轮询 hook 按 `(workspaceId, sessionId)` queryKey 隔离，多会话页签/多实例互不串台；30s 关闭态轮询只影响挂载了该组件的会话页（当前生产挂载面单实例 session-panel-page），不触达其它页面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：读侧过滤误伤"真实变更但文档 30 分钟未到"的极端场景（daemon 长期离线 / 同步链路故障）——该行会话弹窗暂时消失，文档同步后自动恢复；代价可接受且有 FR-05 窗口护栏。次风险：①日期前缀规则若 CLI 未来放宽（允许无前缀名），写侧会拒绑真实变更——复潮条件明确（CLI 规则变更须同步本处），已在代码注释锚定 CLI 错误文案为规则来源；②关闭态 30s 轮询增加常驻请求量——挂载面单实例 + 接口为 limit 200 的轻 JOIN 查询，量级可忽略，若未来多实例化再评估退回事件推送；③段首收紧若存在未知的合法"段中 sillyspec"调用形态会漏绑——已知合法形态仅段首与 exec 中缀（iter_command_segments 剥包装语义决定），样例库回归锁行为，漏绑风险限于新形态且绑定有 reparse 文档兜底。死路：①解析 `tool_result.content` 文本判断命令成败——"Exit code N" 是 daemon formatter 表现层格式，无结构化契约，格式一变即静默失效（放弃）；②把校验放 `extract_spec_bindings` 的名字格式上——纯函数查不了库，会误拒历史旧格式名的合法绑定（放弃，校验下沉 bind 函数）；③实时性走 WebSocket/SSE 事件推送——需后端新增变更生命周期事件源 + 前端订阅管线，三端改动大，30s 轮询 + 打开即拉新已满足"无需刷新页面"诉求（放弃，留作后续演进）；④给 `iter_command_segments` 加引号感知分段——它是 tool_kind 打标与绑定解析的共享底座，行为重写波及打标一致性（TS 版逐字对齐约束），段首收紧以 1/10 的改动面达成同等防护（放弃）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/binding.py | `bind_session_to_change` 新增无前缀未命中拒绝分支 + `_DATED_CHANGE_KEY_RE` 常量 + docstring 补规则来源 |
| 修改 | backend/app/modules/change/service.py | `list_changes_for_session` 新增幽灵占位过滤（批量 docs IN 查询 + 30 分钟 TTL）+ `_GHOST_PLACEHOLDER_MIN_AGE` 常量 |
| 修改 | frontend/src/lib/changes.ts | `useSessionChanges` 轮询策略：关闭态 false→30_000，打开态 15_000 不变 |
| 修改 | frontend/src/components/daemon/session-change-files-hover.tsx | 消费 `refetch`：下拉打开沿与 Dialog 打开时立即拉新 |
| 修改 | backend/app/modules/change/tests/test_spec_binding.py | 新增 FR-01/FR-03 两个 DB 级用例（拒绝无前缀新名 / 旧格式名已有行照绑） |
| 修改 | backend/app/modules/change/tests/test_session_changes_endpoint.py | 新增 FR-04/05/06 三个端点级过滤用例 |
| 修改 | frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | 新增轮询策略/打开即拉新用例（FR-08/09/10） |
