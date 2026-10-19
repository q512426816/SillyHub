---
author: flow-machine-draft
created_at: 2026-10-19T01:06:36.704Z
---
# 需求规格（Requirements）— 2026-10-19-assets-audit-expand-toggle

## 功能需求

### FR-01: 改动文件清单超 5 条时显示「展开全部 N 个文件」按钮，点击展开完整清单，再点「收起」回到 5 条

- 资产卡「归档留档 · 改动文件」清单条数超过 `GROUP_VISIBLE_LIMIT`（5）时，必须渲染 GroupToggle 展开按钮（文案「展开全部 N 个文件 ▾」，N=清单总条数）；点击后必须展示完整清单（不再截断到 5 条），按钮变为「收起」；再点击必须回到只显示前 5 条的状态。

#### 场景：主路径

- Given：某归档变更的 `patch.file_list` 有 7 个文件（`files_truncated=false`）
- When：打开变更详情页资产卡（默认展开）
- Then：清单只显示前 5 条；存在「展开全部 7 个文件 ▾」按钮；点击后第 6/7 条可见且按钮变「收起」；再点「收起」后第 6/7 条不可见

#### 场景：大清单（用户实证）

- Given：归档变更 patch 有 180 个文件（如 2026-10-18-runtime-relayout）
- When：查看资产卡归档留档分组
- Then：默认仍只显示 5 条，但可通过「展开全部 180 个文件」看到全部清单——不再出现「无滚动也无展开、看似数据丢失」的死局

### FR-02: 清单 5 条及以内不显示展开按钮，与其它分组形态一致

- 改动文件清单条数 ≤ 5 时，禁止渲染该分组的展开按钮（GroupToggle 对 `total ≤ GROUP_VISIBLE_LIMIT` 返回 null 的既有语义不变）；audit 分组必须复用与 fr/决策/知识触达/测试绑定/模块触达五组同一 GroupToggle 组件与 `cap` 折叠机制，禁止另造第二套展开实现。

#### 场景：小清单

- Given：`patch.file_list` 只有 2 个文件
- When：资产卡渲染完成
- Then：2 条全部直接可见，audit 分组无展开按钮

### FR-03: 既有分组交互、清单截断标注行为不变，聚焦测试全绿且 tsc 零错误

- 本修复必须只影响 audit 分组的展开交互：其余五组折叠/展开行为、`files_truncated=true` 时的「清单已截断」标注、单文件 diff 弹窗、弹窗与预览机制必须保持原样；修复后 change-assets-card 聚焦测试必须全绿，`tsc --noEmit` 必须零错误。

#### 场景：回归面

- Given：既有用例「归档留档：清单渲染 + 点开命中文件出 diff 弹窗」「清单截断时显式标注」等
- When：跑 change-assets-card 聚焦测试
- Then：全部通过，无行为回退

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「归档留档：改动文件超 5 条可展开全部/收起」
FR-02: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「归档留档：清单 ≤5 条不显示展开按钮」
FR-03: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「归档留档：清单渲染 + 点开命中文件出 diff 弹窗（FR-04）」等既有聚焦用例 + `tsc --noEmit` 零错误
