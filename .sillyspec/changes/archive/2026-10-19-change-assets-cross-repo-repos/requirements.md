---
author: flow-machine-draft
created_at: 2026-10-19T07:14:26.388Z
---
# 需求规格（Requirements）— 2026-10-19-change-assets-cross-repo-repos

## 功能需求

### FR-01: assets DTO 增 scopeAudit.repos 元数据（key/锚点/计数/降级/patchSha256，不回传 patch 正文），旧归档无 repos 时零变化

- 平台 MUST 从 `change-patch.json` 的 `scopeAudit.repos[]` 投影仓键/锚点/三态计数/降级原因/patchSha256/是否有正文；MUST NOT 投影 patch 正文与 repoPath；坏条目（非对象/无 key）MUST 跳过；旧归档无该键时 `repos` MUST 为空数组（additive，零行为变化）。

#### 场景：跨仓冻结投影

- Given JSON-only 跨仓冻结（主仓 files=[]，repos[] 含健康仓+降级仓+坏条目）
- When 读取变更资产
- Then DTO 的 repos 按序投影健康仓与降级仓，坏条目跳过；健康仓含锚点/计数/sha/has_patch=True 且不含 patch 正文与 repo_path

#### 场景：旧归档兼容

- Given change-patch.json 无 scopeAudit.repos
- When 读取变更资产
- Then repos=[]，files/file_list 等既有字段逐字节不变

### FR-02: 变更资产卡按仓分段展示跨仓冻结面，并标注主仓/各仓口径避免双计歧义

- 资产卡 MUST 在 repos 非空时按仓渲染（仓键/锚点/计数/降级说明），MUST 将顶级 patch 统计标注为「主仓 patch」，MUST 给出「完整 diff 见 change-patch.json 全屏预览」指路；repos 为空时 MUST 维持既有展示（跨仓段与主仓标注均不出现）。

#### 场景：有跨仓面

- Given 资产响应含 repos（健康仓 + 降级仓）
- When 渲染归档留档区
- Then 出现跨仓段、仓键/锚点短哈希/计数与降级原因，顶级 patch 行带「主仓」前缀

#### 场景：无跨仓面

- Given 资产响应无 repos 键
- When 渲染归档留档区
- Then 不渲染跨仓段，patch 行保持原文案

### FR-03: 后端单测覆盖 repos 投影与缺键/降级形态，前端类型检查与构建通过

- 变更 MUST 交付后端单测（健康仓/降级仓/坏条目/旧归档零变化）与前端组件测试（有/无 repos 两态）；MUST 通过后端 pytest、前端 vitest、tsc --noEmit，且 openapi.json 与 api-types.ts 由生成器重生成（不手改）。

#### 场景：验证面

- Given 实现完成
- When 运行 test_assets.py 与 change-assets-card.test.tsx 及 typecheck
- Then 全部通过，生成物无手改痕迹

### FR-04: 既有 patch 语义不变：files/totals 仍为主仓面

- `ChangePatchMeta.files/additions/deletions/file_list` MUST 继续只反映主仓冻结面（跨仓计数只在 repos[]），MUST NOT 被 repos 数据改写或相加。

#### 场景：主仓面隔离

- Given JSON-only 跨仓冻结（files=[]，repos 有 112 文件）
- When 读取资产
- Then patch.files=0 且 file_list=[]，跨仓 112 只在 repos[].totals

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_assets.py::test_patch_meta_projects_cross_repo_metadata；backend/app/modules/change/tests/test_assets.py::test_patch_meta_without_repos_key_is_backward_compatible
FR-02: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面 按仓渲染锚点/计数/降级，主仓 patch 标注口径；frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面 无 repos 键时旧展示零变化
FR-03: backend/app/modules/change/tests/test_assets.py::test_patch_meta_projects_cross_repo_metadata；frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面 按仓渲染锚点/计数/降级，主仓 patch 标注口径
FR-04: backend/app/modules/change/tests/test_assets.py::test_patch_meta_projects_cross_repo_metadata
