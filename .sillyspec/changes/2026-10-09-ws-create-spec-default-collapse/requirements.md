---
author: flow-machine-draft
created_at: 2026-10-09T14:58:49.787Z
---
# 需求规格（Requirements）— 2026-10-09-ws-create-spec-default-collapse

## 功能需求

### FR-01: 桌面端与移动端创建工作区表单的 spec 策略默认值均为 repo-native（源项目即真理）

- 用户打开创建工作区表单时，spec 同步策略的初始选中值**必须**为 repo-native（源项目即真理）；桌面端 WorkspaceScanDialog 与移动端 WorkspaceCreateSheet 两端一致，且移动端关闭表单重置后回到同一默认值。

#### 场景：主路径

- Given 用户未改动任何选项
- When 打开创建工作区表单并直接提交
- Then 提交体 spec_strategy 为 "repo-native"

### FR-02: spec 策略单选列表默认收起，仅显示摘要行与更多选项入口；点击展开后才显示完整三选项可切换

- spec 同步策略区块**必须**默认收起：仅显示当前策略摘要行与「更多选项」入口；点击入口**必须**展开完整三选项（platform-managed / repo-mirrored / repo-native）单选列表供切换，再次点击**必须**可收起。展开/收起**禁止**影响已选中的策略值。

#### 场景：主路径

- Given 创建工作区表单已打开（spec 区块收起）
- When 点击「更多选项」
- Then 三个单选选项全部可见，当前选中 repo-native，可点选其它选项

### FR-03: 未展开时 platform-managed 与 repo-mirrored 两个选项不出现在 DOM

- spec 区块未展开时，platform-managed 与 repo-mirrored 的单选选项**禁止**出现在 DOM 中（display:none 不可接受，必须条件渲染移除）；repo-native 的策略值仍随提交体传递。

#### 场景：主路径

- Given 创建工作区表单已打开（spec 区块收起）
- Then DOM 中查询不到「平台托管」「单次导入」选项文本

### FR-04: 选项文案中平台托管（默认…）的默认字样随新默认值移除

- 由于默认值已改为 repo-native，「平台托管」选项文案**必须**去掉「默认」字样（改为「平台托管（不碰源项目，从零扫描）」），避免文案与新默认值矛盾；「源项目即真理」选项文案不变。

#### 场景：主路径

- Given 用户展开 spec 选项
- Then 平台托管选项文案不含「默认」字样

### FR-05: 选中 repo-native 时 ⚠ 写入源项目提示可见（含默认收起态）

- 当前选中策略为 repo-native 时，⚠「扫描产出会写入源项目 .sillyspec」警示文案**必须**可见，无论 spec 区块处于收起还是展开态；选中其它策略时**必须**隐藏该警示。

#### 场景：主路径

- Given 创建工作区表单已打开（默认收起 + 默认 repo-native）
- Then ⚠ 写入源项目警示文案可见

### FR-06: 提交体 spec_strategy 传当前选中值（默认 repo-native），既有创建链路无回归

- 创建工作区请求体**必须**携带当前选中的 spec_strategy 值（默认 repo-native，切换后随选中值）；后端接口与既有创建链路行为**禁止**变化（本变更纯前端交互调整）。

#### 场景：主路径

- Given 用户切换策略为 repo-mirrored 后提交
- Then 提交体 spec_strategy 为 "repo-mirrored"

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「spec 策略默认 repo-native：默认收起仅摘要行 + 直接创建提交体带 repo-native」
FR-01: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx「创建工作区默认 spec 策略 repo-native：提交体携带 + 收起态前两选项不在 DOM + ⚠ 可见」
FR-02: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「更多选项展开三选项可切换再收起不动选中值」
FR-02: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx「更多选项展开三选项可见、平台托管文案无默认字样、切换后收起摘要跟随」
FR-03: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「spec 策略默认 repo-native：默认收起仅摘要行 + 直接创建提交体带 repo-native」
FR-03: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx「创建工作区默认 spec 策略 repo-native：提交体携带 + 收起态前两选项不在 DOM + ⚠ 可见」
FR-04: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「更多选项展开三选项可切换再收起不动选中值」（展开态断言平台托管文案不含默认字样）
FR-04: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx「更多选项展开三选项可见、平台托管文案无默认字样、切换后收起摘要跟随」
FR-05: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「spec 策略默认 repo-native：默认收起仅摘要行 + 直接创建提交体带 repo-native」（收起态 ⚠ 警示可见断言）
FR-05: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx「创建工作区默认 spec 策略 repo-native：提交体携带 + 收起态前两选项不在 DOM + ⚠ 可见」
FR-06: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「更多选项展开三选项可切换再收起不动选中值」（切换后提交体随选中值）
FR-06: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx「创建工作区默认 spec 策略 repo-native：提交体携带 + 收起态前两选项不在 DOM + ⚠ 可见」（提交体断言）
