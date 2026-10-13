---
author: flow-machine-draft
created_at: 2026-10-13T15:09:03.043Z
---
# 需求规格（Requirements）— 2026-10-13-change-owner-backfill

## 功能需求

### FR-01: reparse 新建无主变更行时，负责人兜底取工作区所有者（只填新行，不覆盖已有 owner_id 的行）

- reparse 扫描发现新变更建行时，必须将该变更行的 owner_id 兜底填充为工作区所有者（`workspace.created_by`）；已有行（无论 owner_id 有值或为空）在 reparse 更新路径必须保持 owner_id 原值不变，禁止覆盖、禁止对存量空行回填。

#### 场景：新建行兜底填充

- Given 工作区所有者 created_by=user-A，磁盘上出现扫描范围内的新变更目录（库中无对应行）
- When reparse 扫描该工作区
- Then 新建变更行 owner_id == user-A

#### 场景：已有 owner 的行不被覆盖

- Given 变更行 owner_id=user-B（change_writer 代理写入路径落的值）
- When reparse 扫描该工作区（该变更走 update 分支）
- Then 该行 owner_id 仍为 user-B

#### 场景：存量空行不回填

- Given 存量变更行 owner_id 为 NULL（历史扫描建行）
- When reparse 扫描该工作区（该变更走 update 分支）
- Then 该行 owner_id 仍为 NULL（存量行由 FR-03 前端兜底显示，不改写数据）

#### 场景：工作区无所有者

- Given workspace.created_by 为 NULL
- When reparse 发现新变更建行
- Then 新行 owner_id 为 NULL（不报错，前端 FR-03 兜底继续兜）

### FR-02: 变更列表负责人列直接显示 owner_name 文本（不再只显示首字小圆）

- 变更列表行的负责人位在 owner_name 有值时，必须直接渲染名字文本（保留首字头像作视觉锚点、title 悬浮提示完整含义）；仅有 owner_id 无 owner_name 时必须显示 ID 前 8 位 mono 文本。禁止只渲染首字小圆而无文字。

#### 场景：有 owner_name

- Given 变更行 owner_name="系统管理员"
- When 渲染变更列表行
- Then 负责人位显示首字头像 +「系统管理员」文本，title 含「负责人 系统管理员」

#### 场景：仅有 owner_id

- Given 变更行 owner_id 有值、owner_name 为空
- When 渲染变更列表行
- Then 负责人位显示 ID 前 8 位 mono 文本，title 含完整 ID 提示

### FR-03: 无 owner 的行负责人列兜底显示工作区所有者名字而非「—」

- 变更行 owner_name 与 owner_id 双空时，列表必须兜底显示当前工作区所有者的 display_name（`workspace.owner.display_name`），title 必须标注该值为兜底语义（负责人未指派、默认工作区所有者）；工作区所有者也无名（owner 为 null 或 display_name 为空）时才允许显示「—」。移动端变更卡（MobileChangeCard）必须以同口径兜底（fallbackOwnerName prop，弱化色区分），未传 prop 时保持「—」（存量调用兼容）。

#### 场景：双空 + 工作区有所有者

- Given 变更行 owner_id/owner_name 均为空，workspace.owner.display_name="系统管理员"
- When 渲染变更列表行
- Then 负责人位显示该所有者名字文本，title 标注兜底语义

#### 场景：双空 + 工作区无所有者

- Given 变更行 owner_id/owner_name 均为空，workspace.owner 为 null
- When 渲染变更列表行
- Then 负责人位显示「—」

### FR-04: 后端 reparse owner 兜底有单测覆盖（新建行兜底填充 / 已有 owner 不覆盖）

- 后端必须以单元测试覆盖 FR-01 的三个分支：新建行兜底填充 workspace.created_by、已有 owner 的行更新后不被覆盖、存量空行更新后仍为空；测试必须真实走 reparse（sync）路径断言落库值，禁止只测纯函数。

#### 场景：主路径

- Given 测试工作区与变更目录夹具
- When 运行 reparse 单测
- Then 三分支断言全部通过

### FR-05: 前端负责人渲染相关测试通过

- 前端变更列表页负责人渲染必须由组件测试覆盖 FR-02/FR-03 场景（owner_name 文本渲染 / owner_id mono 渲染 / 双空兜底工作区所有者 / 全空显示「—」），且既有列表页测试必须全部保持通过。

#### 场景：主路径

- Given changes page 测试夹具（mock listChanges/getWorkspace）
- When 运行 vitest
- Then 新增用例与既有用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_reparse_owner_backfill.py「reparse 新建行兜底填 workspace.created_by 为 owner」
FR-01: backend/app/modules/change/tests/test_reparse_owner_backfill.py「reparse 更新不覆盖已有 owner_id」
FR-01: backend/app/modules/change/tests/test_reparse_owner_backfill.py「reparse 存量空 owner 行不回填」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「负责人列显示 owner_name 文本与 owner_id mono」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「无 owner 行兜底显示工作区所有者名字」
FR-03: frontend/src/components/mobile/mobile-change-card.test.tsx「双空 + fallbackOwnerName 兜底工作区所有者名（移动端同口径）」
FR-04: backend/app/modules/change/tests/test_reparse_owner_backfill.py（同 FR-01 三用例 + created_by 为 None 边界，绑定即覆盖）
FR-05: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx（FR-02/03 用例 + 既有列表页用例全绿）
FR-05: frontend/src/components/mobile/mobile-change-card.test.tsx（兜底两分支 + 既有移动卡用例全绿）
