---
author: qinyi
created_at: 2026-09-14 13:38:08
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-14-session-export

## 背景

平台会话（`AgentSession` + `AgentRun` + `AgentRunLog`）承载了用户与 Agent 的全部协作过程，但当前**没有任何导出能力**：用户想把某次会话的对话记录留档、分享给同事、或贴给别的 AI 继续处理时，只能截图或手动复制。会话域目前零导出端点（全仓 grep 仅 ppm 域有 export-excel 先例）。

用户需求：**一键导出选中的会话**，分两档——「对话」（用户/助手消息文本）与「完整」（再加思考过程、工具调用、轮次元数据、token 用量、附件）。

## 设计目标

- FR-01 会话列表多选后可一键导出选中会话；单会话也可从行级操作导出
- FR-02 两档内容：
  - **chat 档（Markdown）**：会话头（标题/时间/runtime/轮数）+ 按 run 分轮的用户与助手文本；群聊发言带成员名前缀；附件保留 `[附件:名|类型]` 标记行。**正文来源按生产 channel 词汇表派生**（`AgentRunLog.channel` 为普通字符串列，取值仅 `stdout/stderr/tool_call/pending_input/user_input/system`，无 `assistant`/`user` 值——前端 `AgentRunLogChannel` 联合类型即此词汇表，Grill P0 修正）：`user_input` 行=用户消息；`stdout` 行经噪声排除后=助手正文
  - **full 档（JSON + zip）**：会话元信息 + 每轮模型/token 用量/时间/状态 + 全部日志原字段（含 thinking/tool_call/edit_patch/metadata_）+ 任务卡 + 附件清单 + 附件原文件（`attachments/` 目录）
- FR-03 导出权限对齐**详情端点口径**（`get_agent_session`：owner 制 + 软删 404）：普通会话 owner 制，群会话参与者/workspace admin 可访问（`get_group_accessible_session`），越权/已软删一律 404 不泄露存在性
- FR-04 前端导出中 loading、成功浏览器直接下载、失败 `message.error`
- FR-05 `pnpm gen:types` 同步（POST body schema 进 `api-types.ts` + `openapi.json` 提交）

## 非目标

- 不做移动端 `m/` 页与悬浮窗（floating-session-host）的导出入口（YAGNI，桌面先行）
- 不做导出历史/定时导出/服务端归档（纯按需一次性下载）
- 不做异步任务 + 文件中心（D-001@v1 已否决；超大会话场景未来有需求再立新变更）
- 不做会话恢复/导入（导出是单向的）
- 不导出排队中消息（`agent_session_queued_messages`）与定时消息——它们尚未成为对话事实；任务卡（`agent_session_task`）属 full 档

## 拆分判断

单一功能变更（一个导出能力横跨 backend/frontend），无跨模块状态机/schema 迁移，不需要拆多个 change；规模 large（backend 新 2 文件 + schema 扩展、frontend 列表组件 + portal 接线 + 新 lib 文件、类型再生成）走四件套完整流程而非 quick。

## 总体方案

**Wave 1（后端）**：schema → service（组装 + 权限 + 附件）→ router（含挂载顺序）→ pytest。

**Wave 2（前端）**：`lib/daemon/session-export.ts` 认证下载 → `session-list-panel.tsx` 双入口 UI（批量栏 Dropdown + 行 hover 图标）→ `sessions-portal.tsx` 接线 → vitest。

**Wave 3（收口）**：`pnpm gen:types` 同步 + 全链路手验。

### 后端设计

- 端点：`POST /api/daemon/sessions/export`，body `SessionExportRequest`。选 POST 不选 GET：多会话 id 列表（≤50 个 UUID ≈ 1.8KB）放 query 有 URL 长度风险，body 无此问题；下载通道用 fetch+blob 对 POST 无障碍。
- 响应矩阵（Content-Disposition 全部 RFC5987 中文文件名，参照 `ppm/common/export.py` 模式在 daemon 域自建轻量 helper，不跨模块 import ppm）：

| 场景 | Content-Type | 产物形态 |
|---|---|---|
| chat × 单会话 | `text/markdown` | `{标题}_{id前8}.md` |
| chat × 多会话 | `application/zip` | zip 内每会话一个 `.md` |
| full × 单会话 | `application/zip` | `{标题}_{id前8}/full.json` + `attachments/{附件id}_{原名}` |
| full × 多会话 | `application/zip` | 每会话一目录（标题 + id 前 8 位防重名） |

  zip 文件名统一 `会话导出_{档位中文}_{YYYYMMDD_HHMMSS}.zip`；md 单文件同名模式。
- 权限：逐会话对齐详情端点口径——`AgentSession.user_id == 当前用户` 且 `deleted_at IS NULL`；未命中再走 `get_group_accessible_session`（参与者/workspace admin，含 `allow_shadow_member_read` 影子成员读，同 `get_agent_session_logs` 的探测顺序）。注：logs 端点的 owner 探测不过滤软删（`backend/app/modules/daemon/session/service/read_model.py:340-347`），导出**选详情口径**（软删 404）。任一会话不可访问则整个请求 404（单条语义清晰；不做部分成功，避免用户以为导全了）。
- chat Markdown 组装：按 `AgentRun`（`agent_session_id` FK 聚合，**绝不**用 `AgentRun.session_id`——resume id 语义不同，这是 `read_model.get_agent_session_logs` 明确标注的坑）分轮；轮内正文派生规则：
  - `user_input` 行 → 用户消息（附件标记行原样保留；群聊行从 `metadata_` 取 `member_name` 做前缀）
  - `stdout` 行 → **经噪声排除后为助手正文**。排除/剥离规则与前端装配器同源对齐（锚点 `frontend/src/components/daemon/session-log-assembler.ts:288-366` `classifySessionLog`），后端独立实现为纯函数 helper `_assistant_text_from_stdout()`：跳过空行、含 `AskUserQuestion` 行、`[TOOL_RESULT]` 全部文本行（通用形态与 `User answered` 形态，前端均归 tool_result 段不进正文）、`[(SYSTEM|RESULT)...]` 前缀行、`[TOOL_USE]` 文本行（daemon 双发，tool_call JSON 为权威源）、`[TASK_*]` 任务生命周期行、技能装载载荷行（`[ASSISTANT] Base directory for this skill:`）、CLI 合成鉴权/网关错误行、`[ASSISTANT_OVERRIDE]`/`[THINKING_OVERRIDE]` 撤回标记行（不渲染正文）；`[THINKING]` 前缀行 chat 档排除（属 full 档）；幸存行剥 `[ASSISTANT]`/`[LOG:\w+]` 前缀后作为助手正文。该规则用表驱动测试固化（样例直接搬 `__tests__/session-log-assembler.test.ts` 判定用例），防止与前端语义漂移
  - `stderr`/`tool_call`/`pending_input`/`system` 行不进 chat 档（full 档全保留）
- full JSON 组装：`session`（id/title/runtime/provider/status/时间/轮数/config_snapshot 概要）+ `runs[]`（模型/状态/起止/输入输出 token/diff_summary/error_code）+ `logs[]`（全字段：channel/content_redacted/timestamp/tool_kind/parent_tool_use_id/subagent_type/depth/edit_patch/metadata_）+ `tasks[]`（agent_session_task）+ `attachments[]`（元数据清单）+ `truncated` 标记。
- 行数上限：导出独立上限 **20000 行**（不沿用回放 5000）。口径（Grill P1-2 补定义）：「行」= `agent_run_logs` 行；**每会话独立**计数（非整包合计）；超限**保最早** 20000 行（导出从对话头开始，与回放接口「保最新」语义相反，归档场景上下文完整性优先），文件尾标注 `truncated: true` 与丢弃行数。
- 附件打包：full 档按 `session_attachments` 查询（session_id 维度），经 `SessionAttachmentStorage.read_bytes(object_key)` 取本体写入 zip；单个附件读取失败（对象丢失/存储异常）降级为在 `attachments[]` 清单标 `"missing": true` 并继续，**不整体 500**。附件本体单件 ≤20MB 是既有上传上限；**整包附件总量 >512MB 时返回 413**（明确错误信息提示分批导出，防 50 会话 × 多附件的 GB 级响应）。
- zip 条目名：标题 sanitize（去 `\/:*?"<>|`、控制符、Windows 保留设备名 CON/PRN/AUX/NUL/COM1-9/LPT1-9，修剪结尾点/空格，空/全非法回退「未命名会话」）+ id 前 8 位后缀防重名（前 4 位在 50 会话下碰撞率约 2%，Grill P2 修正）。
- CPU 密集部分（zip/json/md 序列化）参照 ppm 先例用 `anyio.to_thread.run_sync` 包裹防阻塞事件循环。
- 路由挂载：`daemon/router/__init__.py` 的有序挂载列表中，`export_sessions` 必须插在 `list_sessions`/`stream_sessions_events` 一侧（字面量 `/sessions/export` 前置于参数路由 `/sessions/{session_id}`——ppm export-excel 同类坑已在知识库登记）。

### 前端设计

- `lib/daemon/session-export.ts`：`exportSessions(ids: string[], tier: "chat" | "full"): Promise<void>`——裸 fetch POST JSON（Bearer token；401 → `ensureFreshAccessToken` 单飞刷新后重试一次，照抄 `lib/ppm/export.ts downloadExcel` 骨架但不改 ppm 文件防回归），从 `Content-Disposition` 解析 RFC5987 文件名，blob + `<a download>` 触发保存。
- UI（`session-list-panel.tsx`）：
  - 批量操作条（batchActive 时）追加「导出选中（N）」按钮 + antd Dropdown 两项：「导出对话（Markdown）」「导出完整信息（JSON+附件）」；与删除/归档按钮同 size="small" 风格。
  - 行 hover 操作列加下载图标按钮（与置顶/重命名/归档同款 `h-5 w-5` icon button，lucide `Download` 图标），同款档位 Dropdown。
  - 导出中按钮 `loading={exporting}`；成功后 antd `message.success("已开始下载 …")`；失败 `message.error`。
- `sessions-portal.tsx` 接线：新增 `onExportSessions(ids, tier)` 回调（与现有 `onDeleteSessions` 等同模式，:714-796 区域），组件内部持 `exporting` state。
- 多选限制照现状：一次只能在一个组内多选（`batchGroupId` 机制不变，导出遵守同一约束）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/daemon/router/session_export.py | POST /sessions/export 端点：参数校验（ids 1~50 去重、tier Literal）、调 facade、按响应矩阵回 StreamingResponse/Response（RFC5987 文件名） |
| 新增 | NEW:backend/app/modules/daemon/session/service/export.py | 模块函数 `export_sessions(svc, user_id, *, session_ids, tier)`（**照 read_model.py 模块函数先例**，Grill P1-1 修正：不用 mixin——session/service 包既定组织是子模块函数 + `SessionService` 类壳一行委托）+ `_render_chat_markdown()` / `_render_full_json()` / `_assistant_text_from_stdout()`（噪声排除纯函数）/ `_rfc5987_filename()` / `_sanitize_zip_name()` helper |
| 修改 | backend/app/modules/daemon/session/service/__init__.py | `SessionService` 类壳新增 `export_sessions` 一行委托到 export 模块函数（不接线则 facade 调不到；Grill 指出原清单遗漏本文件） |
| 修改 | backend/app/modules/daemon/schema.py | 新增 `SessionExportRequest`（session_ids: list[UUID] min 1 max 50、tier: Literal["chat","full"]）。数据流：producer=本 schema → FastAPI OpenAPI → `pnpm gen:types` → consumer=前端 `api-types.ts`（session-export.ts 起步用本地类型（形状与 schema 一致），task-08 gen:types 后如需切生成类型允许触碰该文件） |
| 修改 | backend/app/modules/daemon/service.py | `DaemonService` 增 facade 方法 `export_sessions(user_id, request, storage)` 转发 `SessionService`（照 `get_agent_session_logs` 转发先例 :1077，storage 一并透传） |
| 修改 | backend/app/modules/daemon/router/__init__.py | 有序挂载列表插入 `export_sessions`（`/sessions/export` 字面量前置于 `/sessions/{session_id}` 参数路由） |
| 新增 | NEW:backend/tests/modules/daemon/test_session_export.py | pytest：chat md 内容断言（含 stdout 噪声排除表驱动用例）/多会话 zip 结构/full json 字段全/权限 404（跨用户+软删+群非成员）/附件缺失降级/413 总量超限/truncated 标记/路由顺序冒烟（路径以 execute 时现有测试布局为准） |
| 新增 | NEW:frontend/src/lib/daemon/session-export.ts | `exportSessions(ids, tier)`：POST fetch + Bearer + 401 刷新重试 + Content-Disposition 解析 + blob 下载（骨架照 lib/ppm/export.ts，不改动 ppm 文件） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 批量栏加「导出选中（N）」Dropdown；行 hover 操作列加 Download 图标 + 同款 Dropdown；新增 `onExportSessions` prop；`exporting` state |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | 接线 `onExportSessions` → `exportSessions()`（:714-796 回调区，照 deleteSessions 模式） |
| 修改 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（已存在，Grill 核实） | vitest 追加用例：批量栏导出按钮渲染+菜单项触发回调+行级图标入口 |
| 重新生成 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types` 同步 `SessionExportRequest` 类型 |

## 接口定义

```python
# backend/app/modules/daemon/schema.py
class SessionExportRequest(BaseModel):
    session_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)
    tier: Literal["chat", "full"]

# backend/app/modules/daemon/session/service/export.py（核心签名；模块函数风格照 read_model.py 先例）
async def export_sessions(
    svc,  # SessionService 实例（复用 svc._session 数据库会话）
    user_id: uuid.UUID,
    *,
    session_ids: list[uuid.UUID],
    tier: Literal["chat", "full"],
    storage: SessionAttachmentStorage,  # router 层 Depends 注入（execute 时按 session_attachment 现有依赖形态接线）
) -> SessionExportResult:  # dataclass: media_type, filename, payload(bytes)
    ...

def _render_chat_markdown(session: AgentSession, runs: Sequence[AgentRun], logs: Sequence[AgentRunLog]) -> str: ...
def _render_full_json(session, runs, logs, tasks, attachments_meta, *, truncated: bool, dropped_rows: int) -> dict: ...
def _assistant_text_from_stdout(content: str) -> str | None: ...  # 噪声排除纯函数（对齐前端 classifyStdoutLine 语义）

# backend/app/modules/daemon/session/service/__init__.py（SessionService 类壳一行委托）
class SessionService(...):
    async def export_sessions(self, user_id, *, session_ids, tier, storage): return await export.export_sessions(self, user_id, session_ids=session_ids, tier=tier, storage=storage)

# backend/app/modules/daemon/router/session_export.py
@router.post("/sessions/export")  # 挂载顺序：前置于 /sessions/{session_id}
async def export_sessions(payload: SessionExportRequest, user: TaskRunAgentUser) -> Response: ...
# 鉴权闸门用 TaskRunAgentUser（daemon 会话端点既定惯例，backend/app/modules/daemon/router/session_insights.py:464 注释明示对齐）
```

```typescript
// frontend/src/lib/daemon/session-export.ts
export type SessionExportTier = "chat" | "full";
export async function exportSessions(sessionIds: string[], tier: SessionExportTier): Promise<void>;
// 401 → ensureFreshAccessToken() 单飞刷新 → 重试一次；失败 throw（调用方 message.error）
```

full JSON 产物顶层结构（版本化，便于未来演进）：

```json
{
  "export_version": 1,
  "session": {"id": "…", "title": "…", "runtime_id": "…", "provider": "…", "status": "…", "created_at": "…", "last_active_at": "…", "turn_count": 12},
  "runs": [{"id": "…", "status": "…", "model": "…", "started_at": "…", "finished_at": "…", "input_tokens": 0, "output_tokens": 0, "diff_summary": null, "error_code": null}],
  "logs": [{"id": "…", "run_id": "…", "timestamp": "…", "channel": "…", "content_redacted": "…", "tool_kind": null, "parent_tool_use_id": null, "subagent_type": null, "depth": 0, "edit_patch": null, "metadata": null}],
  "tasks": [{"task_name": "…", "status": "…", "summary": "…"}],
  "attachments": [{"id": "…", "name": "…", "kind": "image", "media_type": "…", "bytes": 0, "zip_path": "attachments/101_截图.png", "missing": false}],
  "truncated": false,
  "dropped_rows": 0
}
```

## 生命周期契约表

不涉及生命周期契约（导出为只读能力：不创建/不修改 session、run、lease 的任何状态，仅读取既有日志行；「session」关键词命中但无状态迁移事件）。

## 数据模型

无 schema/表结构变更。只读复用：`agent_sessions`、`agent_runs`、`agent_run_logs`、`agent_session_task`、`session_attachments`（附件本体经 `SessionAttachmentStorage.read_bytes` 从对象存储读）。

## 兼容策略（brownfield 必填）

- 纯新增端点 + 纯新增前端入口，不改任何既有 API/表结构/既有组件行为
- 未使用导出功能时零行为变化（批量栏仅多一个按钮，行 hover 仅多一个图标）
- 导出失败不影响列表其余操作（独立 state，不共享 deleting/archiving）
- OpenAPI 只增不改；`api-types.ts` 再生成对既有类型零破坏（预期 gen:types 零内容差于旧类型）

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | `/sessions/export` 被参数路由 `/sessions/{session_id}` 抢匹配（ppm 同类坑已登记知识库） | P0 | 有序挂载列表显式前置 + 路由顺序冒烟测试固化 |
| R-02 | 超大会话导出占满内存/事件循环（50KB×N 行 + 附件流） | P1 | 20000 行独立上限 + truncated 标记；zip/json/md 序列化走 `anyio.to_thread`；附件单件 ≤20MB 既有上限兜底 |
| R-03 | 附件对象丢失（MinIO 误删/迁移）导致导出 500 | P1 | 单附件 try/except 降级 `missing: true`，整包继续 |
| R-04 | 群聊会话权限口径与列表不一致（漏放行/越权） | P0 | 复用 `get_group_accessible_session` 现成探测链，不新写权限逻辑；测试覆盖群成员/非成员/影子成员 |
| R-05 | zip 内文件名非法字符（Windows 保留名/控制符/重名） | P2 | 标题 sanitize（含保留设备名与结尾点/空格修剪、空回退）+ id 前 8 位后缀防重名 |
| R-06 | 前端 401 过期中断大导出下载 | P2 | 复用单飞刷新重试一次骨架（downloadExcel 已验证模式） |
| R-07 | scan 文档已落后源码（2427 commit），本文档引用的行号/结构在 execute 时漂移 | P2 | execute 以 grep 现状为准；本文档引用已按 2026-09-14 源码核对 |
| R-08 | chat 档 stdout 噪声排除与前端 classifyStdoutLine 语义漂移（误吞正文/漏滤噪音） | P1 | 排除规则独立纯函数 + 表驱动测试固化（用例直接搬前端 session-log-assembler.test.ts 的判定样例）；注释互指锚点，两边改动时相互提示 |
| R-09 | full 档整包附件总量无上限（50 会话 × 多附件可达 GB 级响应） | P2 | 附件元数据 bytes 预聚合，总量 >512MB 返回 413 + 明确提示分批导出（预检查在取流之前，不产生半包浪费） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 同步流式导出 | 总体方案·后端设计（POST 端点 + 响应矩阵）、接口定义 | 已覆盖 |
| D-002@v1 双格式 + 附件按档位区分 | FR-02、总体方案·后端设计（chat md / full json+zip+attachments/）、非目标（不做导入） | 已覆盖 |

无未解决决策；无剩余风险超出 R-01~R-09。

**给 plan 的实现提示**（复审记录）：「保最早 20000 行」需自建 `timestamp ASC + limit` 查询，不能直接复用 `get_agent_session_logs` 的「newest-N 再反转」语义（`backend/app/modules/daemon/session/service/read_model.py:404-418?`）；导出查询照其 join/权限骨架另写 asc 变体。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（D-001/D-002 均入决策追踪表）
- [x] 涉及生命周期关键词 → 已写紧邻豁免短语（只读无状态迁移）
- [x] UI 原型分级核对：组件级 UI 变化（批量栏按钮 + 行图标 + Dropdown，页面骨架不变）→ 按分级规则生成 `prototype-session-export.html`（含双主题切换 + 交互流程 + 产物结构预览）
- [x] Design Grill（independent 子代理）P0/P1 全部采纳修正：chat 档 channel 词汇表按生产值重写（stdout 派生 + 噪声排除规则与前端同源，R-08 固化）；服务组织改模块函数 + 补 `session/service/__init__.py` 接线行；20000 行口径三元组定义（log 行/每会话/保最早）+ `dropped_rows` 字段；id 前 8 位防重名；FR-03 对齐详情口径表述；测试路径 `__tests__/`。P2 项（保留名 sanitize/413 总量上限/Dropdown 首例/storage 注入说明）一并落进对应章节与 R-09
- [x] Grill 自审存疑 3 项全部闭环：`agent_session_task` 有既有读端点（GET /sessions/{id}/tasks，backend/app/modules/daemon/router/session_insights.py:326?）；测试文件 `session-list-panel.test.tsx` 已存在于 `__tests__/` 目录；backend 测试目录布局留 execute 核实（风险登记 R-07 兜底）
