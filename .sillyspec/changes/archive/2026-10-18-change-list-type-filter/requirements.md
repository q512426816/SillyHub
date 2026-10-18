---
author: flow-machine-draft
created_at: 2026-10-18T13:39:27.067Z
---
# 需求规格（Requirements）— 2026-10-18-change-list-type-filter

## 功能需求

### FR-01: 后端 list_ 与 GET /changes 新增 change_type 筛选参数：白名单（conventional 前缀 + feature/prototype/quick 旧值），feat 筛选等价命中旧值 feature（与显示层映射口径一致），未知/缺省值不过滤

- `change_type` 筛选 MUST 仅对白名单值生效（conventional 前缀 + 旧枚举值），
  feat MUST 等价命中 change_type ∈ {feat, feature}（显示层映射的逆口径）；
  白名单外/缺省值 MUST 不过滤（对齐 lineage/sort fallback 风格）；筛选 MUST
  在 SQL where 层完成（分页 total 为全局真实 N）。

#### 场景：主路径

Given 库内行 feat/feature/fix 各一，When list_(change_type="feat")，Then 返回
feat+feature 两行 total=2；change_type="fix" 仅 fix 行。

#### 场景：白名单外

Given 同上三行，When change_type="garbage"，Then 全部返回不过滤（与缺省同）。

### FR-02: CommitTypeChip 从详情页抽为公共组件，列表行 meta 行 change_key 后复用渲染类型彩色标签（含 feature→feat 显示映射、空值零占位）

- 类型标签 MUST 由公共组件 CommitTypeChip 渲染（详情侧栏与列表行同源同款，
  样式/映射单一源）；列表行 change_type 为空 MUST 零占位（不渲染标签节点）；
  feature SHOULD 显示层映射为 feat（数据不动）。

#### 场景：主路径

Given 列表行 change_type=fix/feature/null 各一，Then 渲染恰两枚标签（文本
fix / feat），fix 红色阶；null 行无标签节点。

### FR-03: 前端筛选栏新增「类型」下拉（全部类型/feat/fix/docs/chore/test/refactor/perf/build/style/原型），URL 参数 type 持久化、tab 切换随既有筛选一并回默认、与 tab/搜索/分类/聚焦组合生效

- 「类型」下拉 MUST 以 URL 参数 type 持久化（空值省略，默认 URL 干净），
  选择后 MUST 回第一页；重置 MUST 随既有筛选一并回默认；参数 MUST 进
  queryKey 与请求（changeType），与 tab/搜索/分类/聚焦正交组合；非法值
  MUST 解析回默认（TYPE_OPTIONS 校验）。

#### 场景：主路径

Given 列表页，When 下拉选「fix（修复）」，Then listChanges 收到
changeType="fix" 且 URL 含 type=fix；点重置后 changeType 清除。

### FR-04: 聚焦测试：后端 change_type 筛选用例（feat 等价命中 feature、未知值不过滤）+ 前端列表页筛选与行标签用例全绿；tsc 通过

- 本变更 MUST 补齐并跑绿聚焦测试（后端筛选用例 + 前端列表页行标签/筛选用例
  + 详情侧栏既有标签用例零回归），MUST 通过 tsc 与后端 ruff/mypy；禁止 跑
  全量测试（CLAUDE.md 规则 0）。

#### 场景：主路径

Given 改动落地，When 跑 test_change_lineage_filter.py + 列表页/侧栏组件测试，
Then 全绿（8 + 52 + 11 passed），tsc exit 0，ruff/mypy 干净。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_change_lineage_filter.py「test_change_type_filter_feat_aliases_legacy_feature / test_change_type_filter_exact_match_and_fallback」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「行 meta 显示类型彩色标签：fix 原值、feature 等价映射 feat、空值零占位」+ frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「类型行：已知前缀渲染彩色标签（fix 红色阶 / docs 蓝色阶）」等四用例（组件抽公共件后零回归）
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「类型下拉选择「fix」→ listChanges 收到 changeType=fix；重置后清除」+「URL query 契约」用例（buildChangesQuery 含 typeFilter 后两端钉死）
FR-04: 同 FR-01/FR-02/FR-03 绑定用例（backend 8 + frontend 52/11 passed + tsc exit 0 + ruff/mypy 干净实测留痕）
