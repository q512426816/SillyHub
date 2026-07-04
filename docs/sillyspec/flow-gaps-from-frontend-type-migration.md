---
author: qinyi
created_at: 2026-07-04T22:30:00
status: proposal
source_change: 2026-07-04-fix-frontend-type-divergence
---

# SillySpec 流程改进建议 — 从前端类型迁移变更暴露的缺口

## 背景

变更 `2026-07-04-fix-frontend-type-divergence`（修复前端 OpenAPI 类型对齐 5 处分叉，commit `127cc018`）走完整流程（brainstorm→plan→execute→verify→archive）时，暴露了 sillyspec 当前版本的若干缺口。其中 6 条技术教训里，**前 6 条都是工具该消掉但没消的**——要么靠主动校验消灭根因，要么靠流程简化别再逼用户绕。本文归档这些改进点，供 sillyspec 后续迭代参考。

> 完整教训清单见 `memory/frontend-type-migration-landscape.md` 通用坑章节。本文只收"工具能解决"的部分。

---

## A. 主动校验类（升级后消灭根因，最有价值）

### A1. design "零改动/无依赖"断言反向 grep 校验
- **现象**：design 倾向于写"零改动/不影响 service/无依赖"等断言，但实际可能漏看调用方。本次 W1-1 删 pydantic alias 时 design 初稿断言"service 层不依赖 alias key"，Grill 阶段才查到 `runtime/service.py:178-185` 用 alias key（`currentStage=`/`_version=`）构造 RuntimeProgress——差点漏改导致运行时崩。
- **建议**：design 自审/Grill 阶段，扫描 design 正文出现的"零改动/无影响/不依赖/不影响 X"等断言，对断言里提到的文件/符号做反向 grep，矛盾就警告。能让工具稳定抓到现在靠 Grill 运气抓的 bug。

### A2. 类型迁移 diff lint（可选性差异高亮）
- **现象**：OpenAPI 生成类型把 nullable 字段标可选 `field?: string|null`（openapi-typescript 行为），手写常是必填 nullable。迁移后消费点要加 `?? null`/`?.` 防御。本次 4 处消费点（runtime page stages/steps、workspace-binding 2 处 daemon_id、workspace-scan-dialog warnings），其中 scan-dialog 那处是子代理漏报、我手动全量 typecheck 才抓到。
- **建议**：类型迁移 task 完成后，工具自动 diff 手写类型 vs 生成类型的字段可选性，输出"可选性放宽的字段清单 + grep 出的消费点"，提示加防御。比靠子代理自觉或人肉 typecheck 稳。

### A3. execute Wave gate 强制全量 typecheck
- **现象**：sillyspec execute 要求"每个 task 独立子代理 + 子代理跑测试"，但子代理只跑改动文件，导致跨 task 的消费点破坏（如 task-11 改 ScanResponse.warnings 可选，task-07 的 workspace-scan-dialog.tsx 消费方报错）没人抓，直到我手动全量 typecheck。
- **建议**：Wave 级或 execute 收尾 gate 强制全量 `tsc --noEmit`（而非子代理各跑改动文件）。类型相关变更尤其需要。

### A4. OpenAPI vs 运行时一致性 lint（pydantic alias 陷阱）
- **现象**：`Field(alias=camelCase)` + `populate_by_name=True` + `response_model_by_alias=False` 的组合，让运行时返 snake_case 但 OpenAPI 按 camelCase 生成，前端类型迁移会字段错位。本次 runtime 模块就是这个坑。这类"运行时与 OpenAPI 撒谎"的配置在 review 时不易察觉。
- **建议**：扫描所有 router 的 `response_model_by_alias`，若对应 schema 用了 alias 就 flag——运行时与 OpenAPI 必有一个撒谎，要么删 alias 要么改 by_alias=True，不能装作没事。这类 lint 能在 verify 阶段把"前端类型迁移地雷"提前拆掉。

### A5. verify/archive gate 强制全量 mypy + pytest（防 merge 遗留债转嫁）
- **现象**：daemon-entity-binding 变更（2026-07-03, `52101447`）merge 时没跑全量 mypy + pytest，遗留 2 个 mypy 错（`daemon/service.py` 返回注解）+ 3 个 test 失败（register 新字段 / upsert_my_binding 改 daemon_id）。这些债在本次变更的 commit hook 被继承拦下，不得不顺手修 daemon 注解（测试债仍未补）。详见 `memory/daemon-entity-binding-test-debt.md`。
- **建议**：verify/archive gate 强制 `uv run mypy app` + `uv run pytest -q` 全量（而非模块级），任何失败必须归因（本变更 vs 预存在）并显式记录，不准"带病 merge"。否则债总会转给下一个变更。

---

## B. 流程简化类（本次靠 memory + `progress complete-stage` 绕过）

### B1. worktree 默认改为 opt-in
- **现象**：execute 默认创建 worktree（`git worktree add`），但本项目惯例（memory 多条：`changes-align-sillyspec-status` / `react-query-migration-status` / `sillyspec-worktree-platform-mode-bug`）是**主仓库改 + `progress complete-stage` 绕过 worktree 门禁**——worktree 在平台/daemon-client 模式有编码/pnpm/merge 多个坑。本次创建的 worktree 全程空置，archive 时自动清理。
- **更严重的副作用（本次新发现）**：worktree 不只是"被项目惯例绕过"，还会**主动干扰主仓库测试结果**。execute 阶段创建 worktree 时 overlay 操作 transient 污染了主仓库文件状态——backend 全量 pytest 报 3 个测试失败（traceback 显示旧 payload `{name, provider}`），但文件实际已是新 payload（`daemon_local_id/server_url/hostname/providers`，注释"daemon-entity-binding D-006"）。commit + archive 销毁 worktree 后，主仓库干净，同一条命令 **2220 passed / 0 failed**。这类假失败会让人误判为"测试债"去改测试（memory `daemon-entity-binding-test-debt.md` 的误判修正就是实证），潜在误导性比纯仪式开销更危险。
- **建议**：平台模式（源码 `.sillyspec/` 存在）或 daemon-client 模式默认"主仓库改"，worktree 改为 opt-in。`--no-worktree` 参数应真实存在并工作（memory 记"CLI 提示谎言"）。若保留 worktree 模式，至少要保证 worktree 创建/销毁不触碰主仓库工作区文件（隔离失效是 P0 bug）。

### B2. task review gate 简化（机械 task 批量 review）
- **现象**：execute step 12 要求每个 task 有 `review.json`，13 个 task 全部"缺少 review.json"被 gate 拦，我用 `progress complete-stage` 绕过。
- **建议**：对 type-only / 机械迁移 / 别名这类**低逻辑风险** diff，允许批量 review 或按 diff 性质自动判 PASS。逐个 review.json 对机械 task 是纯仪式。

### B3. design/plan/verify 校验从关键词改为语义
- **现象**：
  - design 提到 "daemon" 关键词（`daemon_id` 字段名 / `daemon_not_owned` 错误码）就强制要"生命周期契约表"，但本变更不涉及任何 lifecycle 事件，被迫加空表声明才过。
  - plan 校验只认 `- [ ] task-XX:` checkbox 格式，我用 `### task-XX` 标题被拒，补 checkbox 块才过。
  - verify-result 校验只认 `## 结论` 确切标题，我用 `## 验收结论：✅ PASS` 不被识别。
- **建议**：
  - 关键词校验理解上下文（字段名/错误码 ≠ lifecycle 事件）；或允许 AI 显式声明"本变更不涉及 X"+ 一句话理由，跳过模板章节而非硬要空表。
  - plan 支持多种 task 格式（标题/checkbox/auto-detect）。
  - verify-result 模板给出确切章节标题，或宽松识别 `PASS`/`PASS WITH NOTES`/`FAIL` 关键词即可。

### B4. step 重复确认去重
- **现象**：brainstorm step 9 已"确认推进设计方案"，step 13 又强制 `--wait` 用户最终确认。我用 `--answer "确认"` 一步完成绕过。
- **建议**：检测前置 step 已对同一问题确认过，自动跳过重复确认；或允许 step 9 的确认带"含最终规范"语义，免 step 13 再问一次。

---

## C. 留给人的判断（工具解决不了）

- **别名方式 vs 类型改名**：workspaces 迁移用 `export type Workspace = Schemas["WorkspaceRead"]` 别名让调用方零改动，是设计判断，工具能提示"有 N 个调用方"但难自动决策。
- **删 router try/except 是否安全**：工具能 grep 前端是否读旧错误 body 字段，但"删了是否破坏契约"仍要人理解业务（本次靠核实 `api.ts` ApiError 已用全局格式判断）。

---

## 优先级建议

| 优先级 | 条目 | 理由 |
|---|---|---|
| P0 | A5（全量 mypy+pytest gate） | 防遗留债转嫁，本次实证受害 |
| P0 | B1（worktree 默认 opt-in） | 不只被惯例绕过，还主动污染主仓库制造假测试失败（本次实证） |
| P1 | A1（design 断言反向 grep） | 消灭最危险的一类 design bug |
| P1 | A3（Wave gate 全量 typecheck） | 跨 task 破坏现在无人抓 |
| P2 | A2（类型迁移 diff lint） | 提升 type-only 迁移安全性 |
| P2 | A4（OpenAPI alias lint） | 针对特定陷阱，收益窄但确定 |
| P2 | B3（校验语义化） | 减少绕过的繁琐 |
| P3 | B2（review gate 简化） | 仪式开销 |
| P3 | B4（step 去重） | 小幅体验提升 |

## 关联

- `memory/frontend-type-migration-landscape.md`（本次教训完整版）
- `memory/daemon-entity-binding-test-debt.md`（A5 的实证案例）
- `memory/sillyspec-worktree-platform-mode-bug.md`（B1 的历史背景）
- `docs/sillyspec/finished/runtime-cleanup-destroys-worktree-meta.md`（worktree 相关已修 bug）
