---
author: flow-machine-draft
created_at: 2026-10-09T04:12:25.717Z
---
# 需求规格（Requirements）— 2026-10-09-knowledge-touch-marker-sunset

## 功能需求

### FR-01: backend change assets 聚合摘除「待复核」标记反查面，knowledge_touch 单一来源为 knowledge_hits inject 实时命中

- 必须删除 `_REVIEW_MARK_RE` 常量与 `_scan_domain_files`/`_parse_entries_owned_by` 的 `owner_line_re` 可选参数（该参数只为标记反查而设，死面不留）；`get_change_assets` 的 knowledge_touch 必须**仅**来自 `_live_touch_rows`（knowledge_hits 表 type=inject 行的 matched_anchors 展开去重）；API 响应形状（`ChangeKnowledgeTouch` 的 id/title/file 三字段）不变。`ChangeKnowledgeTouch` 的 schema docstring 必须改为注入命中留痕口径（原「标记反查、以标记为准」措辞已失真），并按仓规重生成 openapi.json + api-types.ts。

#### 场景：标记行不再进触达面

Given 域文件存在「待复核：<变更名>」行且库中无该变更的 inject 行 / When 聚合 / Then knowledge_touch == []（标记行被无视）。

#### 场景：归档态与在途同源

Given 变更已归档且库中有 inject 行 / When 聚合 / Then 触达面内容与在途态同源同序（无归档特化合并路径）。

#### 场景：归属解析不受影响

Given 域文件含「变更：<change_key>」归属行 / When 聚合 / Then fr_entries/decisions 归属条目解析行为与改前逐字一致（owner_line_re 删参不触碰默认 `变更：` 语义）。

### FR-02: 前端知识触达标题与悬停文案统一为注入命中留痕口径

- 知识触达组标题必须恒为「知识触达（本变更注入命中的知识）」（在途/归档同一文案，不再有「· 实时」尾标分裂）；悬停提示必须说明口径为执行期 CLI 知识注入命中留痕（在途期间随执行增长、归档后定格），禁止出现「待复核」「以标记为准」字样。

#### 场景：在途与归档同文案

Given knowledge_touch 非空 / When 分别以 archived=true 与 archived=false 渲染 / Then 两次标题与悬停文案一致。

### FR-03: 触达条目渲染去重与分组收拢

- id 与 title 同值时必须只渲染一份文本（不得出现同一 slug 连排两遍）；整文件路由条目（id==file 的裸文件形态）必须收拢为「整文件」chip 行（链接只带 file 参数不带 anchor）；锚点条目必须按 file 分组渲染（组头为文件链接，组内条目只显示锚点 slug），不得 48 行平铺混排。

#### 场景：同 slug 去重

Given 条目 id==title==slug / When 渲染 / Then 该 slug 在组内文本中恰好出现一次。

#### 场景：整文件与锚点分形

Given 同组数据含裸文件条目（fr/daemon.md）与锚点条目（known-issues.md#slug）/ When 渲染 / Then 裸文件以 chip 呈现且 href 无 anchor 参数，锚点条目挂在各自文件组头下。

### FR-04: 相关测试更新并通过（仅跑相关，不全量）

- 必须通过 backend `uv run pytest app/modules/change/tests/test_assets.py` 与 frontend 卡片测试 `change-assets-card.test.tsx`；schema 描述变更必须随 `pnpm gen:types` 重生成 openapi.json + api-types.ts 且无漂移；禁止跑全量测试（全量留给 CI）。

#### 场景：主路径

Given 改动落盘 / When 跑上述两组定向测试 / Then 全绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_assets.py「金样本聚合 + live 触达标记忽略」用例
FR-02: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「知识触达统一文案」用例
FR-03: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「同 slug 去重与整文件分组」用例
FR-04: 不适用：FR-04 即测试任务本身，由 FR-01~03 绑定行覆盖（另含 gen:types 漂移检查）
