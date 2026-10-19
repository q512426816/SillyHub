---
author: qinyi
created_at: 2026-10-16 17:25:00
plan_level: full
execution_mode: main  # 缺省直写（任务以顺序依赖为主、单会话可吞吐；task-03∥task-04 文件正交但体量小，直写不派发）
change: 2026-10-16-conflict-full-tree-compare
---
# 实现计划（Plan）— 2026-10-16-conflict-full-tree-compare

## Spike 前置验证

无——技术方案无不确定性：后端兜底（一次重试 + 段边界前缀过滤 + 快照 `files[].path` 裁剪）与前端分支/入口均为既有栈既有模式；daemon 侧零改动（兜底只是以另一个记录名调用既有 RPC，行为既有）。唯一需实现期小验证的是「兜底快照 entry 形状」，用既有 test_sillyspec_compare 的 mock 形态即可覆盖，无需 Spike。

## Wave 1（无依赖）
- task-01

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2；两卡文件正交可真并行）
- task-03
- task-04

## Wave 4（对账与聚焦回归，依赖 Wave 3）
- task-05

## Wave 5（部署真机复验，依赖 Wave 4）
- task-06

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 full-tree 兜底 + 响应字段 + 文案 | W1 | P0 | — | FR-01/FR-02, D-001@v1, D-005@v1, D-006@v2, D-009@v1 | `_fetch_snapshot` 抽内层按记录名取快照；仅 spec-tree 且 `conflict_record_missing` 时以 `full-tree` 重取一次；归属校验与裁剪一律以快照 `files[].path` 段边界前缀为准；`record_label/covered_changes/path_total` 三可选字段；文案改「重新同步」口径；测试钉住命中/未命中/不触发/文案 |
| task-02 | 契约同步 gen:types ×2 | W2 | P0 | task-01 | FR-05, D-008@v1 | openapi.json + 前端 api-types + daemon api-types 同 change 提交（规则 21/闸门⑨） |
| task-03 | 前端对比弹窗失败卡四臂 + 来源提示 | W3 | P0 | task-02 | FR-02/FR-03, D-004@v1, D-006@v2, D-012@v1 | 分支键＝`details.daemon_code`（外层恒 502）；record_missing/root_unknown 无重试；504 家族保留重试；其余通用失败；full-tree 命中时顶部来源提示条 |
| task-04 | 前端行级「标记已处理」入口 | W3 | P0 | task-02 | FR-04, D-003@v1, D-012@v1 | `resolveSpecConflict` 客户端 + registry 行带 id + 按钮/确认文案（关闭范围=整条记录含兄弟变更名行）+ invalidate `[...QUERY_KEY_ROOT,"spec-conflicts",ws]` |
| task-05 | 原型对账 + 聚焦回归 | W4 | P1 | task-03, task-04 | FR-05, D-007@v2 | `pnpm prototype:build` 对账（git diff 空）+ 后端 compare 用例族 + 前端两测试文件 + 本改动面 lint/typecheck |
| task-06 | 部署真机复验 | W5 | P0 | task-05 | 成功标准, D-008@v1 | 部署腾讯云生产，用现网 `2026-10-13-fire-unitadd-form-import` 行验证对比/来源提示/文案分支/关闭入口；证据落 verify 记录 |

## 全局硬约束

- **快照输入面**：daemon 快照 `SillySpecConflictSnapshot` **无** `conflicting_paths`；一切归属判定/裁剪只许用 `files[].path` 与顶层键（change/kind/ql_id/conflict_created_at/local_updated_at/progress）——违反即 FR-01 静默失效（D-006@v2）。
- **兜底次数**：只重试一次，禁止递归/多次（D-009@v1）。
- **路径匹配**：段边界前缀 `changes/<change>/` 或 `changes/archive/<change>/`（名字后必须紧跟 `/`），禁止裸 startswith（D-012@v1 / R-01）。
- **错误码分支键**：前端必须用 `details.daemon_code`；外层 `code` 恒 `HTTP_502_DAEMON_RPC_REMOTE`（D-012@v1）。
- **类型同步**：后端 schema 改动必须在同一 change 内 gen:types ×2 并提交三文件（规则 21）。
- **不改 daemon/CLI**：不改 `sillyhub-daemon/src/**` 业务代码、不改 WS/RPC 协议、不改 CLI 记录命名（D-001/D-002/D-010/D-011 非目标）。
- **主题 token 铁律**：前端改动零硬编码色，走既有组件与主题 token。

## Review Focus 盲区清单（隐含面）

| # | 隐含面 | 拥有该代码的 task | 落到何处（acceptance/测试） |
|---|---|---|---|
| 1 | `_build_spec_tree_compare` 入参形状假设：兜底裁剪后 `files[]` entry 必须完整（path/content 等字段不裁，只过滤条目） | task-01 | acceptance：mock 快照断言裁剪后 entry 字段齐全；用例「兜底命中」+「段边界防误吞」 |
| 2 | 既有断言失效：`test_sillyspec_compare.py` 现断言旧文案「冲突记录已失效」（conflict_record_missing → 文案表） | task-01 | related_tests + 该卡内更新既有断言（同文件） |
| 3 | 既有断言失效：`conflict-compare-modal.test.tsx:362-366` 断言失败卡「读取对比数据失败」+「重试」（504 固定句在组件源 `conflict-compare-modal.tsx:267`） | task-03 | related_tests + 该卡内改为四臂断言（以真实断言现状为准，不按文案臆断） |
| 4 | 既有断言失效：`platform-sync-section.test.tsx` 行渲染（按钮集合/行数）可能被新增「标记已处理」打破 | task-04 | related_tests + 该卡内同步断言 |
| 5 | gen:types 联动面：openapi 变更会重写 daemon 生成物 `sillyhub-daemon/src/api-types.ts`（闸门⑨ fail-closed） | task-02 | acceptance：三文件同 change 提交 + `pnpm gen:types:check` 通过 |
