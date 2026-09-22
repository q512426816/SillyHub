---
author: qinyi
created_at: 2026-09-16 07:47:17
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-16-platform-progress-ingest-persist

## 背景

sillyspec CLI 链路 A（REST 进度同步）在生产工作区（slug=ehs-back，id=f85a6650-9a12-48a6-a039-32a92934a28c，服务器 47.113.145.252）走完全流程后，平台 `changes` 表行不随推进更新。生产实证（2026-09-15，变更 2026-09-15-ehs-reward-punishment 一天内走完 propose→verify）：

- `platform_change_progress` 收件箱行**新鲜且正确**：`latest_progress.changes[0]` 含 `current_stage=verify / status=active`，`last_pushed_at=2026-09-15T15:39:05.765Z` —— progress POST 到达且被接受，CLI 侧契约合规（嫌疑 2「CLI 熔断让路」排除为主因）。
- `changes` 表行**全陈旧**：`current_stage=NULL`、`status='draft'`、`title='提案书（Proposal）'`；`updated_at=15:39:02` 随文档通道文件 mtime 在动（reparse 刷新）。

根因（代码证据）：

1. `upsert_progress` 接受分支只写收件箱行（`_apply`）+ 建占位行（`_ensure_change_row`，行存在即 return——`platform_sync/service.py:622-623`），`current_stage` 仅建行一刻取自 payload，`status` 硬编码 `'draft'`。
2. 设计上预期的「接管」路径对纯 CLI 工作流不生效：`_apply_parsed`（reparse）仅 `owner_id is None` 才更新 `current_stage`（`change/service.py:2688`），而进度推送链 `_sync_change_owner` 必设 owner；`dispatch.sync_stage_status` 读 sillyspec.db 仅 agent 派发触发（`change/dispatch.py:1721`）。
3. title 只从 proposal.md 首个 H1 派生（`parser.py:232-244` `_extract_title`），CLI 模板 H1 是固定文案（`提案书（Proposal）`），永不变化；语义名只在 change_key。
4. status 无枚举映射：CLI 值族 active/in_progress/archived/deleted，平台列无 CHECK 约束、消费方只特判 archived/blocked（嫌疑 3 次要面）。

附带（任务简报 P3）：parser 对缺席 MASTER.md 发 `exists=False` 占位行（`parser.py:616-664` 对 STANDARD_FILENAMES 全量补缺席行），MASTER 是 brainstorm 拆分场景产物（本仓 291 变更仅 6 个存在），单变更交付恒 exists=f 纯噪音。

## 设计目标

- FR-01：progress POST 接受后，`changes` 表行 `current_stage`/`status` 权威落库（CLI 上行值为权威源），幂等重放安全。
- FR-02：status 落库走显式映射表；未知值告警（log.warning）不写列、不静默吞。
- FR-03：既有 `base_ts` 409 乐观锁、`change_deleted` 拒收、文档/审批单写者语义零回归。
- FR-04：title 在文档推送时按最新阶段文档重派生；模板 H1 归一化回退 key 派生名；reparse 与文档推送两写路径同源不打架。
- FR-05：parser 不再为缺席 MASTER.md 发占位行；存量脏行由 `_sync_docs` seen_keys 删除环自然清理（无迁移）。
- FR-06：旧版 CLI（无 `X-SillySpec-Base-Ts` header / 无 status 字段的载荷）行为兼容。

## 非目标

- 不改 sillyspec 仓（CLI 契约 §4 载荷已合规；双边契约加 title 字段登记 issue 留给 sillyspec 侧，见 D-003 备忘）。
- 不修 daemon 响应耗时（`event_loop.blocked` reparse 阻塞与 CLI 总预算熔断的恶性循环是另一问题，本变更只登记观察；修 ingest 落库后表值滞后不再依赖推送频率）。
- 不改读侧 enrich 投影（`_project_current_stage` join 保持现状，落库后 join 与表值收敛，投影成为冗余兜底）。
- 不做 ux_changes schema 迁移（列已存在，只改写入行为）。
- 不处理 `stages` JSON / `step_progress` 的表级落库（读侧已有投影，表级收益低）。

## 拆分判断

单变更交付：三个修复点共处同一症状族（平台侧进度投影滞后），共享同一批测试设施（platform_sync/conftest + change parser 测试）；拆分会造成 P1 修完 P2 又动同一文件。不涉及多 agent 并行冲突面（backend 三文件互不重叠于其他活跃变更）。

## 总体方案

### Phase 1 — P1：progress ingest 权威落库（`platform_sync/service.py`）

`upsert_progress` 接受分支（分支 1「base_ts 空」与分支 3「stored ≤ base_ts」）在 `_ensure_change_row` 之后、`_sync_change_owner` 之前新增调用 `_sync_change_stage_status(workspace_id, name, body)`：

1. 重查 `Change` 行（不依赖上游传行，`_sync_change_owner` 同款防御；行缺失直接 return——`_ensure_change_row` 已兜底）。
2. `current_stage`：`body.changes[]` 同名条目的 `current_stage`（isinstance str 且非空）→ 覆盖行值。
3. `status`：显式映射表 `{"active": "in_progress", "in_progress": "in_progress", "archived": "archived"}`：
   - `archived` → `status='archived'` + `current_stage='archived'` + `archived_at` 仅首填（现值 None 才写）；**不动 location**（归档文件移动由 CLI `run archive` + 镜像同步 + reparse 收敛，抢先置位会被 `_apply_parsed` 回翻抖动）；
   - `deleted` 不在表内：既有 `_apply_cli_tombstone` 独立通道（location='deleted'），status 列不参与；
   - 未知值 → `log.warning("platform_sync.change_status_unknown", ...)`，只写 current_stage 不写 status 列。
4. savepoint（`begin_nested`）+ 独立 commit，best-effort：失败仅 log.warning 不阻断上行主流程（`_ensure_change_row`/`_sync_change_owner` 同范式）。
5. `workspace_id=None`（service 直调防御）跳过。

幂等性：同载荷重放 → 同值覆盖（SQLAlchemy 无脏标记，零写或等值写）；`archived_at` 首填判据防重复时间戳漂移。base_ts 409 冲突分支与 `change_deleted` 拒收分支**不经过**本方法（冲突/拒收不落库语义不变）。

### Phase 2 — P2a：title 文档推送重派生（`platform_sync/service.py` + `change/parser.py`）

1. 新增共享归一化 helper（放 `app/modules/change/title_norm.py` 新小模块，platform_sync 与 parser 双向引用、无环）：
   - `TEMPLATE_H1_RE`：四件套模板标题判定正则（`提案书（Proposal）`、`需求文档（Requirements）`、`设计文档（Design）`、`实现计划（Plan）`、`任务清单（Tasks）`、`验证报告（Verify Result）`、`模块影响分析（Module Impact）`——以仓库实际模板为准校准）；
   - `normalize_display_title(h1: str | None, change_key: str) -> str`：H1 命中模板（等于模板串，或 `模板串 + "—"` / `" —"` 后缀变体）→ 返回 `change_key` 去日期前缀（复用 `_DISPLAY_KEY_RE` 同款正则）；H1 自定义 → 原样；H1 缺失 → key 派生。
2. `upsert_documents` 接受路径（INSERT 与 UPDATE 两分支收尾）新增 best-effort title 重派生：按阶段深度取推送 map 中最深文档（proposal.md < requirements.md < design.md < tasks.md），提取其首个 `# ` H1，过 `normalize_display_title` 后写 `changes.title`。行不存在时建占位行（documents 通道无 body.changes[]，按 `Change(title=…, status='draft', location='active', path=f"changes/{name}")` 建行，`binding.py` 同款 defaults）——**建行前必须过 `_change_key_deleted` 防复活守卫**（GAP-1 吸收：documents 端点无 change_deleted 拒收前置，迟到推送已删 key 不得重建行；命中守卫时只更新既有行、不建行，行不存在则整体跳过 title 派生）。
3. `parser._extract_title` 改为：读 proposal.md 首 H1 后过 `normalize_display_title`（`parsed.title = normalize_display_title(h1, change_key)`），防 reparse 把归一化 title 回翻成模板 H1。

### Phase 3 — P3：MASTER 占位行清理（`change/parser.py`）

`_parse_change` 标准文档扫描循环：MASTER 键缺席时**不追加** `exists=False` 的 ParsedDoc（其余标准文档保持补缺席行——四件套缺席是归档门禁 documents_complete 的可见性来源）。存量 MASTER exists=False 行在下次 reparse 时由 `_sync_docs` 的 seen_keys 删除环清理。

### 测试策略

- P1：`platform_sync/tests/test_stage_status_ingest.py`（新增）——落库断言（current_stage/status/archived_at）、幂等重放、未知枚举告警（caplog）+ 不写 status 列、无 header 旧 CLI 首推（分支 1）、409 冲突不落库、change_deleted 拒收不落库、**ingest 落库后 reparse 不回翻 current_stage**（R-01 锚定用例：落库 → 同 workspace reparse → 表值保持 CLI 权威值）。
- P1 回归：`test_router.py` / `test_owner_sync.py` / `test_change_deleted_guard.py` / `test_pending_approval_broadcast.py` 既有用例全绿（upsert_progress 行为面未收缩）；**例外**：test_router.py:831 `assert row.status == "draft"` 载荷 status='active'，随 FR-01 行为变更更新为映射后值 `'in_progress'`（预期体现非腐化，task-08 声明）。
- P2a：`change/tests/test_title_normalization.py`（新增）——模板 H1/带后缀变体/自定义 H1/H1 缺失四态 + upsert_documents 重派生路径 + reparse 同源不回翻。
- P3：parser 既有测试文件补用例：MASTER 缺席不发行、存在时照发、`_sync_docs` 清理存量行。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/platform_sync/service.py | P1 `_sync_change_stage_status` + 接受分支接线；P2a `upsert_documents` title 重派生 |
| 新增 | NEW:backend/app/modules/change/title_norm.py | 共享 title 归一化 helper（TEMPLATE_H1_RE + normalize_display_title + extract_h1） |
| 修改 | backend/app/modules/change/parser.py | `_extract_title` 接归一化；MASTER 缺席不补占位行 |
| 新增 | NEW:backend/app/modules/platform_sync/tests/test_stage_status_ingest.py | P1 回归测试 |
| 新增 | NEW:backend/app/modules/change/tests/test_title_normalization.py | P2a/P3 回归测试 |
| 修改 | backend/app/modules/platform_sync/tests/test_router.py | 连带测试债（plan 审查发现）：:831 `assert row.status == "draft"`（载荷 status='active'）随 FR-01 更新为映射后值 |

## 接口定义

```python
# platform_sync/service.py（新增私有方法）
async def _sync_change_stage_status(
    self, workspace_id: uuid.UUID | None, name: str, body: dict[str, Any]
) -> None
# best-effort：savepoint 内重查 Change 行，覆盖 current_stage，status 按映射表落库

# change/title_norm.py（新增公共 helper）
TEMPLATE_H1_RE: re.Pattern[str]  # 模板 H1 判定正则（中文类型词族 _TEMPLATE_TYPE_WORDS 构建，含「— key」后缀变体；实现期由 design 初稿的 frozenset 前缀集改为正则——覆盖无括号/后缀变体更强，机制升级非语义变更）
def extract_h1(text: str) -> str | None
def normalize_display_title(h1: str | None, change_key: str) -> str

# 常量（platform_sync/service.py）
CLI_STATUS_TO_PLATFORM: dict[str, str] = {"active": "in_progress", "in_progress": "in_progress", "archived": "archived"}
_TITLE_STAGE_ORDER: tuple[str, ...] = ("proposal.md", "requirements.md", "design.md", "tasks.md")
```

## 生命周期契约表

本变更不引入生命周期契约（不涉及 session/lease/agent_run/daemon/lifecycle/state transition/claim/heartbeat 语义——progress POST 的 base_ts 乐观锁是既有契约且零改动，仅在接受分支追加表级落库）。

## 数据模型

无 schema 变更：`changes.current_stage`（String, nullable）、`changes.status`（String(30), default 'draft'，无 CHECK）、`changes.archived_at`（DateTime, nullable）列均已存在；本变更只改写入行为。

## 兼容策略（brownfield 必填）

- 旧版 CLI 无 `X-SillySpec-Base-Ts`：走分支 1 无条件接受 → 落库同样生效（FR-06）。
- 载荷 `changes[]` 无 `status` 字段或值非 str：映射表 miss → 告警 + 只写 current_stage，不写 status 列。
- 载荷 `changes[]` 无 `current_stage`：不覆盖行值（None 守卫），其余照旧。
- 未部署本修复的平台 + 新 CLI：无影响（服务端单侧变更，无契约字段增删）。
- 读侧 enrich 投影保持现状：落库后 join 值与表值收敛，`archived` 终态投影与表值同形（双保险，无行为分叉）。
- 回退路径：revert 提交即可（无迁移、无数据破坏——落库值均可由下次推送/推-parse 重derive）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | ingest 落库与 reparse 对 current_stage 的写竞争（reparse 仅 owner=None 行更新，理论无冲突；但 `_sync_change_stage_status` 写后若 owner_id 为 None 的行被 reparse 文件猜值覆盖） | P2 | 顺序上 progress 推送必设 owner（`_sync_change_owner` 在同分支稍后执行）→ reparse 的 owner=None 守卫天然让位；测试补「ingest 落库后 reparse 不回翻」用例锚定 |
| R-02 | `archived` 落库但文件未移动窗口内，列表「已归档」筛选提前命中（status 表值先于 location 收敛） | P3 | 与读侧既有投影行为一致（投影同样先行）；location 仍由 reparse 收敛，双值短暂不一致可接受，非新引入 |
| R-03 | 模板 H1 前缀清单与 sillyspec 模板漂移（新模板新文案不在集合内） | P3 | 未命中模板的 H1 原样采用（宁多语义不少语义）；清单以本仓实际文档校准，登记 sillyspec 仓 issue 备忘双边契约后可整体替换 |
| R-04 | P2a 在 documents 通道建占位行与 `_ensure_change_row` 并发双发撞 `ux_changes_workspace_key` 唯一约束 | P2 | 复用 `_ensure_change_row` 的 IntegrityError 回滚静默范式（race-lost 语义等价） |
| R-06 | documents 通道建行绕过防复活守卫（GAP-1，审查发现） | P2 | P2a 建行前过 `_change_key_deleted` 守卫，命中则不建行不派生 title（设计 Phase 2.2 已吸收） |
| R-05 | upsert_progress 接受分支新增一次重查 + 写库，加重「平台响应慢 → CLI 熔断」恶性循环 | P2 | 单行主键查询 + 单行 UPDATE（毫秒级），远小于既有 `_broadcast_pending_approval` 的通知开销；不改耗时治理（非目标） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01/FR-03、总体方案 Phase 1 | 已覆盖 |
| D-002@v1 | FR-02、总体方案 Phase 1.3 映射表 | 已覆盖 |
| D-003@v1 | FR-04、总体方案 Phase 2 | 已覆盖 |
| D-004@v1 | FR-05、总体方案 Phase 3 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@v1（决策追踪表 4 条全引用）
- [x] 生命周期契约豁免短语已紧邻章节标题（progress base_ts 乐观锁为既有契约零改动）
- [x] UI 原型分级核对：纯后端行为修复无前端文件，无需原型
- [x] 无「⚠️ 自审存疑」项
