---
author: qinyi
created_at: 2026-08-16 23:05:00
scale: large
status: draft
risk_level: unit-sufficient
related_changes:
  - 2026-08-16-change-owner-from-token      # owner enrich 批量 join users 模式复用
  - 2026-08-11-sillyhub-platform-sync       # platform_sync 端点 + shpsync_ 鉴权范式复用
  - 2026-08-13-platform-managed-file-sync   # daemon 增量同步 change_dirs 口径（quicklog 不触发重扫的依据）
---

# 设计文档（Design）— 变更中心「快速修复」tab（sillyspec quick 操作展示 + CLI 推送）

## 1. 背景

平台变更中心（`/workspaces/[id]/changes`）已与 SillySpec 完整变更流程打通，但 **quick 操作（快速修复）在平台上无任何结构化展示**：

1. **展示缺口**：quick 不建 `changes/` 目录，`ChangeParser`（backend/app/modules/change/parser.py）不感知 QUICKLOG，变更中心列表/详情均无 quick 影子。唯一展示位是「知识 & 日志」页的「快速日志」tab（frontend/.../knowledge/page.tsx）——按**文件**列整个 `QUICKLOG-<user>.md`、点开看原始 markdown，是文件浏览器语义而非操作/进度语义。
2. **即时性缺口**：quick 的活体进度在 `.runtime/quick-sessions/`（daemon 上传排除集内，永不上传）；QUICKLOG 文件虽有「进行中」条目，但文件同步挂会话生命周期（会话/任务结束回灌 + pull 前 mtime 回灌检测），quick 落盘到平台可见之间存在会话粒度延迟。
3. **范式缺口**：完整变更已有 CLI 直推链路——每步 `--done` 后 `triggerSync`（sillyspec src/run/shared.js:420）把 progress JSON POST 到 `POST /api/changes/{name}/progress`（platform_sync router，shpsync_ 鉴权 + base_ts 乐观锁，落 PG）。quick 完全没有对等链路。

数据实查（2026-08-16，本机 `.sillyspec/quicklog/`）：日切文件（`QUICKLOG-<user>-<date>.md`）是轮转归档，与聚合文件（`QUICKLOG-<user>.md`）**零重叠**（如 qinyi 聚合 34 条从 ql-20260812-007 起，08-12 日切 38 条止于 ql-20260812-005，无缝衔接）——文件名日期=轮转日非条目日，解析必须全目录扫描。状态行实为 4 形态：`已完成` 493、`已完成（…带括注）` 7、`已暂存` 2、`进行中` 11（多为死会话，最早 2026-06-17）。标签冒号全角/半角混用（`根因:` 与 `根因：` 并存）。空壳占位条目（标题=`(quick 任务)`）21 条。

## 2. 设计目标（FR）

- **FR-01 QUICKLOG 条目解析器**（backend change 模块新增 quicklog 子域）：解析 `.sillyspec/quicklog/QUICKLOG-*.md` 全目录，按 `## ql-` 块切分条目，字段：ql_id / timestamp / title / status / author_raw / linked_changes / files（含 `::` 括注）/ 四段正文（需求/根因/方案/结果）。宽松解析：标签全半角冒号均认；未知行归入正文自由段。
- **FR-02 CLI 推送链路**（sillyspec 仓 quicklog.js）：`allocateQuicklogEntry`（写「进行中」骨架）与 `completeQuicklogEntry`（翻「已完成」+回填）两触发点后，best-effort POST 条目结构化 JSON 到平台 `POST /api/quicklog-entries`（对齐变更 triggerSync 范式；local.yaml platform 段复用，无 platform 配置时静默跳过；失败静默不阻断 quick 主流程）。
- **FR-03 平台接收端点**（platform_sync 模块）：`POST /api/quicklog-entries`，shpsync_ 工作区令牌鉴权（复用 platform_sync auth，**workspace 一律由 token 派生，payload 不含也不接受 workspace 字段**——对齐 auth.py 既有安全决策），payload=条目结构化 JSON，按 `(workspace_id, ql_id)` 幂等 upsert 落新表 `quicklog_entries`（PG，migration）。
- **FR-04 查询 API + 双源合并**：`GET /api/workspaces/{id}/quicklog-entries`（列表，分页 + search 全文 + status/author 筛选 + include_placeholder）与 `GET .../{ql_id}`（详情）。数据=PG 推送条目 ∪ 文件解析条目，按 ql_id 去重，**PG 优先**（推送时点新于文件同步）。列表项含 author enrich（username→users.display_name 优先，未命中回退原始名）与 affected_modules（module-map 推导，复用 change/parser.py `_match_paths_to_modules` 口径）。
- **FR-05 前端「快速修复」tab**：变更中心第三 tab（进行中/已归档/快速修复），徽标计数。列：状态徽标（4 态）· 标题 · 负责人 · 影响模块 · 关联变更（可跳完整变更详情）· 时间。筛选：关键词（标题+四段全文）· 状态 · 负责人 · 空壳开关（默认隐藏）。存在 in_progress/stale 条目时 30s 轮询，全终态停轮（复用变更列表轮询模式）。
- **FR-06 抽屉详情**：点行开 Drawer：四段正文 + 文件带括注清单 + 关联变更链接 + 原始 md 切换视图。不新建独立详情页。
- **FR-07 反向关联区块**：变更详情页新增「关联的快速任务」SectionCard——linked_changes 命中本变更的 quick 条目列表（状态徽标+标题+时间，点击跳快速修复 tab 定位）。
- **FR-08 状态判定规则**（双源统一，标签值**前缀匹配**再提括注）：`已完成`（含`已完成（…）`）→completed（括注进 status_note）；`已暂存`（含`已暂存（…）`）→partial_done（括注同上）；`进行中` 且 timestamp>24h→stale（疑似中断）；`进行中` 且 ≤24h→in_progress；标题=`(quick 任务)`→placeholder=true（独立于 status，默认从列表过滤）。块内多条状态行取**最后一条**（历史 bug 残留形态，实测 4 例）。

## 3. 非目标（Non-Goals）

- **NG-01** 3 步步骤级进度（`.runtime/quick-sessions/` 不上传，不在本变更打开）。
- **NG-02** 代码 diff、耗时统计（QUICKLOG 无结束时间戳）。
- **NG-03** 知识 & 日志页现有快速日志 tab 改造（保留现状并存，不删不改）。
- **NG-04** quick CLI ↔ daemon 实时联动通知（推送即为本变更的即时性方案）。
- **NG-05** 旧 CLI 版本兼容推送（旧版无推送→文件链路照旧；端点只增不改）。
- **NG-06** 平台侧主动写回 QUICKLOG 文件（会撞 daemon 增量同步 base_version 乐观锁，禁止）。

## 4. 拆分判断

- **内聚单变更**：解析器/端点/tab/抽屉/反向区块/CLI 推送围绕同一 quicklog 条目数据契约强耦合，拆开无独立交付价值；跨仓（sillyspec CLI）改动小（两触发点+一个 POST helper），并入同一变更一次闭环。
- **非批量**：无重复模式。
- **Wave 组织**：W1 后端表+推送端点 → W2 后端解析器+查询 API+合并 → W3 CLI 推送 → W4 前端 tab+抽屉 → W5 反向区块+gen:types+测试收口。

## 4b. 决策记录（方案选择）

| # | 决策 | 选项与取舍 |
|---|---|---|
| D-001 | **展示位置=变更中心第三 tab** | 候选：会话页聚合（quick 由 CLI 驱动不保证产生平台会话，覆盖不全弃）/ 知识&日志页升级（文档浏览语义、入口深，弃）/ 概览活动流（配置管理语义偏离，弃）。变更中心是"agent 干活记录"统一入口，独立 tab 不污染审批聚焦。用户亲选。 |
| D-002 | **后端落点=change 模块新增 quicklog 子域 + 独立端点**（方案 B） | 候选：A 扩 knowledge 模块（前端跨模块调用语义错位，弃）；C 纯落库 reparse（要建表+reparse 改造，且 daemon 增量 change_dirs 只提取 changes/ 前缀路径不触发 quicklog 重扫，落库数据滞后直到手动全量重扫，弃）。B 文件直读永远即时。用户亲选。 |
| D-003 | **双链路=CLI 推送落 PG + 文件解析合并** | 用户升级要求（"quick CLI 也要和变更类似，触发平台接口写入对应的数据"）——对齐变更 triggerSync→POST /api/changes/{name}/progress 范式。推送管即时性（quick 启动平台立见），文件管兜底与离线（daemon 离线/旧 CLI 无推送时展示不缺失）。冲突取 PG（推送时点新于文件同步）。用户亲选平台+CLI 一起做。 |
| D-004 | **接收端点不做 base_ts 乐观锁** | 变更 progress 有双向编辑冲突面所以要乐观锁；quicklog 条目是单写者（同一 quick 会话的 CLI）整条覆盖，幂等 upsert 即够。 |
| D-005 | **PG 只存 payload 原文，派生字段查询时算** | stale（依赖当前时间）、enrich、module-map 推导不入库——避免已暂存语义固化、stale 阈值演进要刷数据。 |
| D-006 | **详情用抽屉不建独立页** | quick 内容轻（四段+文件），无独立路由价值；用户确认。 |
| D-007 | **状态两态展示升级为 4 态** | 数据实查发现真实状态有 4 形态（已完成/已完成带括注/已暂存/进行中），进行中>24h 标 stale 疑似中断——11 条死会话（最早 2026-06-17）证明该标记有真实价值。 |
| D-008 | **不做 CLI↔daemon 实时联动** | 推送链路已解决即时性；联动要跨进程通信复杂度高，收益重复。 |

## 5. 总体方案

### 5.1 数据契约（双源共用的条目结构）

```
QuicklogEntryDTO {
  ql_id: str              # "ql-20260812-007-d086"（主键级标识）
  timestamp: datetime     # 条目行 "| 2026-08-12 20:43:59 |"
  title: str
  status: enum            # completed | in_progress | partial_done | stale
  status_note: str|None   # 「已完成（commit xxx，已 push main）」的括注
  placeholder: bool       # 标题 == "(quick 任务)"
  author_raw: str         # 所属文件名用户段 QUICKLOG-<author_raw>[-date].md
  linked_changes: list[str]
  files: list[{path, note|None}]   # 文件行，`path::括注` 或多行 bullet
  body_sections: dict     # {需求|根因|方案|结果: str}，宽松标签匹配
  affected_modules: list[str]       # module-map 推导（平台侧计算，不入库）
  author_name: str|None   # enrich（平台侧计算，不入库）
  source: enum            # pushed（PG）| file（解析）——合并时标记来源
}
```

PG 表 `quicklog_entries`（migration）：`id PK / workspace_id FK / ql_id / payload JSON / created_at / updated_at`，UNIQUE `(workspace_id, ql_id)`。**只存推送原文 payload**，enrich/模块推导/状态判定中的 stale（依赖当前时间）在查询时计算——避免「已暂存」状态进库后失去语义、stale 阈值演进要刷数据。

### 5.2 后端：change 模块新增 quicklog 子域 + platform_sync 端点

**解析器**（`backend/app/modules/change/quicklog_parser.py`）：
- 扫描 `spec_root/quicklog/QUICKLOG-*.md`（复用 knowledge service 的 spec content root 解析口径），按 `^## (ql-...) \| (时间) \| (标题)$` 切块；**统一剥行尾 `\r`（实测全部 10 个 QUICKLOG 文件为 CRLF 行尾，不剥则标签匹配恒失败）**；块内按行解析 `状态：/关联变更：/文件：/需求：/根因：/方案：/结果：` 标签（全半角冒号兼容，`[：:]`；多条状态行取最后一条）；文件行支持单行逗号分隔与多行 `- path（括注）` bullet 两种形态；未匹配行归 body 自由段。
- linked_changes 解析加**白名单正则**（`^\d{4}-\d{2}-\d{2}-` 前缀的 change 名才进列表——实测存在「（无，独立权限改造）」「quick-fix-task09-runtime-test」等自由文本形态，不滤则反向区块跳转 404）；其余文本仅留在自由段。
- 进程级缓存：键=（目录 resolved 路径，全部文件 (name, mtime) 指纹），值=解析结果（不可变，命中回拷贝）——对齐 `_MODULE_MAP_CACHE` 模式（parser.py:26）。
- author_raw 从文件名正则 `QUICKLOG-(.+?)(-\d{4}-\d{2}-\d{2})?\.md` 提取。

**推送端点**（platform_sync/router.py 新增）：
- `POST /api/quicklog-entries`：Header `Authorization: Bearer shpsync_...`（复用 PlatformSyncTokenService 校验 + workspace 解析），body=QuicklogEntryDTO（无 source/派生字段）。语义：**(workspace_id, ql_id) 存在→整条覆盖（CLI 重跑 --done 幂等）；不存在→插入**。响应 200 恒成功体，CLI 端 best-effort。
- 不做 base_ts 乐观锁：quicklog 条目是**单写者整条覆盖**（同一 quick 会话的 CLI），无变更 progress 那种双向编辑冲突面。

**查询端点**（change/router.py 新增，挂 workspace 鉴权链）：
- `GET /api/workspaces/{id}/quicklog-entries`：merge(PG pushed ∪ file parsed) → ql_id 去重取 PG → 按 timestamp desc → stale 判定（now-ts>24h）→ enrich author → module-map 推导 → 筛选/分页。
- `GET /api/workspaces/{id}/quicklog-entries/{ql_id}`：单条全字段（含 body 全文）。

### 5.3 CLI 推送（sillyspec 仓，跨仓提交）

`src/quicklog.js` 两触发点尾部追加 best-effort 推送：
- `allocateQuicklogEntry` 成功后：POST 当前条目（status=in_progress）。
- `completeQuicklogEntry` 成功后：POST 完成态条目。**payload 构造允许读回条目头行/正文组装**（现有函数签名返回值有限——allocate 仅返回 `{qlId}`，且翻完成时标题行会被 `extractTitleFromResult` 刷新，推送须与落盘终态一致；实现时可扩展函数返回值或读回组装，以落盘内容为准）。
- 推送 helper（同文件内）：读 local.yaml `platform:` 段（url+token，已存在——init 已注入），fetch POST，超时 5s，任何异常（无配置/网络/非 2xx）静默 warn 一行不抛。字段名与 QuicklogEntryDTO 对齐（snake_case）。
- **不碰 daemon、不碰 sync.js 主链路**——独立小函数，quick 流程外零影响。

### 5.4 前端

- **变更中心 page.tsx**：TABS 加第三项；tab=快速修复时渲染独立查询区（阶段筛选隐藏）+ 新组件 `QuicklogTable`（列/筛选/空态）。列表 useQuery，queryKey 含全部筛选，`refetchInterval` 存在 in_progress|stale 条目时 30s。
- **QuicklogDrawer**（`frontend/src/components/changes/quicklog-drawer.tsx`）：四段正文渲染 + 文件括注列表 + 关联变更 Link + 「原始 md」切换（`<pre>` 直出原始块文本——解析器顺带返回 raw_block）。
- **反向区块**：变更详情页 `ChangeDetailPage` 加 SectionCard「关联的快速任务」，数据=列表 API `?linked_change=<key>` 筛选（后端列表参数加 `linked_change`，同 FR-04）。
- api-types.ts 经 `pnpm gen:types` 生成（含 sillyhub-daemon/src/api-types.ts 同步可选）。

## 6. 接口契约

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/quicklog-entries` | POST | shpsync_ 工作区令牌 | CLI 推送，幂等 upsert |
| `/api/workspaces/{id}/quicklog-entries` | GET | 会话 cookie（workspace 成员） | 合并列表，分页/筛选 |
| `/api/workspaces/{id}/quicklog-entries/{ql_id}` | GET | 同上 | 单条详情 |
| `/api/workspaces/{id}/quicklog-entries?linked_change=` | GET | 同上 | 反向关联筛选参数 |

## 7. 边界与错误处理

- **文件缺 quicklog/ 目录**：解析器返回空列表（不报错），合并只剩 PG 推送条目。
- **CLI 推送失败**：静默，文件链路兜底（下次 daemon 同步后文件解析可见），最终一致。
- **PG 与文件同 ql_id 不同内容**：取 PG（推送是 CLI 直写时点，文件是同步滞后副本；CLI `--done` 翻状态后推送先于 daemon 文件同步到达）。
- **同文件并发写**（多 quick 会话）：CLI 侧已有 `withFileLock`（quicklog.js:30），平台只读不写文件，无并发面。
- **stale 误报**：机器时钟偏差 / 长时间挂起会话可能误标 stale——接受（stale 仅展示层推断，不改数据；详情可见原始时间自行判断）。
- **超大 QUICKLOG 文件**：解析器设单文件 1MB 上限（对齐 knowledge parser MAX_CONTENT_BYTES），超限截断并在条目 raw_block 标注。
- **workspace 无 spec_root**（未初始化）：返回空列表。
- **module-map 覆盖度**（现状口径，非本变更债）：spec docs 下多份 `_module-map.yaml`，取第一个（SillyHub 全仓视角），frontend 仅 ppm/admin 区域有覆盖——前端类 quick 条目影响模块推导常为空列表，展示为「—」即可。
- **重复状态行**：历史 bug 残留（实测 4 例块内两条状态行），取块内最后一条（quicklog.js 修复该 bug 后新数据无此形态，解析兜底）。

## 8. 测试策略

- **解析器单测**（backend）：真实样本切片——多文件轮转、4 状态形态（含已暂存带括注）、全半角冒号、**CRLF 行尾**、文件单行/多行 bullet、空壳占位、重复状态行取最后、linked_changes 白名单正则、空目录/缺目录。fixture 用本仓 `.sillyspec/quicklog/` 拷贝脱敏。
- **推送端点测试**：shpsync_ 鉴权 401/403、幂等 upsert（同 ql_id 二推覆盖）、payload 校验 422。
- **合并逻辑测试**：双源同 ql_id 取 PG、仅文件、仅 PG、双空。
- **前端 vitest**：tab 切换渲染、4 态徽标映射、空壳过滤开关、轮询启停纯函数、抽屉内容渲染。
- **CLI 推送测试**（sillyspec 仓）：mock fetch 断言两触发点 POST 一次、无 platform 配置静默跳过、fetch 拒绝不阻断主流程。
- **module**: test_strategy=unit-sufficient（解析纯函数 + 端点契约测试，无跨服务编排；CLI 推送 mock fetch 即可）。

## 9. 上线与兼容

- 端点只增不改；PG 表新增 migration（本项目未上线，允许重置开发数据，无历史兼容负担——PPM 模块除外，不涉及）。
- CLI 推送依赖 sillyspec 发版（≥下一版本）；未发版期间文件链路已可用（B 方案部分先验收），发版后即时性自动生效。
- gen:types 同步提交 `api-types.ts` + `backend/openapi.json`。

## 10. 文件变更清单（File Changes）

> 路径在前、说明括注在后，供 plan 覆盖对账机器匹配。

**本仓（backend）**：
- `backend/app/modules/change/quicklog_parser.py`（新增，条目解析器 + 缓存）
- `backend/app/modules/change/quicklog_service.py`（新增，合并 + enrich + 模块推导）
- `backend/app/modules/change/router.py`（修改，GET 列表/详情端点）
- `backend/app/modules/change/schema.py`（修改，QuicklogEntryList/Read DTO）
- `backend/app/modules/change/tests/test_quicklog_parser.py`（新增）
- `backend/app/modules/change/tests/test_quicklog_service.py`（新增）
- `backend/app/modules/change/tests/test_quicklog_router.py`（新增）
- `backend/app/modules/platform_sync/model.py`（修改，新增 QuicklogEntry 表）
- `backend/app/modules/platform_sync/router.py`（修改，POST /api/quicklog-entries）
- `backend/app/modules/platform_sync/service.py`（修改，upsert_quicklog_entry）
- `backend/app/modules/platform_sync/schema.py`（修改，QuicklogEntryPush DTO）
- `backend/app/modules/platform_sync/tests/test_quicklog_push.py`（新增）
- `backend/migrations/versions/`（新增 alembic migration：quicklog_entries 表）
- `backend/openapi.json`（gen:types 同步）

**本仓（frontend）**：
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`（修改，第三 tab + 查询区切换 + ?tab/?search 初始）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx`（修改，tab 用例）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（修改，反向区块）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx`（修改，反向区块用例 + quicklog mock）
- `frontend/src/components/changes/quicklog-table.tsx`（新增）
- `frontend/src/components/changes/quicklog-drawer.tsx`（新增）
- `frontend/src/components/changes/detail/quicklog-linked-card.tsx`（新增，反向「关联的快速任务」区块）
- `frontend/src/components/changes/__tests__/quicklog-table.test.tsx`（新增）
- `frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx`（新增）
- `frontend/src/lib/quicklog.ts`（新增，API client）
- `frontend/src/lib/api-types.ts`（gen:types 生成）

**跨仓（sillyspec，随本变更提交其主干）**：
- `src/quicklog.js`（修改，两触发点推送 + helper）
- `test/quicklog-push-platform.test.mjs`（新增，mock fetch 测试）

## 11. 生命周期契约

不涉及生命周期契约（本变更不创建/不修改 lease、agent_run、daemon 会话状态机；quicklog_entries 表是纯展示数据落地，无状态流转）。

## 12. 风险登记

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-01 | QUICKLOG 自由文本格式漂移（未来 CLI 版本改格式）致解析退化 | 中 | 宽松解析+未知行归自由段不丢数据；真实样本 fixture 测试钉住已知形态；解析器与 CLI 同仓演进可见 |
| R-02 | 跨仓 CLI 发版节奏延迟（推送链路晚于平台上线） | 低 | 文件链路独立交付全部展示能力；推送端点先就位，CLI 发版即生效 |
| R-03 | stale 误报（时钟偏差/长挂起会话） | 低 | stale 仅展示层推断不改数据；详情可见原始时间 |
| R-04 | 大 QUICKLOG 文件解析慢 | 低 | 1MB 截断 + mtime 指纹进程缓存 |
| R-05 | PG 与文件内容长期不一致（推送成功但文件同步失败） | 低 | 同 ql_id 取 PG 本就覆盖；文件链路只兜旧 CLI |
| R-06 | module-map 推导覆盖度低（前端类条目多为空） | 低 | 现状口径，展示「—」，非本变更债 |

## 13. 自审（Self-Review）

- ✅ 双链路职责清晰：推送管即时性、文件管兜底与离线，合并规则（ql_id 去重 PG 优先）唯一无歧义。
- ✅ Grill 7 项 minor 全部修入（CRLF/token 派生 workspace/前缀匹配/payload 构造/module-map 口径/重复状态行/白名单正则），独立核验代理复验 7/7。
- ✅ 跨仓面收敛在 1 文件（quicklog.js 两触发点），不碰 daemon/sync 主链路。
- ✅ Non-Goals 明确 6 项，防止范围蔓延（步骤进度/diff/耗时/知识页改造/CLI-daemon 联动/平台写回文件）。
- ✅ 测试策略含真实样本 fixture，风险 R-01 有对策。
- ⚠️ 已知残留：解析器对极端自由文本（手工编辑混乱条目）只能保证不崩+不丢原文，不保证字段全对——接受，QUICKLOG 本身是半结构化日志。
