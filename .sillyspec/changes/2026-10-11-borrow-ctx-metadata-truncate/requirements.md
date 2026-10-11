---
author: flow-machine-draft
created_at: 2026-10-11T04:31:07.280Z
---
# 需求规格（Requirements）— 2026-10-11-borrow-ctx-metadata-truncate

## 功能需求

### FR-01: tech_stack join 结果超 500 字符时截断加「…（已截断）」标注，与 description 同款

- `techStackText` 产出的文本（数组 join「、」或字符串原样）超 500 字符时**必须**截断至 500 并加「…（已截断）」标注——与 description 的 `DESCRIPTION_MAX_CHARS=500` 注入缓解（design R-02）同款同阈值；backend schema 对 tech_stack 无长度上限（24h 审查 P3-3：有工作区编辑权限者可借超长/指令样式字段注入借用沙箱 agent 自动加载的 AGENTS.md）。

#### 场景：超长技术栈数组

- Given tech_stack = ['x'.repeat(300), 'y'.repeat(300)]（join 后 601 字符）
- When renderBorrowSandboxContext
- Then 技术栈行含「…（已截断）」且不含完整尾部 'y'*300

### FR-02: repo_url 超 500 字符同款截断

- `repo_url` 字符串超 500 字符时**必须**同款截断标注（backend schema 同样无长度上限）。

#### 场景：超长仓库地址

- Given repo_url 长度 607
- When 渲染
- Then 仓库行含「…（已截断）」且长度受界

### FR-03: 短字段（≤500）逐字原样（零回归）

- 长度 ≤500 的 tech_stack/repo_url **必须**逐字原样渲染（含恰 500 边界值不截断）；既有渲染/透传/三态用例零回归。

#### 场景：边界 500

- Given repo_url 恰 500 字符
- When 渲染
- Then 原样出现且无「已截断」标注

### FR-04: 截断只作用于 tech_stack/repo_url，其余字段零影响 + 渲染幂等不变

- name/slug/display_alias/type/default_branch/root_path 等字段**必须**保持现状渲染（零改动）；同一 ctx 重复渲染输出一致（幂等）不变。

#### 场景：并存字段

- Given 同 ctx 携带超长 tech_stack + 正常 name/branch
- When 渲染
- Then 仅技术栈行截断，其余行与旧实现逐字一致

### FR-05: 新增截断用例先红后绿，既有用例全绿 + tsc 零错

- 新用例在旧实现上**必须**先红；实现后 borrow-sandbox-context.test.ts 全绿；`tsc --noEmit` 零错。

#### 场景：先红后绿

- When 旧实现运行 FR-01/02 用例
- Then 无「已截断」标注断言失败（红）；实现后全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「tech_stack join 超 500 截断并标注（防线对齐 description）」
FR-02: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「repo_url 超 500 截断并标注」
FR-03: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「短字段逐字原样与 500 边界不截断」
FR-04: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「渲染幂等：同一 ctx 两次渲染输出一致（同 slug 沙箱重入安全）」
FR-05: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「全字段渲染：元信息 + 真实路径只读声明 + 沙箱产出指引 + 文尾数据声明」
