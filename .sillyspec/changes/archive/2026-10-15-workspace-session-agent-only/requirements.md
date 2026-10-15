---
author: flow-machine-draft
created_at: 2026-10-15T07:52:06.615Z
---
# 需求规格（Requirements）— 2026-10-15-workspace-session-agent-only

## 功能需求

### FR-01: 工作区上下文（分组/scope 带 workspaceId 且当前用户对该工作区有绑定机器）触发新建：浮层不再出现「① 机器（仅在线）」步骤，直接列出绑定机器上的在线智能体（claude/codex/pi/cursor）

- **必须**：当新建会话的上下文携带 workspaceId 且当前用户对该工作区存在有效绑定（`MemberBindingView.daemon_id` 能解析出机器候选）时，`PreSessionPicker` 不渲染「① 机器（仅在线）」步骤，直接渲染该绑定机器的智能体列表（provider∈SESSION_SUPPORTED_PROVIDERS 且 online；默认 Claude 高亮语义不变）。
- **禁止**：绑定模式下渲染任何机器选择列表（含其他在线机器卡）。
- 覆盖入口：桌面门户工作区/change/quicklog scope 组头「＋」、全局门户工作区分组「＋」、悬浮宿主工作区组「＋」与工作区页「＋ 新会话」兜底浮层、移动端工作区会话页 FAB/空态入口。

#### 场景：工作区组头＋直接选智能体

Given 当前用户对工作区 W 绑定机器 M（`workspace_member_runtimes.daemon_id = M.id`），M 在线且 runtimes 含在线 claude/codex
When 用户在工作区 W 的分组上点「＋」
Then 浮层无「① 机器（仅在线）」文案与机器卡，直接显示「智能体 · M 名（工作区绑定机器）」与 claude/codex 选项；点选即 `onPick(runtimeId)` 关闭

#### 场景：移动端 FAB

Given 移动工作区会话页 `/m/workspaces/<W>/sessions`，用户对 W 有绑定机器 M
When 点 FAB「新建会话」
Then 贴底抽屉直接呈现 M 上的智能体列表（无机器步）；选完进入预会话视图

### FR-02: 绑定机器离线或不可见时：浮层给出明确空态文案（绑定机器离线/不可用，去工作区页重绑），不落回全机器列表

- **必须**：绑定模式下若绑定机器在机器候选中 `status !== "online"`，浮层显示文案「工作区绑定的机器「<名>」当前离线，请启动 daemon 后再新建会话」，不列出该机器智能体。
- **必须**：绑定模式下若绑定机器 id 不在机器候选中（如 daemon 已删/共享已撤销），浮层显示「工作区绑定的机器当前不可用，请到工作区页面重新绑定机器」。
- **禁止**：任一空态下回退展示全量机器列表（避免用户选到与工作区无关的机器）。

#### 场景：绑定机器离线

Given 工作区 W 绑定机器 M（M 在候选列表但 offline）
When 打开工作区 W 的新建浮层
Then 显示离线空态文案，无智能体选项、无机器列表

#### 场景：绑定机器不可见

Given 工作区 W 的 binding.daemon_id 指向的机器不在机器候选中
When 打开浮层
Then 显示「当前不可用…重新绑定机器」空态，不落两步机器列表

### FR-03: 工作区无可解析绑定时保持原两步流程；「非工作区」分组保持原两步流程（零回归）

- **必须**：workspaceId 为空（「非工作区」分组）或该工作区无 binding / `daemon_id` 为空时，`PreSessionPicker` 行为与改前逐字一致（① 机器（仅在线）→ ② 智能体）。
- **必须**：不传新 prop 的调用点行为零变化（默认值语义 = 原两步）。

#### 场景：无绑定回退

Given 门户 `fetchMyBindings` 返回空集
When 工作区分组「＋」→ 浮层
Then 先列在线机器（原两步）；后续步骤与既有用例断言一致

#### 场景：非工作区组

Given 全局门户「非工作区」分组（workspaceId=null）
When 点组头「＋」
Then 原两步流程（机器步不可跳过）

### FR-04: 列表两层筛选已选智能体时，工作区分组「＋」在绑定机器上命中该引擎则直带上下文进预会话（机器取绑定机器，不再取筛选机器）

- **必须**：工作区分组「＋」时若 `filter.agent` 非空且绑定机器上存在该 provider 的在线 runtime，直接进入预会话（preContext.runtimeId 取绑定机器上的该 runtime），不弹浮层。
- **必须**：机器维度一律取绑定机器；筛选中的 `machineId`（即使是另一台机器）不参与工作区上下文的 runtime 解析。
- 保留旧语义：非工作区/无绑定路径仍要求 `machineId + agent` 双备齐才直带。

#### 场景：筛选 codex + 绑定机器在线

Given 组头＋时 filter={machineId: 其他机器, agent: "codex"}，工作区 W 绑定机器 M 上 codex 在线
When 点「＋」
Then 不弹浮层，preContext.runtimeId = M 上的 codex runtime，workspaceId=W

### FR-05: ?new=1 直达（workspace/change/quicklog scope）改为解析绑定机器上的默认智能体（优先 claude、其次 codex），未命中自动弹只选智能体的浮层兜底

- **必须**：带 scope 工作区的 `?new=1` 优先按绑定机器解析默认 runtime（在线 claude → codex，无则 null），命中直接进预会话；未命中打开浮层（绑定可解析时=绑定模式/仅智能体步，否则=原两步）。
- 全局门户（无 scope）`?new=1` 保持 D-005 默认机器三级回退不变。

#### 场景：绑定机器直进

Given workspace scope + ?new=1，绑定机器 M 上 claude 在线
When 门户挂载解析完成
Then 直接预会话态（runtimeId=M 的 claude），不弹浮层

#### 场景：绑定机器无在线 claude/codex

Given 绑定机器 M 在线但仅 pi 在线（或 M 离线）
When ?new=1 解析
Then 弹浮层且为绑定模式（直接智能体步/离线空态）

### FR-06: 移动端工作区会话页（含 FAB 与空态入口）同样跳过机器选择

- **必须**：`/m/workspaces/[id]/sessions` 的 FAB 与列表空态入口打开的 `PreSessionPicker`（bottomSheet）在绑定可解析时为绑定模式；无绑定回退原两步。
- **必须**：底部抽屉 ≥44px 触摸热区、遮罩/✕ 仅 onCancel 的既有契约不变。

#### 场景：FAB（同 FR-01 移动场景，见上）

### FR-07: 相关 vitest 用例通过（pre-session-picker / sessions-portal / floating-session-host / 移动会话页），frontend typecheck 通过

- **必须**：四个测试文件相关用例全绿；`pnpm -C frontend typecheck` 通过。允许只跑改动相关测试（CLAUDE.md 规则 0：全量留给 CI）。

#### 场景：测试与类型守门

Given 本次改动落盘
When 运行 `pnpm -C frontend exec vitest run <四个测试文件>` 与 `pnpm -C frontend typecheck`
Then 全部通过、零红

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「绑定机器在线：无「① 机器」步与机器列表，直接列绑定机器智能体；点选即 onPick(runtimeId)」；「默认 Claude Code 高亮语义不变（aria-pressed + 「默认」Tag 仍唯一）」；test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「workspace 组「＋」（有绑定）→ 浮层直接智能体步（无「① 机器」）→ 选完预会话=绑定机器 runtime」；test/frontend/src/components/floating/floating-session-host.test.tsx「工作区组「＋」（有绑定 ws-1→m-1）→ 浮层绑定模式（boundMachineId 透出，不弹机器步）」
FR-02: test/frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「绑定机器离线：离线空态文案，不落机器列表也不列智能体」；「绑定机器不在候选中（已删/共享撤销）：不可用空态，不落机器列表」；test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「绑定机器离线 → 浮层离线空态（不落全机器列表，不弹机器步）」；「?new=1（workspace scope）+ 绑定机器仅 pi 在线 → 弹绑定模式浮层（直接智能体步，pi 可选）」——离线与仅 pi 同走 runtime=null→弹绑定浮层分支，合并覆盖离线/无可用引擎两态
FR-03: test/frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「boundMachineId=null：保持原两步流程（缺省不传由既有用例守护）」；「boundMachineId="" 空串按未绑定处理（防宿主空值误入绑定模式）」+ 既有两步流程/空态用例；test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「零回归：无绑定（bindings 空集）时 workspace 组「＋」仍走原两步机器步」+ 既有用例「组头＋ → 两步浮层（机器→智能体）→ onPick 合成 preContext：渲染 SessionPanel sessionId=null 预会话态，上下文行=分组+机器+智能体」「两层筛选已选（机器+智能体）点组头「＋」→ 跳过浮层直接预会话，上下文行=筛选机器+引擎」；test/frontend/src/components/floating/floating-session-host.test.tsx「零回归：工作区组「＋」无绑定（bindings 空集）→ 浮层不带 boundMachineId（原两步）」；test/frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx「零回归：无绑定（fetchMyBinding null）→ boundMachineId 为 null（原两步流程）」
FR-04: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「筛选 agent=Codex（机器筛的是另一台）+ 绑定机器该引擎在线 → 直带：runtime 取绑定机器（不取筛选机器）」；「change scope + 绑定命中 + 筛选 codex → 直带双传（change_id+workspace_id，runtime 取绑定机器）」；test/frontend/src/components/floating/floating-session-host.test.tsx「组「＋」筛选 codex + 绑定机器该引擎在线 → 直带预会话（runtime 取绑定机器，不弹浮层）」；纯函数「pickRuntimeByProvider：在线精确匹配才返回；离线/机器 null → null」
FR-05: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「?new=1（workspace scope）+ 绑定命中 → 绑定优先于 D-005（localStorage 指向另一台仍直进绑定机器）」；「?new=1（workspace scope）+ 绑定机器仅 pi 在线 → 弹绑定模式浮层（直接智能体步，pi 可选）」；test/frontend/src/components/floating/floating-session-host.test.tsx「工作区页「＋ 新会话」+ 绑定命中 → 绑定机器默认 runtime 优先于 D-005（mock 固定 m-1）」；纯函数「pickDefaultRuntimeOnMachine：在线 claude 优先→codex；pi/cursor/离线不参与；机器 null → null」
FR-06: test/frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx「FAB（有绑定 ws-1→m-1）→ 贴底抽屉绑定模式：boundMachineId 透出（不弹机器步）」；「零回归：无绑定（fetchMyBinding null）→ boundMachineId 为 null（原两步流程）」——本页浮层复用共享 Picker：绑定模式内部渲染（跳过机器步/空态/选完即 onPick）由 pre-session-picker 用例覆盖；移动页用例断言 FAB 与列表空态入口确实注入绑定机器（boundMachineId）且 bottomSheet 契约不变
FR-07: 命令级（不适用单用例）：`pnpm -C frontend exec vitest run src/components/sessions/__tests__/pre-session-picker.test.tsx src/components/sessions/__tests__/sessions-portal.test.tsx src/components/floating/floating-session-host.test.tsx "src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx"` + `pnpm -C frontend typecheck`（实测记录：提交 775d86011 时 162 用例绿；task-06 复审修复轮后四文件 164 用例绿 + typecheck 通过）
