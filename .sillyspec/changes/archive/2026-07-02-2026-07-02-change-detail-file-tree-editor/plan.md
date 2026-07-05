---
author: qinyi
created_at: 2026-07-02 10:56:13
change: 2026-07-02-change-detail-file-tree-editor
plan_level: full
---

# 实现计划

> 任务编号采用顺序 task-01..task-15（与 TaskCard 一致）。tasks.md 原始编号（task-01..17）已合并/重排：原 task-08（删 get_document_content）并入 task-07；原 task-13（删生命周期图）并入 task-11；原 task-09（kind 列）→ task-02；其余顺序推进。

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01 | daemon-client 平台镜像卷 `/data/spec-workspaces/<wid>/` 在 backend 容器内可写 | 容器内 `echo > /data/spec-workspaces/<wid>/changes/<key>/.writetest` 成功 | task-05 镜像直写降级为纯 outbox（POST 不写镜像，task-06 resync 推迟到 daemon complete+sync 后由前端轮询触发 `POST /changes/{cid}/resync` 兜底端点） |

> 唯一技术不确定点。其余设计确定（spec_root 解析、path_source 分流、daemon runChangeWrite 通用均已核实）。

## Wave 1 — 基础（并行，无依赖）

- [x] task-01: `_resolve_change_dir` spec_root 解析 helper（覆盖：FR-03, D-006@v1）
- [x] task-02: `DaemonChangeWrite` 加 `kind` 列 + migration（down→202607011300，execute 时复核 head）+ schema 透传（覆盖：FR-05, FR-08）

## Wave 2 — 文件读取（依赖 W1 task-01）

- [x] task-03: `list_files` 遍历变更目录全部文件（依赖 task-01）（覆盖：FR-03）
- [x] task-04: `read_file` 按 path 读单文件 + 路径守卫 + 1MB 截断（依赖 task-01）（覆盖：FR-04, D-004@v1）

## Wave 3 — 写回 + resync + pending（依赖 W1）

- [x] task-05: `write_file` path_source 分流 + 同文件 pending 合并（依赖 task-01, task-02）（覆盖：FR-05, FR-06, D-001@v1, D-002@v1, D-006@v1）
- [x] task-06: `_resync_change_docs` per-change 文档刷新（依赖 task-01）（覆盖：FR-07, D-005@v1）
- [x] task-07: `list_pending_files` 查询 pending/claimed edit 行（依赖 task-02）（覆盖：FR-08）

## Wave 4 — 端点接线 + 死代码清理（依赖 W2 + W3）

- [x] task-08: 4 新 router 端点 + schema（ChangeFileList/Content/WriteRequest/WriteResponse/PendingFileList）+ **删除** `GET /documents/{doc_type}` 死端点 + **删除** `get_document_content` service 方法（依赖 task-03, 04, 05, 06, 07）（覆盖：FR-02, FR-03~FR-08, D-008@v1）

## Wave 5 — 前端（依赖 W4 端点契约）

- [x] task-09: `lib/change-files.ts` API 封装 + `buildChangeFileTree`（依赖 task-08）（覆盖：FR-03~FR-09）
- [x] task-10: `change-file-tree.tsx` 文件树 + 编辑器 + 保存状态机 + 排队徽标 + last_synced_at（依赖 task-09）（覆盖：FR-09, D-003@v1）
- [x] task-11: `[cid]/page.tsx` 删文档完整性 panel + DOC_TABS 查看器 + 死代码、接入 `<ChangeFileTree>`，**并** `changes/page.tsx` 删生命周期 SectionCard（依赖 task-10）（覆盖：FR-01, FR-02, D-008@v1）
- [x] task-12: `lib/changes.ts` 删 `getChangeDocumentContent`（+视情况 `getChangeDocuments`）死 wrapper（依赖 task-11 确认无引用）（覆盖：FR-02, D-008@v1）

## Wave 6 — 测试（依赖对应实现 Wave）

- [x] task-13: 后端 list/read/write/pending + 路径穿越 + 两分支单测（依赖 task-08）（覆盖：FR-03~FR-06, D-004@v1）
- [x] task-14: edit-kind outbox 入队 + pending 合并 + 离线续传单测（依赖 task-05, task-08）（覆盖：FR-06, D-001@v1, D-002@v1）
- [x] task-15: 前端 change-file-tree 渲染 + 状态机 + 排队徽标 + jsdom vi.mock（依赖 task-10）（覆盖：FR-09）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | `_resolve_change_dir` helper | W1 | P0 | — | FR-03, D-006@v1 |
| task-02 | DaemonChangeWrite kind 列 + migration + schema | W1 | P0 | — | FR-05, FR-08 |
| task-03 | `list_files` 遍历 | W2 | P0 | task-01 | FR-03 |
| task-04 | `read_file` + 守卫 | W2 | P0 | task-01 | FR-04, D-004@v1 |
| task-05 | `write_file` 分流 + pending 合并 | W3 | P0 | task-01, task-02 | FR-05, FR-06, D-001@v1, D-002@v1, D-006@v1 |
| task-06 | `_resync_change_docs` | W3 | P0 | task-01 | FR-07, D-005@v1 |
| task-07 | `list_pending_files` | W3 | P1 | task-02 | FR-08 |
| task-08 | 4 端点 + schema + 删 documents 死端点 + 删 get_document_content | W4 | P0 | task-03,04,05,06,07 | FR-02, FR-03~FR-08, D-008@v1 |
| task-09 | `lib/change-files.ts` | W5 | P0 | task-08 | FR-03~FR-09 |
| task-10 | `change-file-tree.tsx` 组件 | W5 | P0 | task-09 | FR-09, D-003@v1 |
| task-11 | `[cid]`+`changes` 页面改造（删 A+B+生命周期图、接入文件树） | W5 | P0 | task-10 | FR-01, FR-02, D-008@v1 |
| task-12 | 删前端死 wrapper | W5 | P2 | task-11 | FR-02, D-008@v1 |
| task-13 | 后端单测 | W6 | P0 | task-08 | FR-03~FR-06, D-004@v1 |
| task-14 | outbox 续传单测 | W6 | P0 | task-05, task-08 | FR-06, D-001@v1, D-002@v1 |
| task-15 | 前端组件单测 | W6 | P1 | task-10 | FR-09 |

## 关键路径

task-01 → task-03/04 → task-08 → task-09 → task-10 → task-11 → task-13/15（读写+端点+前端主线）
task-02 → task-05 → task-08（写回分支并入主线）
spike-01 → 决定 task-05 镜像直写是否成立（不通过则降级纯 outbox + task-06 resync 推迟）

## 全局验收标准

- [ ] spike-01 通过（镜像卷可写）或降级方案落地
- [ ] migration `alembic upgrade head` 无多 head；`downgrade` 可回滚
- [ ] 后端 list/read/write/pending 四端点经 task-13/14 单测覆盖（含路径穿越拒、两分支、pending 合并、离线续传）
- [ ] 前端 task-15 覆盖文件树渲染 + 5 态状态机 + 排队徽标（jsdom vi.mock）
- [ ] 变更中心无生命周期图、列表/分页/搜索/新建/重新扫描零回归
- [ ] 变更详情无文档完整性面板 + 无 DOC_TABS 查看器、文件树展示全部文件
- [ ] daemon-client 工作区能读出文档内容（root_path 失效随 get_document_content 删除消除）
- [ ] 现有创建变更 / 归档门禁 / agent dispatch 零回归（task-13/14 回归断言）
- [ ] （brownfield）未升级 daemon 的客户端仍能消费 edit-kind 行（files 写回逻辑不变）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-14 | outbox 不 await + 离线续传（task-14 断言 pending 保持） |
| D-002@v1 | task-05, task-14 | 同文件 pending 合并（task-14 断言单行更新 content） |
| D-003@v1 | task-10 | last_synced_at 展示 + 离线警告条 |
| D-004@v1 | task-04, task-13 | 路径守卫（task-13 穿越 attack 拒） |
| D-005@v1 | task-06, task-08 | POST 时 per-change resync |
| D-006@v1 | task-01, task-05 | path_source 分流（task-13 两分支） |
| D-007@v1 | task-04, task-05, task-10 | 仅编辑现有文件（二进制只读、无新建入口） |
| D-008@v1 | task-08, task-11, task-12 | 删 A+B + 死代码清理 |

## execute 执行约束（平台模式 worktree bug 规避）

本项目平台模式 `sillyspec execute worktree` 不可用（每次 run 清理 .runtime 摧毁 worktree meta，见 `docs/sillyspec/runtime-cleanup-destroys-worktree-meta.md`）。execute 阶段改用**主仓库直接改 + TaskCard 驱动**（参考 changes-align-sillyspec 变更做法）：每个 Wave 在主仓库 `C:\Users\qinyi\IdeaProjects\multi-agent-platform\` 直接编辑源码，按本 plan 的 task checkbox 逐项推进，`--done` 用 progress complete-stage 推进。
