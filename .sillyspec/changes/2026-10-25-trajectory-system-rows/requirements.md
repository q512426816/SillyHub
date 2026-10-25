---
author: flow-machine-draft
created_at: 2026-10-25T00:44:49.791Z
---
# 需求规格（Requirements）— 2026-10-25-trajectory-system-rows

## 功能需求

### FR-01: 轮首用户行与 user_msg 段的文本以团队指令特征前缀开头时，轨迹账本显示为「系统」类型行（kind=system + meta.systemBrief），标签「系统」，摘要照常显示原文

- `trajectoryFromTurnViews` **必须**对轮首用户行（prompt 行）与 `user_msg` 段做团队指令特征前缀识别：文本以「你是多 Agent 团队的主 agent」或「你是多 Agent 团队中的一个」开头时，行映射为 `kind=system` 并置 `meta.systemBrief=true`（账本标签「系统」），摘要照常显示原文；未命中前缀的用户消息 **必须** 保持「用户」行（零回归）。前缀常量 **必须** 以注释锚定 backend 文案来源（orchestrator.py:495 / execution.py:210,229 / mission_context.py:204）。

#### 场景：主路径

Given 一轮 prompt 以「你是多 Agent 团队的主 agent（项目经理，role=orchestrator）」开头；When 打开轨迹；Then 该轮首行显示「系统」标签，摘要为指令原文。

#### 场景：零回归

Given 一轮 prompt 为普通用户输入「跑一下测试」；When 派生；Then 该行仍为「用户」标签。

### FR-02: 存量历史会话立即生效

- 识别 **必须** 为纯前端启发式（不依赖新数据盖戳），存量历史会话打开轨迹即生效；**禁止** 修改后端落库行为。

#### 场景：主路径

Given 任意既有会话（含团队派发轮）不重跑任何后端逻辑；When 打开轨迹；Then 团队派发轮显示「系统」行。

### FR-03: 测试与类型零回归

- 既有轨迹/会话面板用例 **禁止** 放宽或删除；新增用例 **必须** 全绿；`frontend` 的 `tsc --noEmit` **必须** 退出 0。

#### 场景：主路径

Given 变更落盘；When 跑轨迹目录测试与 tsc；Then 全部通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「团队派发指令识别为系统行：主控 brief / Worker 派发前缀 + 普通输入保持用户行」
FR-02: 同 FR-01（纯前端派生函数对既有 SessionTurnView 输入即生效，无后端依赖）
FR-03: 不适用：类型检查无测试面，`pnpm exec tsc --noEmit` 直接验证退出码；回归面由轨迹目录全量跑覆盖
