---
author: flow-machine-draft
created_at: 2026-10-07T14:58:35.066Z
---
# 需求规格（Requirements）— 2026-10-07-assets-patch-scope-audit-fallback

## 功能需求

### FR-01: 归档目录无 change-patch.json 但有 scope-audit.json 时，归档留档 patch 块出数：files/additions/deletions 取 totals，file_list 取 rows[].path，patch_status/saved_at 取快照同名字段

- 归档目录缺 change-patch.json 而存 scope-audit.json 时，`_read_patch_meta` 必须回退
  读快照投影出 patch 统计：files/additions/deletions 取 totals，file_list 取
  rows[].path（非字符串 path 行跳过），patch_status/saved_at 取快照同名字段。

#### 场景：主路径

- Given 厚流程形态归档（只有 scope-audit.json + scope-audit.patch）
- When 查询变更沉淀资产
- Then patch 非 None，统计与清单来自快照（files=2/+3/−0、file_list 两行、status=ok、saved_at 带时间戳）

### FR-02: 该形态下点文件看 diff 从 scope-audit.patch 切片（复用既有切片函数），弹窗可看

- change.patch 缺失时，`_read_patch_file_diff` 必须改读 scope-audit.patch 并复用
  `slice_patch_for_file` 切出目标文件段；未命中时 note 必须指名实际留档文件名。

#### 场景：主路径

- Given 厚流程形态归档且 scope-audit.patch 含 src/flow.js 块
- When 请求该文件 diff 切片
- Then 返回 diff 含该块内容；请求清单外文件则 note 含「不在 scope-audit.patch」

### FR-03: 两份留档都缺失时 patch 仍为 None 且 diff 端点 note 说明缺两份留档（fail-open 语义保留）

- 两份留档（change-patch.json 与 scope-audit.json / change.patch 与
  scope-audit.patch）都缺失时，行为必须保持 fail-open：patch 投影为 None，diff 端点
  note 同时列明两份留档缺失，禁止抛错。

#### 场景：主路径

- Given 归档目录只有 scope-audit.json、无任何 patch 件
- When 请求文件 diff 切片
- Then diff=None 且 note 同时含「change.patch」与「scope-audit.patch」字样

### FR-04: change-patch.json 存在时行为与现状完全一致（thin 形态回归不破）

- change-patch.json 存在（含两份并存的 hypothetical 形态）时，取数必须仍以
  change-patch.json 为唯一来源，file_list 投影与统计口径禁止变化。

#### 场景：主路径

- Given 归档目录同时有 change-patch.json（+2/−0）与 scope-audit.json（+3/−0）
- When 查询变更沉淀资产
- Then patch 统计取 change-patch.json 的 totals（+2/−0），file_list 同其 files 数组

### FR-05: assets 模块聚焦测试通过

- 交付必须包含 assets 模块聚焦测试且全部通过（含上述回退/优先级/双缺三态与既有
  24 例回归），禁止跑全量测试（留给 CI）。

#### 场景：主路径

- Given 本变更的代码与测试已落盘
- When 运行 `pytest app/modules/change/tests/test_assets.py`
- Then 28 passed（既有 24 + 新增 4），ruff/mypy 对改动文件零告警

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_assets.py「test_patch_meta_falls_back_to_scope_audit_snapshot」
FR-02: backend/app/modules/change/tests/test_assets.py「test_patch_file_diff_falls_back_to_scope_audit_patch」
FR-03: backend/app/modules/change/tests/test_assets.py「test_patch_file_diff_without_any_patch_artifact」
FR-04: backend/app/modules/change/tests/test_assets.py「test_patch_meta_change_patch_takes_priority」
FR-05: backend/app/modules/change/tests/test_assets.py「test_patch_meta_projects_file_list + 既有 24 例全量回归」
