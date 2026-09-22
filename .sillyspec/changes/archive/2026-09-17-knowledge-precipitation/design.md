---
author: qinyi
created_at: 2026-09-17 09:56:34
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-17-knowledge-precipitation

## 背景

平台知识库页（/workspaces/{id}/knowledge）现状是**纯只读**：backend knowledge 模块实时解析 spec_root 下 `knowledge/` 目录**第一层**的 `*.md`（`backend/app/modules/knowledge/parser.py 的非递归 glob` 非递归 `glob("*.md")`），无 DB 无索引；知识的产生只能靠 agent 在会话里跑 sillyspec CLI（archive 蒸馏 / `knowledge propose` / decision-distill）后经上行同步回流。

两个实证问题（workspace b97f8231，repo-native junction 直连主仓 `.sillyspec`）：

1. **子目录知识不可见**：本地 `knowledge/` 有 7 个顶层 md + `decisions/`（13 个决策文件）+ `generated/`（39 个自动生成知识），但网页永远只显示顶层 md——与 sillyspec CLI 的 zone 口径（generated/、proposed/、decisions/）不一致。
2. **平台侧无沉淀能力**：用户明确要求"知识库应该可以直接记录转换生成真实知识沉淀，参考 sillyspec 工具的能力"——会话记录、变更归档这些平台最核心的记录资产，没有任何入口转成知识。

## 设计目标

1. **读侧对齐 CLI 口径**：知识库列表递归展示 `knowledge/` 全部子目录条目，按 zone 分组（待审核 proposed / 手册顶层 / 决策库 decisions / 自动生成 generated）。
2. **平台直写底座**：backend 获得知识写入能力（候选新增 / 条目编辑 / 审核合并 / 拒绝），全部走 spec_workspace 单写者语义（manifest 行版本 +1、spec_version bump、旧内容 30 天备份）。
3. **蒸馏派发**：从平台选会话记录或已归档变更，派发 agent 后台任务提炼候选知识（agent 跑 `sillyspec knowledge propose`，产物经现有上行同步回流）。
4. **审核闭环**：候选 → 人工审核 → 合并进正式知识文件（追加 `##` 小节 + INDEX.md 路由行，复刻 CLI classify 语义）→ 各端经现有 spec 同步看到同一份。

## 非目标

- 事件复盘（incident postmortem）转知识——v1 不做（D-001）。
- daemon 代写队列作为知识写路径（D-005 已否决）。
- 平台独立知识存储（DB/对象存储）——知识只落 `.sillyspec/knowledge/` 树（D-003）。
- 决策库 decisions/ 的网页编辑（由归档流程幂等维护，v1 只读，D-006）。
- 全文搜索引擎 / 向量检索 / 知识评分推荐。
- 知识条目评论、多人协作审核流（审批人角色等）。
- 后端直调 LLM 蒸馏（D-002 已定派发 agent 会话，不另建后端蒸馏实现）。

## 拆分判断

本变更达到拆分阈值（4 个可独立交付模块：读侧修复 / 写路径底座 / 蒸馏派发 / 审核流；含跨页面状态流转），但**选择单变更分 Wave 交付**：四模块共享同一批底座——zone 数据模型（parser/前端分组）、apply_ops 写语义（手工录入、编辑、合并都走它）、候选文件格式（proposed frontmatter）——拆成多 change 会产生跨变更接口债与 zone 口径分叉风险；批量模式不适用（无"N 相似实例"形态）。

## 总体方案

**Wave 1 · 读侧 zone 修复**：`parser.parse_knowledge` 由非递归 `glob` 改为 `rglob("*.md")`。条目 `path` **保留既有 `.sillyspec/knowledge/` 前缀**（如 `.sillyspec/knowledge/decisions/daemon.md`，顶层条目值不变）；`filename` 语义扩展为 knowledge/ 下相对路径（含子目录段，如 `decisions/daemon.md`，顶层不变）；新增 `zone` 字段（`top|decisions|generated|proposed`，由 filename 首段派生）。前端知识库页树按 zone 分组渲染，待审核区置顶并带计数徽标。quicklog 解析不动。

**Wave 2 · 写路径底座 + 手工录入 + 全层编辑**：新增 `KnowledgeWriterService`——所有写操作构造 `FileOp` 列表（add/update/delete，路径限定 `knowledge/` 前缀）调用 `SpecWorkspaceService.apply_ops` 落盘，天然继承 D-011 单写者语义（行版本乐观锁、spec_version bump、delete 进 `spec-backups/` 30 天备份、冲突返回 conflict 字段）。手工录入 = 写 `knowledge/proposed/<slug>.md`（frontmatter：author=当前用户、created_at、proposed_at、source=manual）；编辑 = update 手册层/generated 层/proposed 条目正文（decisions 返回 422，附"由归档流程维护"文案）。新增权限点 `KNOWLEDGE_WRITE`。

**Wave 3 · 审核合并/拒绝**：merge 为**两段式 apply_ops**——第一段提交 `[update(目标文件), update(INDEX.md)]`（追加 `## <标题>` 小节 + 对应分类段补路由行），检查返回无 conflict 后，第二段提交 `[delete(proposed/<slug>.md)]`（入备份区）。两段式规避 apply_ops 逐 op 冲突跳过语义（conflict 的 op 跳过、其余照常执行）导致的"候选已删但 INDEX 缺行"半态；第二段极小窗口失败时候选残留、幂等可重试（合并内容已生效，不产生知识丢失）。合并目标文件 v1 限定三类 INDEX 映射文件：`known-issues.md` / `patterns.md` / `conventions.md`（CLI categoryForTarget 分类段之外无路由落点，X-B3）；路由关键词由审核人在合并表单**人工填写**（KnowledgeMergeIn.keywords，不做自动派生）。拒绝 = 单段 `[delete(path)]`。合并重试幂等守卫（复刻 CLI knowledge-classify.js 的 dupRe 语义）：目标文件已含同名 `## 小节` 时跳过追加、仅继续后续段，防段 1 已生效的重试重复追加。合并预览由后端生成（dry-run 返回将追加的段落与 INDEX 行，前端弹层展示）。

**Wave 4 · 蒸馏派发 + 前端整合**：新增 `DistillDispatchService`——校验源（会话存在且有记录 / 变更已归档）后创建 AgentRun（fire-and-forget，复用 spec_bootstrap 派发先例），prompt 模板指示 agent：读取源记录 → 提炼 → 执行 `sillyspec knowledge propose --title … --category … --body …`。任务状态查询复用 AgentRun 状态；daemon 离线/失败经现有任务失败路径反馈。前端整合：沉淀弹层（从记录提炼 tab：选源 + 关注点提示词 + 派发；手工录入 tab：表单）、蒸馏任务条（进行中显示，完成即消失）、待审核条目操作区（编辑/合并/拒绝）。

**同步链路（全 Wave 共用，零 daemon 改动）**：平台直写 bump spec_version → 各端 daemon **下次 lease claim** 按 latest_spec_version 拉取下行应用（主动快照语义，维持 daemon 决策库 D-004@v1 口径；无任务不拉取）；agent 蒸馏产物照旧走会话内上行同步。repo-native junction 场景下，下行应用会修改用户 git 工作树中的 `.sillyspec` 文件——与 CLI 直接写入的行为一致，由用户正常提交流程处理，页面文案提示"已同步到仓库工作树，请随代码提交"。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/knowledge/parser.py | `parse_knowledge` 递归化 + zone 归类；`_extract_title`/`_read_file_safe` 复用；quicklog 路径不动 |
| 修改 | backend/app/modules/knowledge/schema.py | `KnowledgeEntryRead` 增 `zone` 字段（producer=parser.py → service → router → consumer=前端 api-types.ts 经 `pnpm gen:types` 再生成）；新增 `KnowledgeProposeIn` / `KnowledgeUpdateIn` / `KnowledgeMergeIn`（target_file + section_title + keywords）/ `DistillDispatchIn`（source_type/session_id/change_name/focus）/ `MergePreviewOut` 等 DTO |
| 修改 | backend/app/modules/knowledge/router.py | 新端点（详见接口定义）；写端点挂 `require_permission(Permission.KNOWLEDGE_WRITE)` |
| 新增 | NEW:backend/app/modules/knowledge/writer.py | `KnowledgeWriterService`：propose/update_entry/merge/reject + merge 预览；内部构造 FileOp 走 `SpecWorkspaceService.apply_ops`（producer=writer → apply_ops manifest/version → consumer=spec 同步下行） |
| 新增 | NEW:backend/app/modules/knowledge/distill.py | `DistillDispatchService`：源校验、AgentRun 创建（prompt 模板）、任务列表查询 |
| 修改 | backend/app/modules/knowledge/service.py | list/get 透传 zone；get 按 filename 精确匹配（filename 扩展为含子目录段后值天然唯一，消除递归后跨 zone 同名歧义）；`_spec_content_root` 不动 |
| 修改 | backend/app/modules/auth/permissions.py | `Permission` 增 `KNOWLEDGE_WRITE`（producer=枚举 → router 权限门 → consumer=前端按权限渲染写按钮） |
| 新增 | NEW:backend/migrations/versions/20260917104400_add_knowledge_write_permission.py | 角色-权限播种 migration（计划号 20260917104400，执行时先跑 alembic heads 实测定 down_revision，当前单头 20260914100000） |
| 修改 | backend/openapi.json | 随代码再生成并提交 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成（zone + 新 DTO） |
| 修改 | frontend/src/lib/knowledge.ts | 新增 propose/update/merge/reject/distill/distill-tasks API 封装 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | zone 分组树（待审核置顶+徽标）、条目操作区、任务条挂载 |
| 新增 | NEW:frontend/src/components/knowledge/precipitate-dialog.tsx | 沉淀弹层（从记录提炼 tab + 手工录入 tab） |
| 新增 | NEW:frontend/src/components/knowledge/merge-dialog.tsx | 合并弹层（目标文件选择 + 后端预览渲染 + 确认） |
| 新增 | NEW:frontend/src/components/knowledge/entry-editor.tsx | 条目编辑态（Markdown textarea + 保存/取消） |
| 新增 | NEW:frontend/src/components/knowledge/distill-task-bar.tsx | 蒸馏任务条（进行中轮询，完成消失） |
| 修改 | backend/app/modules/knowledge/tests/test_parser.py | zone 递归/顶层值不变回归断言 |
| 修改 | backend/app/modules/knowledge/tests/test_router.py | 读写端点用例（409 契约/权限/字面量路由顺序） |
| 新增 | NEW:backend/app/modules/knowledge/tests/test_writer.py | writer 单测（两段式/冲突/dupRe 幂等守卫/白名单） |
| 新增 | NEW:backend/app/modules/knowledge/tests/test_distill.py | 派发服务单测（源校验/离线 failed/任务列表过滤） |
| 修改 | backend/tests/modules/auth/test_permissions.py | KNOWLEDGE_WRITE 枚举与播种用例 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | zone mock/分组树断言/徽标适配 |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx | 组件测试（权限两态/表单校验） |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/entry-editor.test.tsx | 组件测试（编辑保存/decisions 只读标注） |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx | 组件测试（预览渲染/409 提示/拒绝确认） |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx | 组件测试（轮询/终态消失/离线文案） |
| 修改 | .sillyspec/docs/backend/modules/knowledge.md | 模块卡增量：定位换「读侧+平台写侧」+7 端点契约+409+两段式+R-03 同源注意事项 |
| 修改 | .sillyspec/docs/backend/modules/auth.md | 模块卡增量：KNOWLEDGE_WRITE 枚举与播种 migration 说明 |
| 修改 | .sillyspec/docs/SillyHub/modules/spec_workspace.md | 模块卡增量：knowledge writer 成为 apply_ops 新调用方（D-011 不变） |
| 修改 | .sillyspec/docs/SillyHub/modules/frontend_components.md | 模块卡增量：knowledge/ 四新组件一行式职责（紧凑增量不重排超预算卡） |
| 修改 | backend/app/modules/daemon/schema.py | D-010④：新增 DISTILL_SESSION_ORIGIN="k-distill" 常量（origin 列 String(16) 限长取短码） |
| 修改 | backend/app/modules/daemon/session/service/create.py | D-010③：create_session 增 origin 入参落 AgentSession.origin（缺省 chat 零回归） |
| 修改 | backend/app/modules/daemon/session/service/read_model.py | D-010④：list_agent_sessions 增 exclude_origin 默认排除蒸馏会话（None=admin debug） |

daemon（sillyhub-daemon/）：**零改动**（蒸馏走既有会话基建，同步走既有 pull/push）。

## 接口定义

```python
# parser.py
class ParsedEntry:  # 增字段
    zone: str  # "top" | "decisions" | "generated" | "proposed"
    # filename = knowledge/ 下相对路径（含子目录段，顶层条目值不变）
    # path    = 展示用完整前缀 .sillyspec/knowledge/<相对路径>（格式不变）

# writer.py
class KnowledgeWriterService:
    async def propose_manual(ws_id, user, title: str, category: str, body: str, tags: list[str]) -> KnowledgeEntryRead
        # slug = kebab(title)，冲突追加 -2/-3；写 knowledge/proposed/<slug>.md
    async def update_entry(ws_id, user, path: str, content: str) -> KnowledgeEntryRead
        # path 校验：knowledge/ 前缀 + zone ∈ {top,generated,proposed}，decisions → KnowledgeEditForbidden(422)
    async def preview_merge(ws_id, path: str, target_file: str, section_title: str, keywords: list[str]) -> MergePreviewOut
        # 追加段落文本 + INDEX 路由行（dry-run，不落盘）；target_file ∈ 三类映射文件
    async def merge(ws_id, user, path: str, target_file: str, section_title: str, keywords: list[str]) -> MergeResult
        # 两段式：apply_ops([update(target), update(INDEX)]) 确认无 conflict
        #         → apply_ops([delete(proposed/<slug>.md)])
    async def reject(ws_id, user, path: str) -> None  # apply_ops: [delete(path)]

# distill.py
class DistillDispatchService:
    async def dispatch(ws_id, user, source_type: Literal["session","change"], source_ref: str, focus: str | None) -> AgentRunRead
    async def list_tasks(ws_id) -> list[DistillTaskRead]  # 过滤 metadata_.kind=knowledge-distill 的 AgentRun
```

**冲突响应契约**：写端点（propose/update/merge/reject）内嵌调用 apply_ops，检测到返回 conflict 时统一翻译为 **HTTP 409** + `{"message": "文件在别处被修改，请刷新后重试", "conflict": true, "server_versions": {...}}`（沿用 AppError 体系），前端 toast 提示刷新重试（R-01）。

REST 端点（prefix=/workspaces/{workspace_id}，tag=knowledge；**字面量路由必须注册在 `{filename:path}` 通配路由之前**，FastAPI 按声明序匹配否则被吞）：

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /knowledge | KNOWLEDGE_READ | 不变（响应 items 增 zone、filename 含子目录段） |
| GET | /knowledge/{filename:path} | KNOWLEDGE_READ | 不变语义（filename 现可为 decisions/xxx.md；前端编码按段 encodeURIComponent 拼 `/`，不整串编码） |
| POST | /knowledge/propose | KNOWLEDGE_WRITE | 手工录入候选 |
| PATCH | /knowledge/entries/{filename:path} | KNOWLEDGE_WRITE | 编辑条目正文 |
| POST | /knowledge/proposed/{filename:path}/preview-merge | KNOWLEDGE_WRITE | 合并预览 |
| POST | /knowledge/proposed/{filename:path}/merge | KNOWLEDGE_WRITE | 执行合并（两段式） |
| POST | /knowledge/proposed/{filename:path}/reject | KNOWLEDGE_WRITE | 拒绝候选 |
| POST | /knowledge/distill | KNOWLEDGE_WRITE | 派发蒸馏任务 |
| GET | /knowledge/distill/tasks | KNOWLEDGE_READ | 任务列表 |

## 生命周期契约表

本变更涉及 agent_run/lease/daemon/session 关键词（蒸馏派发链路），契约如下——**除第一行外全部复用既有事件与处理器，本变更只新增 dispatch 事件的生产者**：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch distill | backend（DistillDispatchService） | AgentRun 队列 | workspace_id, source_type, source_ref, focus, created_by | AgentRun pending（daemon 离线时创建后立即 failed/no_online_daemon，bootstrap 先例） |
| claim lease（既有） | daemon | backend | leaseId, claimToken, agentRunId | lease pending → claimed |
| create session（既有） | backend | daemon | sessionId, leaseId, claimToken, prompt(含 sillyspec knowledge propose 指令) | session active |
| turn result（既有） | daemon | backend | runId, status, output | AgentRun running → completed/failed |
| spec upsync apply_ops（既有） | daemon | backend | FileOp[](proposed/<slug>.md add), base_version | manifest v+1, spec_version bump |
| change reparse（既有） | backend apply_ops 后置 | change 读侧（knowledge 为实时解析、无 reparse） | workspace_id | 列表下次请求可见新候选 |

无新增 lease/session 状态机；distill 任务无独立状态机（以 AgentRun 状态为准）。

## 数据模型

- **无新表**（D-003）。候选知识即 `knowledge/proposed/*.md` 文件。
- `AgentRun` 复用承载蒸馏任务（Grill X-04 源码核实）：`metadata_` JSON 列（backend/app/modules/agent/model.py:412）写 `{kind: "knowledge-distill", source_type, source_ref, focus}`；workspace 关联复用 `AgentRunWorkspace`（backend/app/modules/spec_workspace/bootstrap.py:144 先例）。daemon 离线时创建后立即 failed（no_online_daemon，backend/app/modules/spec_workspace/bootstrap.py:386 先例）。
- 权限：`Permission` 枚举增 `KNOWLEDGE_WRITE`（backend/app/modules/auth/permissions.py:68 KNOWLEDGE_READ 先例）+ 角色-权限播种 migration——存量角色按 key SELECT 后授予权限（现库无完全同构先例，migration 202607251600 为 bulk_insert 新角色先例，写法参照其风格）。

## 兼容策略（brownfield 必填）

- 未授予 KNOWLEDGE_WRITE 的用户：页面与现在行为一致（仅读），不出现写按钮/操作区；读侧新增 zone 分组对旧前端无感（旧版忽略新字段）。
- `GET /knowledge` 响应仅**新增** `zone` 字段；`filename` 语义扩展（可含子目录段，顶层条目值不变）、`path` 格式与取值不变——不删不改既有字段，前端旧缓存兼容（X-02 定论：保留 `.sillyspec/knowledge/` 前缀正是为兑现本条承诺）。
- quicklog 两端点、`_spec_content_root` 解析优先级、spec 同步协议**零改动**；apply_ops 入参契约不变（knowledge writer 只是新的调用方）。
- 回退路径：写端点整体是新增面，回滚 = 前端隐藏入口 + 移除路由注册；读侧 rglob 若遇性能问题可按 zone 惰性加载（列表接口带 zone 过滤参数，本期不做）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 平台直写与 daemon 上行同步并发改同一知识文件 → apply_ops 冲突（base_version 不匹配） | P0 | 写端点检测 apply_ops 返回 conflict 后统一翻译 HTTP 409 + 冲突详情（见接口定义冲突响应契约），前端提示"文件在别处被修改，请刷新后重试"；知识写入低频，不做自动合并 |
| R-02 | merge 多文件 op 半态：apply_ops 冲突为逐 op 跳过非整批中止（backend/app/modules/spec_workspace/service.py:1894/2072-2080，DB 侧单事务成立 :2263-2314），单批混装 update+delete 时 delete 会照常执行 → 候选被删但 INDEX 缺行 | P1 | merge 两段式（Wave 3）：第一段仅 updates、确认无 conflict 后第二段才 delete；第二段失败=候选残留幂等可重试，不产生知识丢失（Grill B-1 修正） |
| R-03 | INDEX.md 路由行格式/落点与 CLI knowledge-match.js 不兼容（缩进/锚点/分类段错位 → CLI 检索失效） | P0 | 行格式逐字复刻 classify 输出（`- 关键词|关键词 → [标题](文件.md#锚点)`，knowledge-classify.js 的 routeLine 生成（sillyspec 仓））；merge 目标限定三类映射文件 known-issues/patterns/conventions（CLI categoryForTarget 之外无分类段落点，Grill B-3）；路由关键词人工填写不做自动派生；合并预览明示最终行文本；verify 用真实 INDEX 跑 `sillyspec knowledge validate` 佐证 |
| R-04 | repo-native junction 场景下行应用改用户 git 工作树（未提交改动出现在用户仓库） | P2 | 与 CLI 直接写盘行为一致；页面提示"已写入仓库工作树，请随代码提交"；不自动 git commit（不引入 change_writer） |
| R-05 | 蒸馏 agent 会话失败/超时/产出不合规格（proposed 文件缺 frontmatter 等） | P1 | prompt 模板固化 propose 命令用法；daemon 离线时任务创建后立即 failed/no_online_daemon（bootstrap 先例），任务条透出失败态与日志入口；列表读取对坏文件沿用 parser 容错（跳过不炸列表） |
| R-06 | 权限播种遗漏 → 授权用户 403 | P1 | migration 对存量角色按 key SELECT 授予（现库无同构先例，写法参照 202607251600 bulk_insert 风格）；verify 含"管理员可见写按钮"用例 |
| R-07 | rglob 全量解析大 knowledge/ 树的列表时延（generated/ 持续增长） | P2 | 当前量级（60 文件）沿用无索引实时解析；单条读取维持线性匹配既有取舍；超阈值再引入索引（模块卡已记录该债） |
| R-08 | **蒸馏源记录断链（execute 后探索发现，P0）**：①会话源——对话内容存后端 `agent_run_logs` 表（不在 workspace 文件树），prompt 只内嵌 session_id 指针，而 daemon 侧 MCP 工具集（mcp-server.ts 仅 dispatch_worker/upload_file 等）无查会话记录入口，agent 读不到记录；②变更源——prompt 指 workspace `.sillyspec/changes/archive/`（本地有），但蒸馏产出候选回流后落在服务器 spec_root（platform-managed 下 daemon 本地无该树），agent `knowledge propose` 产物可能写不进同步上行集；③超大对话无体量护栏（R-05 只覆盖失败兜底，无 turn 数/字节预检与分段策略） | P0 | **补取数通道**：后端把会话记录分页导出为临时文件落 workspace（如 `.sillyspec/.runtime/distill-sources/`），prompt 从「读会话 session_id」改为「读这个文件路径」（agent 用 grep/分片增量啃）；②平台直写回灌 daemon 本地缓存或下行 bundle 预置；③超阈值分段派发 map-reduce（turn 区间拆任务各自出候选，审核流天然合并）+ prompt 增增量读取指引。详见 design 新增「蒸馏源记录交付断链（R-08）」节 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01/FR-02/FR-03（来源范围）；非目标（事件复盘） | 已覆盖 |
| D-002@v1 | 总体方案 Wave 4 + 接口定义（DistillDispatchService/AgentRun）+ 生命周期契约表 | 已覆盖 |
| D-003@v1 | 总体方案 Wave 2/3 + 数据模型（无新表）+ 非目标（独立存储） | 已覆盖 |
| D-004@v1 | 总体方案 Wave 1 + 文件变更清单（parser/前端 zone 分组） | 已覆盖 |
| D-005@v1 | 总体方案 Wave 2（平台直写走 apply_ops）+ 非目标（daemon 代写）+ R-01/R-04 | 已覆盖 |
| D-006@v1 | FR-07 + 接口定义（update_entry 的 decisions 422）+ 兼容策略 | 已覆盖 |
| D-007@v1 | Wave 3（两段式 merge + 三类映射目标 + keywords 人工输入）+ R-02/R-03 + 接口定义 | 已覆盖 |

## 蒸馏源记录交付断链（R-08，execute 后探索发现）

> 本节记录 execute 完成后独立探索会话（2026-09-17）发现的蒸馏链路断链。平台侧传指针（session_id）不搬运对话内容本身正确——100MB 不经后端蒸馏代码；真正的问题是 agent 侧读不到。三个洞：

**洞一（会话源，最根本）**：对话内容存后端 `agent_run_logs` 表（`backend/app/modules/agent/model.py 的 AgentRunLog 表`，DB 非文件树），prompt（`backend/app/modules/knowledge/distill.py 的 prompt 会话式模板`）只内嵌 session_id + 可选关注点。daemon 侧 MCP 工具集（`sillyhub-daemon/src/mcp-server.ts`，仅 upload_file/list_uploaded_files + dispatch_worker 等派工工具）**无查会话记录入口**——prompt 说「请读取该会话的完整对话记录」，但 agent 工作目录里既无此文件也无接口可取。会话源蒸馏在真实环境大概率跑不出东西。

**洞二（变更源回流）**：prompt 指 workspace `.sillyspec/changes/archive/`（本地文件树可读，无洞一问题），但平台知识库写在**服务器 spec_root**——platform-managed 策略下 daemon 本地无该树，agent 执行 `sillyspec knowledge propose` 写的 `knowledge/proposed/*.md` 落在 daemon 本地缓存，可能不进上行同步集。repo-native junction 场景下两边是同一目录则无此问题，但默认 platform-managed 策略受影响。

**洞三（体量护栏缺失）**：R-05 只覆盖失败兜底，无 turn 数/字节预检与分段策略；且数据库读侧注释已写全量重放代价（5000 行 × 50KB），100MB ≈ 两千多行日志，即使补了取数通道也必须分页。

**修复方向（map-reduce，供后续 Wave/变更）**：
> ⚠️ **实现期修正（D-008@v2，commit 2c7873e5e）**：方向 2 的前提经源码调查不成立——spec 树三策略统一下发 daemon 本地 `~/.sillyhub/daemon/specs/{ws_id}` 且 `knowledge/` 在上行同步集内，洞二实为「树在缺指路」已用 `--spec-dir` 指路修复；洞一实际落定走**附件通道**（导出→attachment_ids→daemon 落盘 attachments/，`.runtime` 方案因同步排除集不可行）；洞三三重护栏已落地（turn>2000/单条 8KB/总量 19MB）。详见 decisions.md D-008@v2。以下原文保留作探索记录：
1. **补取数通道（首选）**：后端把会话记录分页导出为临时文件落 workspace（如 `.sillyspec/.runtime/distill-sources/<session_id>.md`），prompt 从「读会话 session_id」改为「读这个文件路径」——agent 用 grep/head/tail/分片增量啃，CLI agent 天生工具支持。代价最小。
2. **变更源回流**：平台直写候选后，经既有 spec 同步下行 bundle 预置到 daemon 本地（或明确 repo-native 场景为受支持路径）。
3. **超阈值分段派发**：turn 数超阈值的会话按区间拆多个蒸馏任务各自出候选，人工审核流天然合并（reduce）；prompt 模板增「先看目录/结构→grep 关键段落→分段提炼」增量读取指引。

## 蒸馏派谁去干（D-009：会话源默认原会话续接，新 agent 可选）

> 用户提出并确认（2026-09-17）：会话源蒸馏**默认让原 agent 会话续接去沉淀**——有完整上下文，快（prompt cache 命中）+ 省 token（不重喂记录）+ 高质量（agent 自己知道哪些是真坑）。同时保留换其他 agent 的选项。

**技术链路（平台既有机制，源码核实）**：`reopen_session`（`backend/app/modules/daemon/session/service/（续接入口 reopen_session，见 backend/app/modules/daemon/session/service/session_lifecycle.py）`）续接**已结束**的 claude/codex 会话——SDK resume 保留完整对话历史 + prompt cache；续接后用 `inject_session(prompt=...)`（`backend/app/modules/daemon/（inject_session，见 backend/app/modules/daemon/service.py）`）把「请提炼本会话为知识」指令发进原会话。**一举化解 R-08 洞一**：原会话读自己，无需取数通道。

**路由矩阵**：

| 来源 | 默认路径 | 可选项 | 理由 |
|---|---|---|---|
| 会话源 | **原会话续接**（reopen+inject） | 新建 agent | 有上下文+cache；新 agent 用于会话已删/引擎不支持 resume/想换视角 |
| 变更源 | 新建 agent | —（无"原会话"概念） | 变更是 `.sillyspec/changes/archive/` 文件树，天然新 agent 读文件 |

**引擎限制（`reopen_session` 源码写明）**：续接仅 claude/codex（provider caps 门控）；仅已结束会话可 reopen（进行中用 inject）；归档区会话禁写。故「新建 agent」选项必须保留——正好对应用户保留需求；不支持 resume 的引擎自动/引导降级到新 agent 路径（配 D-008 取数通道）。

**前端（task-08 补）**：沉淀弹层会话源暴露「谁去干」选择——默认勾选「原会话续接（推荐：快+省+有上下文）」，旁保留「新建 agent」；选择结果经 DistillDispatchIn 扩展字段（如 `mode: resume|fresh`）下发，后端按 mode 分流 reopen+inject 或 bootstrap 新建。

**与 R-08 关系**：洞一（会话源取数）被续接路径化解；但**新 agent 路径仍依赖 D-008 取数通道**，且**洞二（platform-managed 产出回流）对两条路径都存在**——续接会话写的 `proposed/*.md` 同样在 daemon 本地，需 D-008 方向 2 回流修复。故 D-008 仍是必要底座，D-009 是洞一的最优解。

## 沉淀闭环增强（D-010，用户四需求）

> 用户提出并确认（2026-09-17）。四项增强让沉淀闭环可追溯、来源更全、新建 agent 有据可循：

**① 已沉淀标签 + 知识点反链**：来源侧（会话/变更/快速修复）列表项带「已沉淀」标签——判定=该源存在对应 distill run（`AgentRun.agent_session_id` 关联 + `metadata_.kind=knowledge-distill` 已落档，无需新表），非前端假标。点击标签跳转到对应知识点：proposed 候选 frontmatter `source` 字段为反链载体（蒸馏写 `session:<id>`/`change:<key>`/`quick:<id>`）；**关键**——合并后 proposed 文件删除入备份区，故合并动作须把目标小节锚点（`目标文件#小节标题` 双键，非裸锚点防重命名漂移）写入反链记录，来源侧据此跳到合并后的正式知识点。

**② 快速修复日志为第三来源**：quicklog 与 knowledge 同构（`GET /quicklog` 现成），数据在 `.sillyspec/quicklog/` 文件树——新 agent 直接读，**无 R-08 洞一取数问题**。来源类型 `source_type` 扩 `quick`；单条 ql 体量小（一次修复记录），来源选择从单选改**多选**（一次勾多条 ql 合并提炼）。

**③ 新建 agent 复用 create_session 完整形态**：不再用裸 bootstrap AgentRun，改走 `create_session`（`backend/app/modules/daemon/session/service/（create_session 入口，见 backend/app/modules/daemon/session/service/create.py）` 原生双入口：`runtime_id` 钉机器+智能体，优先于 `provider`，另有 `agent_profile_id`/`llm_provider_id`/`model`）——用户像常规会话新建一样先选**机器（runtime）**再选 **agent 类型**，后端代触发（非用户手点），title 自动带「提炼」前缀。有据可循：完整机器+引擎+模型配置可查。

**④ 蒸馏会话隔离**：`AgentSession.metadata_`（`backend/app/modules/daemon/model.py:457` JSON 列）写 `origin="knowledge-distill"`——常规会话页列表查询过滤排除（老会话无 origin 字段默认可见，零回归兜底）；知识库侧 `DistillTaskRead` 保留 `agent_session_id`，提炼记录可跳转到该会话。**双兑现**：会话有据可循（③）+ 不污染常规会话列表（④）。

## 遗留与后续

本节为 execute 后发现的设计缺口，不影响已完成 Wave 的代码正确性（task-09 的自动化验证覆盖逻辑层），但**会话源/变更源蒸馏在真实环境的端到端产出依赖本节修复**——建议作为本变更的后续 Wave 或独立 quick 修复（方向 1 为最小可行 + D-009 续接优先为洞一最优解），并在 verify 部署期 M1-M4 实测时一并验证。

无未解决决策；剩余风险见 R-01~R-07（Grill B-1/B-2/B-3 已全部消化进对应章节）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1 ~ D-007@v1
- [x] 涉及生命周期关键词（agent_run/lease/daemon/session）→ 含「生命周期契约表」，且 5/6 事件为复用既有（状态标签已按源码修正：lease → claimed、AgentRun 无 queued）
- [x] UI 原型已生成：prototype-knowledge-precipitation.html（AI-Native token；含 zone 树/沉淀弹层/合并预览/编辑态/任务条；经用户三轮问答确认，按钮接线已程序化校验 ALL WIRED）
- [x] 字段数据流已标注（zone：parser→service→router→api-types→前端；KNOWLEDGE_WRITE：枚举→router→前端渲染；FileOp：writer→apply_ops→下行同步）
- [x] Design Grill（独立子代理，agent-tool 通道）14 项交叉检查完成：3 项 P1 阻塞（B-1/B-2/B-3）已全部消化进 Wave 3 / 兼容策略 / 接口定义与 R-02/R-03；原两处自审存疑已由源码核实落定（apply_ops 单事务成立但逐 op 冲突跳过 → 两段式；AgentRun metadata_ 列承载 distill 元数据）
