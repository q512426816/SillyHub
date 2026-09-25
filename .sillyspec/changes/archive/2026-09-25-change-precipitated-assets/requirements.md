---
author: flow-machine-draft
created_at: 2026-09-25T04:00:03.768Z
---
# 需求规格（Requirements）— 2026-09-25-change-precipitated-assets

## 功能需求（成功标准机械摘录）
<!-- MACHINE-DRAFT:requirements-frs:e3cb30ef10d2ce1a33eb6eeed85ba093b3c4fc770551b4567902e2f9c4e7978e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-precipitated-assets 留痕重锚 -->
### FR-01: 沉淀资产聚合端点
Given 变更已归档且 spec 树镜像含其沉淀产物
When 调用 GET /workspaces/{ws}/changes/{cid}/assets
Then 返回 FR 索引/决策蒸馏归属条目（「变更：」行过滤）+ 测试绑定行 + patch 统计 + delta 摘要；逐项 fail-open，在途变更跳过目录件

### FR-02: 变更详情沉淀资产卡
Given 用户在变更详情页 aside
When 渲染「沉淀资产」折叠卡
Then 四组逐组有数据才渲染（FR/决策行可跳知识库页）、失败静默隐藏、在途变更显示引导空态

### FR-03: 聚焦验证全绿
Given 本变更交付
When 跑聚焦测试与静态检查
Then 后端 test_assets.py 5 用例 + 前端 change-assets-card 5 用例 + tsc + ruff 全绿
<!-- MACHINE-DRAFT:requirements-frs:end -->

<!--AGENT:槽1 需求例外裁决（FR 语义改写不走此槽——直接编辑机器段后跑 flow amend-draft 留痕，槽内容不进 FR 索引）——例外裁决书写面（机器段之外合法） -->

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_assets.py：test_golden_aggregation（归属过滤/目录件投影/patch 缺席 None）+ test_inflight_change_skips_dir_files + test_corrupt_json_fail_open + test_not_found_reraises

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx：四组渲染+计数徽标 / 逐组容错 / 在途引导空态 / 归档全空态 / 失败静默 五用例

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
uv run pytest app/modules/change/tests/test_assets.py（5 passed，回执 .sillyspec/.runtime/logs/c2-backend-test.log）+ pnpm exec tsc --noEmit（exit 0）+ pnpm test -- change-assets-card（5 passed，回执 logs/c2-fe-test.log）+ ruff format --check/check 双过（61 files already formatted / 0 errors）
