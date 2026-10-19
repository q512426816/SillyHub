---
author: flow-machine-draft
created_at: 2026-10-19T11:08:26.361Z
---
# 需求规格（Requirements）— 2026-10-19-cross-repo-patch-slicing

## 功能需求

### FR-01: assets/patch-file 端点新增可选 repo 参数（未命中已解析 repos keys 按 note 降级不抛错），切片取 change-patch.json 对应仓 repos[].patch 内联正文，复用既有切片与上限逻辑

- `repo` 在场时端点 MUST 从 `scopeAudit.repos[repo].patch` 内联正文切片目标文件；未知仓键/该仓无正文/未命中 MUST 以 note 说明（与主仓切片同款 fail-open，不抛 404/422）；超 `_PATCH_FILE_MAX_CHARS` MUST 截断并标注；`repo` 缺省时行为 MUST 与现状逐字节一致。

#### 场景：跨仓命中切片

- Given repos 含 subgrid 且 patch 有 src/y.js 块
- When GET patch-file?repo=subgrid&path=src/y.js
- Then 返回该文件 diff 段，note=None

#### 场景：未知仓/无正文仓

- Given repo=nosuch 或降级仓（patch=null）
- When 同端点
- Then diff=None 且 note 点名原因

### FR-02: 资产卡仓段下列出该仓文件清单（后端从 patch 头解析投影，超上限截断标注），点开单文件弹窗看跨仓 diff

- `ChangePatchRepo` MUST 增 `file_list`（从 repos[].patch 头解析的新侧路径，去重保序）与 `files_truncated`（超 `_PATCH_FILES_MAX` 标注）；资产卡仓段 MUST 渲染文件清单并支持点开单文件，弹窗 MUST 标注「跨仓 <key> · …」与 repos[] 数据源；无 file_list 仓段零渲染。

#### 场景：仓段文件清单

- Given subgrid 有 file_list 两条
- When 渲染跨仓段
- Then 出现「subgrid 改动文件」清单；点击调 patch-file 带 repo 参数并在弹窗显示跨仓 diff

### FR-03: 后端单测覆盖命中/未知仓/无 repos 三态，前端组件测试覆盖列表与点开弹窗，类型重生成同步

- 变更 MUST 交付后端单测（file_list 投影 + 切片命中/未知仓/无正文三态）与前端组件测试（清单渲染 + 点开带 repo 参数 + 弹窗跨仓标注）；openapi.json 与两处 api-types MUST 由生成器重生成同提交。

#### 场景：验证面

- Given 实现完成
- When 运行 test_assets.py 与 change-assets-card.test.tsx 及 tsc
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_assets.py::test_patch_file_diff_repo_hit_and_unknown
FR-02: backend/app/modules/change/tests/test_assets.py::test_patch_meta_repo_file_list；frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面 按仓渲染锚点/计数/降级，主仓 patch 标注口径（清单 + 点开断言）
FR-03: backend/app/modules/change/tests/test_assets.py::test_patch_meta_repo_file_list；backend/app/modules/change/tests/test_assets.py::test_patch_file_diff_repo_hit_and_unknown；frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面 按仓渲染锚点/计数/降级，主仓 patch 标注口径
