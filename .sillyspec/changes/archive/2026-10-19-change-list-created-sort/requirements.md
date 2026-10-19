---
author: flow-machine-draft
created_at: 2026-10-19T03:30:00.000Z
---
# 需求规格（Requirements）— 2026-10-19-change-list-created-sort

## 功能需求

### FR-01: 后端 _resolve_order_by 白名单新增 created_at_desc/created_at_asc；API 缺省 fallback 保持 updated_at_desc 不变

- sort 参数值 `created_at_desc` MUST 映射 `Change.created_at desc`、
  `created_at_asc` 映射 asc（白名单硬编码映射，禁止拼接 SQL）；缺省/未知值
  MUST 维持 fallback updated_at_desc（契约零变化）。

#### 场景：主路径

Given 三行创建时间相差一天，When sort=created_at_desc，Then 越新越靠前；
asc 反序；sort=garbage 与缺省行为同旧。

### FR-02: 前端列表默认 created_at_desc；列头「创建时间」点击切换降/升序；旧深链兼容

- 列表页无 sort URL 参数时 MUST 以 created_at_desc 请求；列头文案 MUST 为
  「创建时间」，点击 MUST 在 created_at 降/升序切换并回第一页；`sort=updated_at_*`
  旧深链 MUST 兼容解析；buildChangesQuery 默认省略值 MUST 为 created_at_desc
  （默认 URL 干净契约不变）。

#### 场景：主路径

Given 无 sort 参数进列表，Then listChanges 收 sort=created_at_desc；点列头 →
created_at_asc；旧深链 sort=updated_at_asc 解析不回默认。

### FR-03: 聚焦测试：后端排序用例 + 前端默认/切换/契约用例全绿；tsc 通过

- 本变更 MUST 补后端 created_at 排序用例与前端默认/列头切换/序列化契约用例，
  MUST 跑绿列表页既有全部用例，MUST 通过 tsc 与 ruff/mypy；禁止跑全量测试。

#### 场景：主路径

Given 改动落地，When 跑 test_change_lineage_filter.py + 列表页测试，Then 全绿
（9 + 52 passed），tsc exit 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_change_lineage_filter.py「test_sort_created_at_desc_newest_first」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「点创建时间列头 → sortDir 切换，默认 created_at_desc 点击后 asc」+「URL query 契约」用例（sortDir created_at_desc 省略）
FR-03: 同 FR-01/FR-02 绑定用例（backend 9 + frontend 52 passed + tsc exit 0 实测留痕）
