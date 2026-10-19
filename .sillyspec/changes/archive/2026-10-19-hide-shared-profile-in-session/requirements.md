---
author: flow-machine-draft
created_at: 2026-10-19T02:23:47.129Z
---
# 需求规格（Requirements）— 2026-10-19-hide-shared-profile-in-session

## 功能需求

### FR-01: 真会话(非 provisional)档案下拉必须隐藏平台共享智能体条目(按 active 生效列表的 agent_profile_id 集合过滤,不按名称匹配)

- 真会话（SessionConfigBar 非 provisional 模式）的档案下拉中，系统必须隐藏所有命中 shared-agents/active 生效列表（按 agent_profile_id 集合判定，禁止按档案名称匹配）的平台共享智能体条目；active 列表请求失败降级 [] 时不过滤（现状零回归）。

#### 场景：主路径

- Given 真会话配置条，档案候选含普通档案与共享智能体档案（id ∈ active 列表）
- When 打开档案下拉
- Then 共享智能体条目不渲染，普通档案照常可选

### FR-02: 当前会话档案本身恰为共享智能体时,该条目在真会话下拉中保留可见(共享会话不被饿死,但不提供共享档案互切)

- 当前会话的 agent_profile_id 恰为共享智能体档案时，该条目在真会话档案下拉中必须保留（可见、当前项标识正常），即隐藏规则必须豁免当前选中项；其余共享档案条目仍隐藏。

#### 场景：共享会话自身

- Given 平台共享会话（agent_profile_id=共享档案 id）
- When 打开档案下拉
- Then 当前共享档案条目在列（带 ✓），其它共享档案（若 active 有多条）不渲染

### FR-03: 预会话(provisional)档案下拉保留共享智能体条目且置顶显示(排序在普通档案之前,普通档案间保持原序)

- 预会话（provisional 模式）档案下拉中，系统必须保留共享智能体条目并将其置顶（排在全部普通档案之前），普通档案之间保持原相对顺序。

#### 场景：主路径

- Given 预会话配置条，档案候选顺序为 [普通A, 共享S, 普通B]
- When 打开档案下拉
- Then 渲染顺序为 [共享S, 普通A, 普通B]

### FR-04: 聚焦测试覆盖上述分支,tsc 0 错误

- 本变更必须以聚焦组件测试覆盖 FR-01~FR-03 全部分支（真会话隐藏、当前共享项豁免、预会话置顶、active 失败降级不过滤），既有共享标识用例按新行为语义迁移（真会话→预会话场景），且 `pnpm exec tsc --noEmit` 0 错误。

#### 场景：主路径

- Given 变更代码完成
- When 运行聚焦测试文件与 tsc
- Then 全部用例通过、tsc 无错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「真会话档案下拉隐藏共享智能体条目（按 active id 过滤）」
FR-02: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「当前会话档案为共享智能体时该条目保留可见」
FR-03: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「预会话档案下拉共享智能体置顶且带共享标识」
FR-04: 不适用：tsc 与聚焦测试命令为质量门槛（CI 面），非单条用例可断言；分支覆盖由 FR-01~03 绑定行承担
