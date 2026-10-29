---
author: flow-machine-draft
created_at: 2026-10-29T02:11:51.669Z
---
# 需求规格（Requirements）— 2026-10-29-edit-diff-stat-badge

## 功能需求

### FR-01: Edit/Write 工具调用完成后，对话视图跑马灯「读写文件 · Edit/Write xxx」完成态条目尾部显示 diff 统计：绿色 +新增行数、红色 -删除行数（纯新增如 Write 只显示 +N，无删除时不显示 -0）

- 工具段 status=ok 且携带 editPatch（structuredPatch JSON）时，跑马灯对应完成态条目尾部**必须**显示 diff 统计徽标：`+新增行数`（绿色）、`-删除行数`（红色）；removed=0 时**必须**只显示 `+N`，**禁止**显示 `-0`。

#### 场景：Edit 完成带 patch

Given 工具段 status=ok、editPatch 解析得新增 11 行删除 7 行
When 跑马灯渲染该完成态条目
Then 条目尾部显示 `+11`（绿）`-7`（红）

#### 场景：Write 新文件全增

Given 工具段 status=ok、editPatch 解析得新增 120 行删除 0 行
When 跑马灯渲染该完成态条目
Then 条目尾部只显示 `+120`（绿），不出现 `-0`

#### 场景：无 patch 的完成条目

Given 工具段 status=ok 但 editPatch 缺省（非 Edit/Write 工具）
Then 条目尾部不显示统计徽标（既有渲染零变化）

### FR-02: 进度视图（turn-segment-views）对应工具行尾部显示同款统计，两处口径一致

- 进度视图 ToolRowView 完成态（status=ok）行尾**必须**显示与 FR-01 同款统计徽标（同一解析函数、同一徽标组件），位置在状态徽标之后、时长之前；两处**必须**口径一致。

#### 场景：同段两视图一致

Given 同一工具段 status=ok、editPatch 新增 11 删除 7
When 对话视图跑马灯与进度视图 ToolRowView 分别渲染
Then 两处均显示 `+11 -7`，颜色与格式一致

### FR-03: 统计仅从 editPatch（structuredPatch）解析，解析失败或无数据不显示（不伪造、不估数）

- 统计**必须**仅从 tool 段 editPatch（structuredPatch JSON）解析：hunks[].lines 行前缀 `+` 计新增、`-` 计删除、`\` 跳过，多 hunk 累计；JSON 非法 / 空 hunks / 计数 0/0 时**必须**不显示徽标；**禁止**用 LCS 自算、字符数估算或 hunk 头 oldLines/newLines 相加充数。

#### 场景：非法 JSON

Given editPatch 为非法 JSON 字符串
Then 不显示统计徽标，不抛错

#### 场景：零改动 patch

Given editPatch 解析成功但新增删除均为 0
Then 不显示统计徽标

### FR-04: 运行中态不显示统计（结果未定），失败态不显示统计

- 工具段 status=running（result 未配对）或 status=deny（失败/被拒）时**禁止**显示统计徽标；运行中 result 未到 editPatch 自然缺省，失败态即使残留 editPatch 也**必须**门控不显示。

#### 场景：运行中

Given 工具段 status=running
Then 不显示统计徽标

#### 场景：失败态带 patch

Given 工具段 status=deny 且段上残留 editPatch
Then 不显示统计徽标

### FR-05: 现有跑马灯与进度视图相关测试全部通过；新增统计纯函数用例与两处渲染用例

- 本变更落地时现有 turn-live-marquee / turn-segment-views 相关既有用例**必须**全部通过（零回归）；**必须**新增统计纯函数用例（含多 hunk 累计、非法输入、`\` 行跳过）与跑马灯、进度视图两处渲染用例。

#### 场景：回归

When 运行 frontend 下 turn-live-marquee / turn-segment-views 相关测试
Then 既有用例全部通过，新增用例全部通过

### FR-06: tsc / eslint 0 error

- frontend 的 tsc --noEmit 与 eslint **必须** 0 error（存量 warning 不新增）。

#### 场景：静态检查

When 运行 tsc --noEmit 与 lint
Then 0 error

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「完成态 Edit 条目显示 +N -M 统计徽标」「Write 全增只显示 +N 不显示 -0」
FR-02: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「ToolRowView 完成态显示 diff 统计徽标」
FR-03: frontend/src/components/agent-log/__tests__/tool-diff.test.tsx「diffStatFromPatch 多 hunk 累计与行前缀计数」「非法 JSON / 空 hunks / 零改动返回 null」
FR-04: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中与失败条目不显示统计徽标」
FR-05: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx + frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「既有用例零回归」
FR-06: 不适用：静态检查为 tsc/eslint 命令面，非测试文件用例可覆盖
