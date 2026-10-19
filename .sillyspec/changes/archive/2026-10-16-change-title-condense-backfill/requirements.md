---
author: flow-machine-draft
created_at: 2026-10-16T13:19:13.371Z
---
# 需求规格（Requirements）— 2026-10-16-change-title-condense-backfill

## 功能需求

### FR-01: title_norm 新增 condense_title 纯函数并在强/弱标点截断、上限30、硬截加省略号各形态有单测（用实证坏样本做用例）

- 变更标题提炼必须提供纯函数 `condense_title(text, *, min_len, max_len)`：输入长文本，在自然标点处截断产出短标题——强标点（。！？；…与 em dash）与弱标点（：，、,;）都必须识别为边界；边界位置首选落在必须带 `[min_len, max_len]` 内，强边界优先于弱边界；截在自然边界的结果禁止追加省略号，仅在带内与兜底带都找不到边界时才硬截 `max_len - 1` 字并追加省略号 `…`（产物总长恰 `max_len`，全部落在带内）；截断结果首尾的标点与空白必须剥除。
- 输入长度本就不超过 `max_len` 时必须原样返回（空白折叠为单行）；输入为空/None 必须返回空串。
- 默认参数口径（用户要求 2026-10-16：标题必须简洁达意，10-30 字之内、建议约 20）：必须带为 `[min_len=10, max_len=30]`——自然边界首选落在必须带内；必须带内无任何边界时才降级到兜底带 `[floor_len=8, 10)` 取边界（短句语义完整优先于凑长度，避免把「清偿跨变更存量债」级别干净短句硬切成乱码）；兜底带也无边界才硬截 `max_len` 加省略号。
- 本仓实证坏样本必须进入单测：50 字截断长句（「change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5…」的完整原文）、完整流程动机散文（「用户报告"登录的账户有时候莫名其妙被退出登录"。排查定位…」）、日期开头破折号句（「2026-10-16 生产互覆事故——另一会话…」）。

#### 场景：强边界截断不加省略号

- Given 输入「change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5s，需要把预算拉平到实测上限」
- When 调用 `condense_title`（默认参数）
- Then 返回「change 文件树「刷新」同步链路三层静默失败」（em dash 强边界，长度 ≤30，无省略号）

#### 场景：句号强边界截断

- Given 输入「用户报告"登录的账户有时候莫名其妙被退出登录"。排查定位两个代码层根因：后端 refresh token 复用检测把旧凭证超窗复用判为重放攻击并吊销该用户全部会话」
- When 调用 `condense_title`（默认参数）
- Then 返回「用户报告"登录的账户有时候莫名其妙被退出登录"」（首个句号处截断，尾标点剥除）

#### 场景：无边界硬截加省略号

- Given 输入一段超过 30 字且区间内无任何强/弱标点的文本
- When 调用 `condense_title`（默认参数）
- Then 返回前 30 字加 `…`

#### 场景：短文本原样返回

- Given 输入长度 ≤ 30 字的文本（如「归档变更也要显示文件与对账 tab」）
- When 调用 `condense_title`（默认参数）
- Then 原样返回（不得加省略号、不得改动内容）

#### 场景：空输入

- Given 输入为 None、空串或纯空白
- When 调用 `condense_title`
- Then 返回空串

### FR-02: _ensure_change_row 收养口对超30字上行标题提炼后入库、不超30字原样收养，有单测

- 平台进度上行收养口 `_ensure_change_row` 必须在采纳 CLI 上行标题前做长度防御：标题超过 30 字时必须先经 `condense_title` 提炼再落库；不超过 30 字的标题必须原样收养（行为与现状一致）。
- 提炼后为空串（如上行标题全是标点）时必须放弃本次收养（保持行内现有 title 不动）。
- 既有收养守卫语义必须保持不变：仅当行内现有 title 为兜底形态（`is_fallback_display_title`）时才采纳，语义标题不被覆盖。

#### 场景：超长标题收养被提炼

- Given 行内 title 为兜底形态（等于 change_key），CLI 上行 title 为 50 字截断长句
- When 走 `_ensure_change_row` 收养
- Then 落库 title 为提炼后的 ≤30 字短句且不带尾省略号（强边界情形）

#### 场景：常规标题原样收养

- Given 行内 title 为兜底形态，CLI 上行 title 为「知识页伪域池一键归位」（≤30 字）
- When 走 `_ensure_change_row` 收养
- Then 落库 title 与上行值逐字一致（既有收养行为不回归）

#### 场景：提炼结果为空放弃收养

- Given 行内 title 为兜底形态，CLI 上行 title 为超 30 字且无可提炼内容（提炼结果为空串）
- When 走 `_ensure_change_row` 收养
- Then 行内 title 保持原兜底值不动

### FR-03: 新增一次性回填脚本 backend/scripts/backfill_change_titles.py：默认 dry-run、--apply 落库、--workspace 可定向，title 为兜底形态或超30字的行从 description 回填，服务层有单测且幂等

- 必须提供服务层 `app/modules/change/title_backfill.py`（`TitleBackfillService`）：扫描 `changes` 表 `location IN ('active','archive')` 的行，选中「title 为兜底形态（`is_fallback_display_title`）或 title 长度 > 30」且 `description` 非空的行，用 `condense_title(description)` 派生新 title；派生结果为空或与现 title 相同时必须跳过并计数；`deleted` 行与无 description 的行必须跳过并计数。
- 落库必须只在显式 apply 模式发生；dry-run 模式必须零写库（计数与 apply 同口径）；重跑必须幂等（回填后的 title 为语义短句且 ≤30 字，不再命中选中条件）。
- 必须提供脚本 `backend/scripts/backfill_change_titles.py`：缺省 dry-run、`--apply` 落库、`--workspace <uuid>` 可多次定向、全工作区 `--apply` 须 `--yes` 显式确认（沿用 `backfill_run_change_context.py` 先例口径）；输出必须逐工作区打印命中行（change_key、旧 title、新 title）与计数汇总。
- 回填只写 `changes.title` 一列；description、状态、时间戳语义（除行 updated_at 由 ORM 正常刷新外）禁止改动。

#### 场景：兜底 title 从 description 回填

- Given 行 title 等于 change_key 且 description 为动机散文（>30 字含标点）
- When 服务层 apply
- Then 该行 title 变为 `condense_title(description)` 的 ≤30 字短句，description 不变

#### 场景：超长语义 title 同样回填

- Given 行 title 为 50 字截断长句（非兜底形态）且 description 非空
- When 服务层 apply
- Then 该行 title 被提炼为 ≤30 字短句

#### 场景：语义短 title 不动

- Given 行 title 为「奖惩模块执行清单」（语义、≤30 字）
- When 服务层 apply
- Then 该行不被选中，title 不变

#### 场景：无 description 跳过

- Given 行 title 为兜底形态且 description 为 NULL
- When 服务层 apply
- Then 该行跳过并计入 skipped_no_description，title 不变

#### 场景：幂等重跑

- Given 同一批行已回填过一轮
- When 再次 apply
- Then 选中数为 0（回填后的短句 title 不再命中选中条件），全库 title 无变化

### FR-04: 本地开发库 dry-run 核对计数后 --apply，抽查回填结果为约20字短句

- 回填脚本必须先在本地开发库（backend/.env 的 DATABASE_URL）执行 dry-run 核对命中清单，再 `--apply` 落库；落库后必须抽查若干行确认 title 为 ≤30 字自然短句、description 未被改动。

#### 场景：本地开发库回填执行

- Given 本地开发库存在兜底/超长 title 行
- When 先 dry-run 后 --apply
- Then dry-run 与 apply 计数一致，apply 后抽查明细行 title 为短句

### FR-05: 后端提供变更标题改名端点——管理员/平台责任人/变更责任人三元组可改，10-30 字校验，rename 事件留痕

- 必须提供 `PATCH /workspaces/{workspace_id}/changes/{change_id}/title` 端点（请求体 `{title}`，响应含新 title）：组合权限与删除端点同款三元组——变更责任人本人（`change.owner_id == 当前用户`）**或** 持有 `change:archive` 权限（workspace_owner 角色内置、platform_admin 经 has_permission 短路，即「管理员 || 平台责任人 || 变更责任人」，用户口径 2026-10-16）；未通过判 403，行不存在判 404（resource-hiding），已删行（location='deleted'）判 409（code=change_deleted）。
- 新 title 必须 strip 后做长度校验：10-30 字之内（用户口径 10-30 必须、建议约 20），越带判 422 并给出带宽提示。
- 改名成功必须写 `change_events` 事件（event_type='rename'，detail 含 renamed_by/old_title/new_title/change_key）并刷新行 updated_at；改名后的 title 为语义形态，此后 CLI 上行兜底标题不得回翻覆盖（既有 is_fallback 收养守卫自然保证，不需新逻辑）。

#### 场景：变更责任人本人改名成功

- Given 行 owner 为用户 A，A 登录后 `PATCH .../title` 提交「用户登录态莫名失效的前后端双侧治理」（合法带宽）
- When 请求到达
- Then 200 返回新 title，行 title 更新、updated_at 刷新、rename 事件落库

#### 场景：无权限用户 403

- Given 行 owner 为用户 A，无 change:archive 权限的用户 B 提交改名
- When 请求到达
- Then 403（PermissionDenied，提示仅三元组可改）

#### 场景：越带标题 422

- Given 有权限用户提交 title 为「太短」（<10 字）或 31 字以上
- When 请求到达
- Then 422，错误信息含 10-30 字带宽说明

#### 场景：已删行 409

- Given 行 location='deleted'，有权限用户提交改名
- When 请求到达
- Then 409（code=change_deleted）

### FR-06: 前端详情页提供改名入口（权限三元组可见，10-30 字校验提示，保存走新端点并刷新）

- 变更详情页 PageHead actions 区必须提供「改名」入口：仅权限三元组可见（复用 `useChangeDeleteAccess` + `canDeleteChange` 同款启发式，后端 403 兜底）；点击弹出改名弹层（预填当前 title），输入越带时禁用保存并提示 10-30 字带宽；保存成功后 toast 提示并刷新详情与列表缓存。
- 后端 OpenAPI schema 变更必须在同一变更内跑 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types` 并提交两份 api-types.ts 与 openapi.json（CLAUDE.md 规则 21，禁止手写类型）。

#### 场景：权限可见与保存链路

- Given 当前用户为变更责任人，进入详情页
- When 点击改名、输入合法带宽内标题并保存
- Then 调用新端点成功，页面标题即时更新（缓存失效后重取）

#### 场景：无权限不可见

- Given 当前用户非三元组（非 owner、非 workspace_owner、非平台管理员）
- When 进入详情页
- Then 改名入口不渲染

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_title_normalization.py「TestCondenseTitle」
FR-02: backend/app/modules/change/tests/test_title_normalization.py「TestAdoptTitleCondenseGuard」
FR-03: backend/app/modules/change/tests/test_title_backfill.py「TestTitleBackfillService」
FR-04: 不适用：本地开发库一次性运维执行面（脚本 dry-run/apply 人工核对），服务层行为已由 FR-03 单测覆盖
FR-05: backend/app/modules/change/tests/test_rename_title.py「TestRenameTitle」
FR-06: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-rename-title.test.tsx「改名入口权限与保存链路」
