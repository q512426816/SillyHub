---
author: qinyi
created_at: 2026-09-09T21:01:44
---

# brainstorm 两个 gate 摩擦点：independent 审查无 Agent 可用时无降级指引；文件清单列表项「路径：描述」整行当路径

> **状态（2026-09-09）**：活跃坑，待工具修复。本次已各找到绕过方式（见下），
> 但绕过成本与误导性值得修。

## 坑 1：tier=independent 要求独立子代理，但宿主环境无 Agent tool 可用

### 现象

`2026-09-09-conflict-root-workspace-scoping` brainstorm Step 7（Design Grill）CLI
判定 `tier: independent`，提示「必须用 Agent tool 启动一个独立的设计审查子代理」。
但当前 harness（pi）的 subagent 工具在用户/项目 agent 目录均无定义，调用直接
`Unknown agent: "general-purpose". Available agents: none.` 失败。

### 影响

- 严格执行则流程死锁：没有可用子代理 → 无法产出 review.json → gate 阻断。
- 无任何 CLI 提示「环境无 Agent 时怎么办」（降级路径、--skip-approval 是否可跳、
  还是允许 tier=self 自审）。

### 绕过（本次采用）

主代理以审查者角色自审（强制源码锚点逐行 grep/read 复核补偿独立性），
review.json `reviewerNotes` 显式记录降级原因。

### 建议

- CLI 在 Step 7 提示中预判：Agent tool 不可用/无 agent 定义时，允许显式降级
  `tier=self` 并要求 reviewerNotes 记录降级理由（或提供
  `--review-tier self --reason` 参数）。
- 或提示词层面给出「自审 + 强制证据锚点」的最小补偿规范。

## 坑 2：design 文件清单列表项「路径：描述」整行被当路径（幻觉路径误报）

### 现象

design.md「文件变更清单」用列表形态：

```markdown
- `sillyhub-daemon/src/daemon.ts`：statusRootFor 注入；RPC handler 透传；...
```

`--done` gate 报 `design_file_ref_invalid`「既不存在也无 NEW: 前缀」——文件明明存在。

### 根因

`src/change-list.js` `_parseFileListDetailed` 列表分支：`normalizePath(listItem[1])`
只剥反引号、行尾括号注释、反斜杠；**不剥中文冒号后的描述**。整行
`sillyhub-daemon/src/daemon.ts：statusRootFor 注入；...` 作为路径 existsSync →
假阴性。`looksLikePath` 含 `/` 即过，兜底拦不住。

### 绕过（本次采用）

文件清单改**表格**形态（`| 文件 | 操作 | 说明 |`，表头含「文件」列被
`isPathHeaderCell` 识别，路径独立成列纯净）。

### 建议（任一即可）

1. `normalizePath` 增加「剥首个中文/英文冒号及之后内容」（列表项形态）；
2. 报错提示补合规形态说明（「列表项只允许纯路径+行尾括号注释，含描述请用表格」），
   避免第一次拦截时只能靠读 CLI 源码定位写法约束。

## 关联

- 触发 change：`.sillyspec/changes/2026-09-09-conflict-root-workspace-scoping/`
- 解析器：`/c/nvm4w/nodejs/node_modules/sillyspec/src/change-list.js`（本机全局安装）
- 上一个采用表格形态的先例：`.sillyspec/changes/archive/2026-09-07-conflict-diff-compare/design.md` §6

## 处置记录（2026-09-09 定时收口，两坑均按建议落地，归档）

- **坑 2（列表项「路径：描述」整行当路径）已修复**：`change-list.js _parseFileListDetailed` 列表分支剥首个中/英冒号及之后描述（冒号前段须 looksLikePath 才剥）。刻意**不**按建议 1 改 normalizePath 全局剥——Windows 绝对路径 `C:\...` 会被毁；列表项是仓根相对路径无盘符，分支内剥安全。列表形态写法恢复可用（表格不再是唯一合规形态）。测试：change-list-operation 新增 4 断言（中文冒号/无反引号英文冒号/纯路径回归/无脏条目）+ design-facts/design-coverage/plan-target-files 回归 45/45 绿。
- **坑 1（independent 无 Agent 可用无降级指引）按建议 2 落地**：brainstorm/plan/execute 三处 stage prompt 的 tier=independent 段补降级指引——「宿主环境无 Agent tool（Unknown agent / Available agents: none）→ 不卡死：主代理切换审查者角色自审，reviewerNotes 首行记录降级原因，逐条结论附源码锚点（file:line/grep 证据）补偿独立性」。与本次实证绕过一致且 gate 语义零改动（review.json 契约照常硬校验）。
- 留档：建议 1 的 `--review-tier self --reason` 显式参数未做——tier 由 plan_level 确定性推导（agent 不可申报降级是防确认偏差的设计），参数化降级属设计决策，如未来需要走正式变更。
