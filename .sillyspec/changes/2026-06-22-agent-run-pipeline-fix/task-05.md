---
id: task-05
title: "[B1][sillyspec] scan-docs.yaml 占位符 {SPEC_ROOT} + post-check 项目名统一"
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyspec/templates/workflows/scan-docs.yaml
  - sillyspec/src/run.js
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-05: [B1][sillyspec] scan-docs.yaml 占位符 {SPEC_ROOT} + post-check 项目名统一

## 修改文件

- `sillyspec/templates/workflows/scan-docs.yaml:16,36,56,62,80,87,95,129`（outputs.path / write_scope 全部 `.sillyspec/docs/<project>/scan/X.md`）— 改为 `{SPEC_ROOT}/docs/<project>/scan/X.md`
- `sillyspec/src/run.js:641-645`（outputStep 占位符替换块，当前已含 `{SPEC_ROOT}` 替换为 `specSillyspec`，**已存在**，本任务验证 + 补 yaml 占位符对接）
- `sillyspec/src/run.js:2627-2629`（`currentProjectName = steps[currentIdx].project || ...`）— post-check 项目名改为优先用 `change.project`（dbProjectName），perProject 标记作为兜底
- `sillyspec/src/run.js:632`（`const projectName = dbProjectName || basename(cwd)`，outputStep 占位符渲染用）— 验证 dbProjectName 已正确传入；post-check 项目名对齐此处逻辑
- `sillyspec/src/run.js:2683-2684`（archive 分支 `<change-name>` 占位符处理）— 参考实现模式（不动）

**注**：sillyspec 仓库在 `C:\Users\qinyi\IdeaProjects\sillyspec`，改动在 sillyspec 源码改 + git 提交（design §7 D-004）。

## 覆盖来源

- design.md §4.2 B1 修复步骤 3+4（yaml 占位符 {SPEC_ROOT}；outputStep 渲染替换；项目名用 change.project）
- design.md §9 兼容策略（旧 yaml 无占位符时 workflow.js fallback cwd）
- requirements.md FR-02

## 实现要求

1. **scan-docs.yaml outputs.path 改占位符**（:16, :36, :56, :62, :80, :87, :95）：
   ```yaml
   # 改前
   path: ".sillyspec/docs/<project>/scan/ARCHITECTURE.md"
   # 改后
   path: "{SPEC_ROOT}/docs/<project>/scan/ARCHITECTURE.md"
   ```
   8 处 outputs.path 全改（ARCHITECTURE / CONVENTIONS / STRUCTURE / INTEGRATIONS / TESTING / CONCERNS / PROJECT，外加 STRUCTURE 角色 :56/:62 双 output）。
2. **scan-docs.yaml write_scope 改占位符**（:129）：
   ```yaml
   # 改前
   write_scope:
     - ".sillyspec/docs/<project>/scan/"
   # 改后
   write_scope:
     - "{SPEC_ROOT}/docs/<project>/scan/"
   ```
3. **scan-docs.yaml 其余字段不动**：`name` / `description` / `roles.*.id|name|task|inputs|constraints` / `orchestration` / `checks.workflow_level` / `retry` / `on_check_failure` / `permissions.allow_*` 保持不变。注意 `checks.workflow_level` 的 `path: "scan/"`（:115）是相对 specBase/docs/<project>/ 的子路径，由 task-04 `_checkWorkflow` 拼成 `join(specBase,'docs',projectName,'scan/')`，本任务不改它。
4. **run.js:641-645 outputStep 占位符替换**（**已存在，验证生效**）：
   ```js
   // :631 if (platformOpts?.specRoot || platformOpts?.runtimeRoot) {
   //   :634 const specSillyspec = platformOpts.specRoot || join(cwd, '.sillyspec')
   //   :641-645
   promptText = promptText.replace(/\{DOCS_ROOT\}/g, docsRoot)
   promptText = promptText.replace(/\{PROJECTS_ROOT\}/g, projectsRoot)
   promptText = promptText.replace(/\{WORKFLOWS_ROOT\}/g, workflowsRoot)
   promptText = promptText.replace(/\{KNOWLEDGE_ROOT\}/g, knowledgeRoot)
   promptText = promptText.replace(/\{SPEC_ROOT\}/g, specSillyspec)
   ```
   关键：**outputStep 渲染时，yaml 的 outputs.path 进 prompt 前，`{SPEC_ROOT}` 必须已被替换为 specSillyspec 绝对路径**。当前 run.js:645 替换的是 promptText（最终给 agent 的 prompt），不是 yaml 模板里的 outputs.path。需确认 outputStep 从 yaml 加载 outputs.path 后注入 prompt 的时机——**在 :645 替换之前注入**（否则 {SPEC_ROOT} 残留）。检查 outputStep 渲染流程：yaml → outputDef.path 注入 prompt → promptText.replace({SPEC_ROOT})。若顺序反了（先替换再注入 outputs.path），outputs.path 里的 {SPEC_ROOT} 不被替换。**验证步骤**：跑一次 scan，看最终 prompt 里 outputs.path 是 `{SPEC_ROOT}/docs/...`（bug）还是 `<specBase>/docs/...`（正确）。若 bug，调整顺序：把 :641-645 的替换移到 outputStep 注入 prompt **之后**。
5. **run.js:2627-2629 post-check 项目名改用 change.project**：
   ```js
   // 改前
   const currentProjectName = steps[currentIdx].project
     || (steps[currentIdx].name.match(/\[([^\]]+)\]\s*$/) || [])[1]
     || null
   // 改后：优先 change.project（dbProjectName，平台模式真实项目名），
   // perProject 标记 steps[idx].project 作为兜底（兼容旧展开模式）
   const currentProjectName = (typeof change !== 'undefined' && change?.project)
     || steps[currentIdx].project
     || (steps[currentIdx].name.match(/\[([^\]]+)\]\s*$/) || [])[1]
     || null
   ```
   **关键**：`change.project` 是 backend 创建 change 时传入的真实项目名（如 `myaaa`）；`steps[idx].project` 是 perProject 展开标记（子项目扫描时可能展开成 `frontend`、`backend` 等子项目名，但当前场景 scan 是单项目，steps[idx].project 应等于 change.project；日志显示变 `frontend` 是 perProject 误展开的 bug，本任务用 change.project 修正）。确认 `change` 变量在 :2627 作用域可见——run.js scan handler 上文应已加载 change 对象（执行 sillyspec run 时 --change 参数）；若不可见，从函数参数或上下文取（dbProjectName 变量在 :632 已用，同一作用域）。
6. **dbProjectName 与 change.project 关系**：run.js:632 `const projectName = dbProjectName || basename(cwd)`——outputStep 占位符渲染用的 projectName。post-check 项目名应与之一致（同一 change 的项目名）。本任务把 post-check 项目名也对齐 `dbProjectName || change.project`（二者应等价，dbProjectName 来自 change.project 的快照）：
   ```js
   const currentProjectName = dbProjectName
     || (typeof change !== 'undefined' && change?.project)
     || steps[currentIdx].project
     || (steps[currentIdx].name.match(/\[([^\]]+)\]\s*$/) || [])[1]
     || null
   ```
7. **archive 分支项目名**（run.js:2685 `runPostCheck(resolved, cwd, 'sillyspec')`）：archive 的 projectName 固定 `'sillyspec'`（archive 文档写在 specBase/docs/sillyspec/），本任务不动（archive 不存在 myaaa/frontend 分裂问题）。
8. **TDD**：写测试覆盖占位符替换 + 项目名优先级。

## 接口定义

- **yaml 占位符**：`{SPEC_ROOT}`（大括号包裹，全大写），由 run.js:645 `promptText.replace(/\{SPEC_ROOT\}/g, specSillyspec)` 替换为 specSillyspec 绝对路径。与既有 `{DOCS_ROOT}` / `{PROJECTS_ROOT}` / `{WORKFLOWS_ROOT}` / `{KNOWLEDGE_ROOT}` 占位符风格一致。
- **`<project>` 占位符**（小写尖括号）：yaml 内既有的 perProject 展开标记，由 `replaceProjectPlaceholder(wf, projectName)`（workflow.js:245）替换为 projectName。本任务不动 `<project>` 语义。
- **outputStep 渲染顺序**：yaml → outputDef.path（含 `{SPEC_ROOT}` 与 `<project>`）→ 注入 prompt → `replaceProjectPlaceholder`（替换 `<project>`）→ `promptText.replace({SPEC_ROOT})` → 最终 prompt（含绝对路径）。
- **post-check 项目名优先级**：`dbProjectName` > `change.project` > `steps[idx].project` > `steps[idx].name` 正则提取 > null。

## 边界处理（≥5 条，覆盖 null/兼容性/异常/不可变/歧义）

1. **旧 yaml 无占位符（兼容）** — 用户自定义 workflow yaml 未用 `{SPEC_ROOT}`，outputs.path 写 `.sillyspec/docs/...` → run.js:645 `replace(/\{SPEC_ROOT\}/g, ...)` 不命中（无 `{SPEC_ROOT}` 字面），prompt 原样保留 `.sillyspec/docs/...` → task-04 `_checkWorkflow` 回退 `join(cwd, '.sillyspec', ...)` → 行为与改动前一致（向后兼容，design §9）。
2. **`{SPEC_ROOT}` 与 `<project>` 占位符共存** — yaml outputs.path = `{SPEC_ROOT}/docs/<project>/scan/X.md`，两个占位符独立替换：`{SPEC_ROOT}` 由 run.js:645 替换，`<project>` 由 `replaceProjectPlaceholder` 替换。替换顺序无依赖（两者正则不冲突），结果 = `<specBase>/docs/<projectName>/scan/X.md`。
3. **SPEC_ROOT 含空格** — specSillyspec 绝对路径含空格（如 `C:/Program Files/spec`）→ prompt 里 outputs.path 变 `C:/Program Files/spec/docs/.../X.md`（含空格）。agent 按 prompt 路径写文件时需正确处理空格（Write 工具用引号或参数传递，非 shell 拼接）。本任务不处理空格转义（agent 侧职责）。
4. **dbProjectName / change.project 均缺失** — 非平台模式 scan（无 platformOpts）→ dbProjectName 为 undefined → change 可能未加载 → 回退 `steps[idx].project`（perProject 标记）→ 再回退 name 正则 → 最后 null。null 时 :2633 `if (currentProjectName)` 走 else 分支（检查所有项目），行为与改动前一致。
5. **perProject 多项目展开** — 若 scan 展开成多个子项目（steps 数组每项 project 不同），`steps[idx].project` 是当前步骤的子项目名。本任务改优先级为 dbProjectName > change.project > steps[idx].project，**会覆盖**子项目展开语义——但 scan 当前是单项目（design 日志显示 myaaa 单项目，perProject 误展开是 bug），用 change.project 是修正。若未来真需多项目 scan，需重新设计项目名传递（YAGNI，当前场景单项目）。
6. **`{SPEC_ROOT}` 未被替换（顺序 bug）** — 若 outputStep 注入 prompt 在 :645 替换之后，yaml 里的 `{SPEC_ROOT}` 残留进 prompt → agent 写文件到 `{SPEC_ROOT}/docs/...`（字面目录名）→ post-check 找不到。**验证步骤**（见实现要求 4）必须确认替换顺序正确。
7. **workflow_level check path "scan/"** — yaml :115 `path: "scan/"` 是相对 `specBase/docs/<project>/` 的子路径，由 task-04 `_checkWorkflow` 拼 `join(specBase,'docs',projectName,'scan/')`。本任务不改 :115，保持相对路径语义（与 outputs.path 改绝对路径解耦——outputs.path 是给 agent 看的绝对路径，workflow_level.path 是给 _checkWorkflow 看的相对子路径）。
8. **write_scope :129 占位符** — `write_scope` 是给 sillyspec 权限校验用的（控制 agent 能写哪些目录），改成 `{SPEC_ROOT}/docs/<project>/scan/` 后，权限校验时也需替换占位符。确认 sillyspec 内部 write_scope 校验逻辑是否走了同样的占位符替换——若未走，write_scope 会字面含 `{SPEC_ROOT}` 导致权限拒绝。**验证步骤**：跑 scan 看 agent 写文件是否被 write_scope 拒绝；若拒绝，扩展 write_scope 替换逻辑（与 :645 同款 replace）。
9. **archive 分支不受影响** — archive 用 `archive-impact.yaml`（非 scan-docs.yaml），项目名固定 'sillyspec'，本任务不动。

## 非目标

- 不改 `<project>` 占位符语义（perProject 展开由 replaceProjectPlaceholder 处理）。
- 不改 archive yaml 或 archive 项目名（固定 'sillyspec'）。
- 不改 workflow_level check path（:115 `scan/` 相对路径）。
- 不处理多项目 scan 展开（YAGNI，当前单项目）。
- 不改 sillyspec 权限校验核心逻辑（除非 write_scope 占位符导致拒绝，才扩展替换）。
- 不动 `{DOCS_ROOT}` / `{PROJECTS_ROOT}` 等既有占位符。

## TDD 步骤

1. **写测试**：扩展 `sillyspec/test/templates.test.js` 或新建 `scan-docs-yaml.test.js`：
   - 加载 `templates/workflows/scan-docs.yaml`，断言所有 outputs.path（8 处）匹配 `^\{SPEC_ROOT\}/docs/<project>/scan/.*\.md$`。
   - 断言 write_scope 含 `{SPEC_ROOT}/docs/<project>/scan/`。
   - 断言其他字段（roles.id / orchestration / checks.workflow_level.path）未变。
2. **写测试**：扩展 `sillyspec/test/run.test.js`：
   - outputStep 渲染：yaml outputs.path=`{SPEC_ROOT}/docs/<project>/scan/X.md` + platformOpts.specRoot='/tmp/spec' + dbProjectName='myaaa' → 渲染后 prompt 含 `/tmp/spec/docs/myaaa/scan/X.md`，不含 `{SPEC_ROOT}` 字面。
   - 项目名优先级：dbProjectName='myaaa' + steps[idx].project='frontend' → currentProjectName === 'myaaa'（dbProjectName 优先）。
   - 项目名兜底：dbProjectName=undefined + change.project=undefined + steps[idx].project='frontend' → currentProjectName === 'frontend'（兜底）。
   - 旧 yaml 兼容：outputs.path=`.sillyspec/docs/<project>/scan/X.md`（无 {SPEC_ROOT}）→ prompt 原样保留（replace 不命中），不报错。
3. **确认失败**：改代码前跑测试，yaml 占位符测试 + 项目名优先级测试全部失败。
4. **写代码**：按"实现要求"改 scan-docs.yaml（8 处 path + 1 处 write_scope）+ run.js:2627-2629 项目名优先级。
5. **确认通过**：重跑测试，全部通过。
6. **回归**：对 fixture 项目跑 `sillyspec scan`，最终 prompt 里 outputs.path 是绝对路径（无 `{SPEC_ROOT}` 残留）；post-check 检查的路径与 prompt 写入路径一致（都是 `<specBase>/docs/<dbProjectName>/scan/`）；项目名不再变 `frontend`（除非 dbProjectName 真是 frontend）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | grep `scan-docs.yaml` 内 `path:` | 8 处 outputs.path 均为 `{SPEC_ROOT}/docs/<project>/scan/*.md` |
| AC-02 | grep `scan-docs.yaml` 内 `write_scope:` | 含 `{SPEC_ROOT}/docs/<project>/scan/` |
| AC-03 | 平台模式 scan，最终 agent prompt 里 outputs.path | 含 `<specBase>/docs/<projectName>/scan/X.md` 绝对路径，**不含** `{SPEC_ROOT}` 字面 |
| AC-04 | 平台模式 scan，prompt 写入路径 vs post-check 检查路径 | 完全一致（消除 myaaa/frontend 分裂） |
| AC-05 | dbProjectName='myaaa' 跑 scan post-check | currentProjectName === 'myaaa'（不再变 frontend） |
| AC-06 | dbProjectName 缺失 + steps[idx].project='frontend' | currentProjectName === 'frontend'（兜底，向后兼容） |
| AC-07 | 旧自定义 yaml（outputs.path 无 {SPEC_ROOT}） | scan 正常跑（replace 不命中，回退 cwd/.sillyspec，不报错） |
| AC-08 | sillyspec 单测（yaml 占位符 + run.js 项目名优先级） | 全部通过 |
| AC-09 | 端到端：对 myaaa 跑 scan | post-check 不再报"目录不存在 .sillyspec/docs/frontend/scan/"；检查的是 `<specBase>/docs/myaaa/scan/` |
| AC-10 | grep `run.js` :2627 附近 currentProjectName 赋值 | 优先级链：dbProjectName → change.project → steps[idx].project → name 正则 → null |
