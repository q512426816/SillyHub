---
title: profile.system_prompt 注入 + stageProfileId 持久化
change_key: 2026-08-13-profile-system-prompt-injection
status: draft
scale: large
tier: self
risk_level: unit-sufficient
created_at: 2026-08-13T14:50:00+08:00
author: WhaleFall
affected_modules:
  - backend/agent
  - backend/daemon
  - backend/change
  - daemon
  - frontend/changes
---

# Design: profile.system_prompt 注入 + stageProfileId 持久化

## 1. 背景与目标

### 1.1 问题

归档变更 `2026-08-12-dispatch-bind-agent-profile` 把「智能体档案绑定」做了一半——provider/model/凭证/allowed_roots 透传已通（D-003@v1 方案 B），但 **system_prompt 注入（GAP-2/3）和 stageProfileId 持久化明确排除留本变更**。现状：

- **system_prompt 不生效**：用户在变更详情页选了档案（如「Kimi 技术经理」），agent 跑起来后 profile.system_prompt 没进 agent。证据：run `ef9f8b55` 的 `agent_profile_id` 有值，但日志 0 条含 system_prompt 文本，无 system channel。
- **根因（两头断）**：
  - backend `_apply_profile_to_lease`（service.py:638-666）写 lease.metadata 只写 4 键（effective_allowed_roots / mcp_refs / skill_refs / profile_version），**不写 system_prompt**。
  - backend `_PROFILE_PAYLOAD_FIELDS`（context.py:297）注释明说「system_prompt 不在此列——注入走 task-06 的 claudeMd prepend（D-012@v2）」，但 **daemon 侧 claudeMd prepend 从未实现**（grep daemon src 仅 api-types.ts 有 system_prompt 类型，无消费逻辑）。
  - 结论：system_prompt 既没走 lease.metadata 透传，也没走 claudeMd prepend，彻底丢了。
- **stageProfileId 不持久化**：前端 `stageProfileId = useState(null)`（[cid]/page.tsx:80），重进页面 state 重置为 null（跟随工作区默认），用户每次都得重选。

### 1.2 目标

- **system_prompt 注入**：选了档案后，profile.system_prompt 经 daemon session create 注入到 agent（保留 claude code 默认能力 + 追加档案提示词）。
- **stageProfileId 持久化**：选了档案存到 `change.stages[stage].profile_id`（每阶段独立），重进页面恢复，切阶段各记各的。

### 1.3 非目标（明确排除）

- **skill_refs / mcp_refs interactive 路径修复**（原 GAP-4/5）：interactive session 不裁剪 skill_refs、不注入 mcp_refs 的实际生效修复。本次只做 system_prompt。
- **不改 claude code 默认 system**：用 SDK `preset:claude_code` + append，保留 claude 全部默认能力（编码/工具/use-tool），仅追加 profile 提示词。
- **不碰 provider/model/凭证/allowed_roots 透传**：已通（D-003@v1），零回归。
- **不补 daemon 的 claudeMd prepend**：D-012@v2 那条路废弃，改走 SDK systemPrompt（见 §2）。
- **batch / --print 模式的 systemPrompt**：本次只覆盖 **interactive session（stage run 走的路径，daemon.ts:3304 → SessionManager.create）**。batch task-runner（daemon.ts:3655/3766）不注入 systemPrompt（非交互式 --print 模式本次不覆盖，留待后续）。design §5.1 精确化为只改 interactive 一处。

## 2. 方案选型

### 2.1 注入方式（用户已确认：SDK systemPrompt 追加）

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **A. SDK systemPrompt preset+append** | daemon session create 传 `{type:'preset',preset:'claude_code',append:profile.system_prompt}` 给 SDK | SDK 原生支持（sdk.d.ts:1911-1918）；保留 claude 默认能力；不污染文件；通用 | 要改 daemon session create + driver 透传 | ✅ 选定 |
| B. CLAUDE.md prepend（原 D-012@v2） | daemon 把 system_prompt 写进 agent cwd 的 CLAUDE.md | claude 原生读 CLAUDE.md | 污染项目 CLAUDE.md；只 claude 认；stage run 清空 claude_md 要处理 | ✗ 废弃 |

选 A：SDK 原生 `systemPrompt` 支持 `{type:'preset', preset:'claude_code', append}` 形式（sdk.d.ts:1911-1918「Default with additions」），保留 claude code 全部默认能力 + 追加 profile 提示词，不污染文件、通用。原 D-012@v2 选 CLAUDE.md prepend 是当时未发现 SDK 此能力。

### 2.2 传输路径（用户已确认：lease.metadata 透传）

| 方案 | 描述 | 结论 |
|------|------|------|
| **A. lease.metadata 透传** | 复用 `_PROFILE_PAYLOAD_FIELDS` 现有机制，加 system_prompt 字段（和 roots/mcp/skill 同路） | ✅ 选定 |
| B. daemon RPC 拉 profile | daemon create session 时反查 backend 拉 system_prompt | ✗ 多一次 RPC + daemon 依赖 backend 可用性 + 借用场景 backend 可能不可达 |

选 A：复用现有透传机制（`_apply_profile_passthrough` 已 generic 双写），零新机制，一致性高。

### 2.3 持久化粒度（用户已确认：每阶段独立）

| 方案 | 存储 | 结论 |
|------|------|------|
| A. 变更级共享 | `change.stages.stage_profile_id`（一个变更一个档案） | ✗ |
| **B. 每阶段独立** | `change.stages.<stage>.profile_id`（brainstorm/execute 可不同档案） | ✅ 选定 |

选 B：用户要 brainstorm 和 execute 用不同档案（如 brainstorm 用需求分析专档、execute 用工程档）。存 `change.stages[<stage>]["profile_id"]`。

## 3. 核心决策

- **D-001：system_prompt 走 SDK systemPrompt preset+append，不走 claudeMd prepend。** 废弃 D-012@v2。SDK `{type:'preset',preset:'claude_code',append}` 保留默认能力 + 追加（sdk.d.ts:1911-1918）。
- **D-002：system_prompt 复用 `_PROFILE_PAYLOAD_FIELDS` 透传，和 roots/mcp/skill 同路。** backend 写 lease.metadata → claim payload 双写 → daemon 读。零新传输机制。
- **D-003：stageProfileId 每阶段独立，存 `change.stages[<stage>]["profile_id"]`。** 前端切阶段重读对应 profile_id。
- **D-004：新 PATCH 端点存 profile_id，不混进 transition。** transition 是阶段推进，profile 选择是独立操作，语义分离。PATCH `/changes/{id}/stage-profile`。
- **D-005：仅 claude code provider 注入 systemPrompt。** glm/codex 等其他 provider 的 SDK 若不支持 preset append，driverOpts.systemPrompt 不设（driver 层判断 provider，非 claude 跳过）。本次只验证 claude（ef9f8b55 provider=claude）。

## 4. 后端设计

### 4.1 `agent/service.py:_apply_profile_to_lease` — 加写 system_prompt

现有写 5 键（effective_allowed_roots / mcp_refs / skill_refs / profile_version / **llm_provider_id**——后者来自 2026-08-11-agent-profile-bind-llm-provider 变更，service.py:726），加第 6 键 `system_prompt`（从 profile.system_prompt）：

```python
# 合并 profile 键时加：
if profile.system_prompt:
    meta["system_prompt"] = profile.system_prompt
```

profile.system_prompt 可空（None）→ 不写键（和现有 mcp_refs/skill_refs 缺则不写一致，FR 行为同今天）。

### 4.2 `daemon/lease/context.py:_PROFILE_PAYLOAD_FIELDS` — 加字段

```python
_PROFILE_PAYLOAD_FIELDS = (
    ("mcp_refs", "mcpRefs"),
    ("skill_refs", "skillRefs"),
    ("effective_allowed_roots", "effectiveAllowedRoots"),
    ("profile_version", "profileVersion"),
    ("system_prompt", "systemPrompt"),  # 新增（D-002）
)
```

`_apply_profile_passthrough` 已 generic（逐键 `in` 守护 + 双写 camelCase/snake_case），加字段即自动透传 claim payload。删掉 line 299 那条「system_prompt 不在此列」的过时注释。

### 4.3 `change/router.py` — 新 PATCH 端点存 stage profile_id

```python
@router.patch("/changes/{change_id}/stage-profile")
async def update_stage_profile(
    workspace_id, change_id, data: StageProfileUpdate, session, user
) -> dict:
    """存 change.stages[<current_stage>]["profile_id"]（每阶段独立，D-003）。"""
    change = await _get_change(...)
    stage = change.current_stage
    stages = dict(change.stages or {})
    stage_data = dict(stages.get(stage) or {})
    stage_data["profile_id"] = data.profile_id  # None = 清除（跟随默认）
    stages[stage] = stage_data
    change.stages = stages
    session.add(change); await session.commit()
    return {"stage": stage, "profile_id": data.profile_id}
```

schema：`StageProfileUpdate { profile_id: str | None }`。

## 5. daemon 设计

### 5.1 claim payload → CreateSessionInput 映射（daemon.ts interactive 路径）

daemon.ts 有 3 处从 execPayload/payload 读 profile 字段（line 3304 / 3655-3666 / 3766）。**Design Grill 核查（独立 QA 实证）**：仅 **3304** 是 interactive `SessionManager.create` 路径（消费 driverOpts.systemPrompt）；3655/3766 是 **batch task-runner**（非交互式 --print 模式，不消费 driverOpts.systemPrompt）。本次只覆盖 interactive（见 §1.3 非目标），**只在 3304 加**：

```typescript
// daemon.ts:3304 附近（interactive SessionManager.create 路径）
systemPrompt: execPayload.systemPrompt,   // 新增（D-002 透传来的）
```

（与现有 `mcpRefs: execPayload.mcpRefs` / `effectiveAllowedRoots: execPayload.effectiveAllowedRoots` 并列，仅此 1 处。3655/3766 batch 路径本次不动。）

### 5.2 `CreateSessionInput` 加字段

session-manager.ts `CreateSessionInput`（line 270-285 附近）加：

```typescript
systemPrompt?: string;   // profile.system_prompt（D-001，claude code preset+append）
```

### 5.3 `_buildDriverOptions` 设 systemPrompt（session-manager.ts:1098+）

```typescript
if (spec.systemPrompt !== undefined) {
  driverOpts.systemPrompt = {
    type: "preset",
    preset: "claude_code",
    append: spec.systemPrompt,
  };
}
```

（与现有 `if (spec.mcpServers !== undefined)` 分支并列。）

### 5.4 create() 透传 systemPrompt 到 spec

create()（line 881+）读 input.systemPrompt 写 state + 传 `_buildDriverOptions` spec（和 mcpRefs/effectiveAllowedRoots 同处，line 930-933/964）。加 `systemPrompt: input.systemPrompt`。

### 5.5 claude-sdk-driver 透传到 SDK

`claude-sdk-driver.ts` 逐字段挑写进 SDK options（line 322-388，非 spread——Design Grill P1 实证）。加：

```typescript
// claude-sdk-driver.ts options 构造处（与 allowedTools/model/mcpServers 同模式）
if (opts.systemPrompt !== undefined) {
  options.systemPrompt = opts.systemPrompt;  // SDK StartOptions.systemPrompt（sdk.d.ts:1929）
}
```

非 claude driver（codex 等）的 StartOptions 类型无 systemPrompt 字段，TS 编译期不让赋（D-005 天然隔离）。

### 5.6 resume / restore 路径重注入 systemPrompt（Design Grill 补）

**关键缺口（独立 QA 发现）**：daemon 重启 / session 重连走 `restoreAndReconnect`（session-manager.ts:2400+），原设计只覆盖 create。systemPrompt 必须在 resume 路径也注入，否则重连后 system_prompt 丢失。

- **PersistedSessionRecord 加字段**：session 持久化记录（restore 读的）加 `systemPrompt?: string`，create 时落盘（和 mcpRefs/skillRefs/effectiveAllowedRoots 同处持久化，session-manager.ts:2422-2426 附近）。
- **restoreAndReconnect 重注入**：从 PersistedSessionRecord.systemPrompt 读 → 填 state → `_buildDriverOptions` spec（line 2466-2474 附近）加 `systemPrompt`，和 create 路径走同一 `_buildDriverOptions`（自动注入 preset+append）。

```typescript
// restoreAndReconnect state 恢复处（与 mcpRefs/effectiveAllowedRoots 并列）
...(record.systemPrompt !== undefined ? { systemPrompt: record.systemPrompt } : {}),
// _buildDriverOptions spec 构造处
systemPrompt: state.systemPrompt,
```

## 6. 前端设计

### 6.1 stageProfileId 恢复（useEffect，非 useState initializer）

**Design Grill 修正**：change 是 useEffect 异步加载（page.tsx:66 初始 null，line 91+ 加载），useState initializer 在 mount 时跑（change=null）永远求值 null。必须用 useEffect：

```typescript
const [stageProfileId, setStageProfileId] = useState<string | null>(null);

// change 加载后 + current_stage 变化时，从 DB 真值恢复（每阶段独立 D-003）
useEffect(() => {
  if (!change?.current_stage) return;
  const stageData = (change.stages?.[change.current_stage] ?? {}) as { profile_id?: string };
  setStageProfileId(stageData.profile_id ?? null);
}, [change?.current_stage, change?.stages]);
```

（useEffect 依赖 current_stage + stages，change 加载后 / 切阶段时自动从 DB 真值恢复，每阶段独立 D-003。）

### 6.2 onStageProfileChange 调 API 存（[cid]/page.tsx:444）

```typescript
const handleStageProfileChange = async (profileId: string | null) => {
  setStageProfileId(profileId);  // 乐观更新
  await updateStageProfile(workspaceId, changeId, profileId);  // 新 lib/changes API
};
// props: onStageProfileChange={handleStageProfileChange}
```

`lib/changes.ts` 加 `updateStageProfile(wsId, cid, profileId)` → PATCH `/changes/{id}/stage-profile`。

## 7. 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|------|--------|--------|----------|----------|
| profile 选择 | 前端 | backend PATCH /stage-profile | change_id, profile_id | change.stages[stage].profile_id 写入 |
| stage dispatch | backend | daemon（lease） | lease.metadata.system_prompt | lease 含 system_prompt 键 |
| claim | daemon | backend（claim API） | — | claim payload 含 systemPrompt（双写） |
| session create | daemon SessionManager | claude SDK | driverOpts.systemPrompt | session 启动带 preset+append system |
| session resume/重连 | daemon restoreAndReconnect | claude SDK | PersistedSessionRecord.systemPrompt → driverOpts.systemPrompt | 重连后 system_prompt 保持（§5.6） |
| run 完成 | daemon | backend sync | — | （无变化，system_prompt 不影响 run 状态机） |

注：system_prompt 注入是 session 启动参数，不改变 run/lease 的生命周期状态（pending→running→completed 不变），仅影响 agent 的 system message 内容。

## 8. 文件变更清单

### 后端（Python）
- `backend/app/modules/agent/service.py` — `_apply_profile_to_lease` 加写 system_prompt
- `backend/app/modules/daemon/lease/context.py` — `_PROFILE_PAYLOAD_FIELDS` 加字段 + 删过时注释
- `backend/app/modules/change/router.py` — 新 PATCH `/changes/{id}/stage-profile`
- `backend/app/modules/change/schema.py` — `StageProfileUpdate` DTO
- `backend/app/modules/agent/tests/test_dispatch_profile.py` — 加 system_prompt 透传断言（测 _apply_profile_to_lease）+ test_dispatch_metadata.py 测 claim payload 透传

### daemon（TypeScript）
- `sillyhub-daemon/src/daemon.ts` — **仅 1 处**（interactive SessionManager.create，line 3304；3655/3766 batch 不动，Design Grill 实证）
- `sillyhub-daemon/src/interactive/session-manager.ts` — CreateSessionInput 加字段 + _buildDriverOptions 设 preset+append + create 透传 + **restoreAndReconnect 重注入 + PersistedSessionRecord 持久化**（§5.6）
- `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` — 逐字段透传 systemPrompt 到 SDK options（driver 是逐字段挑写非 spread，Design Grill P1 确认）

### 前端（TypeScript）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` — stageProfileId 初始化恢复 + onChange 调 API
- `frontend/src/lib/changes.ts` — `updateStageProfile` API
- `frontend/src/lib/api-types.ts` — gen:types 生成（PATCH 端点）

共 11 文件（5 后端 + 3 daemon + 3 前端）。无 DB 迁移（stages 是 JSON 列）。

## 9. 风险登记

| 风险 | 缓解 |
|------|------|
| daemon.ts 3 处 execPayload→input 漏改一处 | grep `execPayload.mcpRefs` 定位全部 3 处，逐处加 systemPrompt；测试覆盖 |
| 非 claude provider（glm/codex）SDK 不支持 preset append | driverOpts.systemPrompt 仅 claude driver 透传；非 claude 不设（D-005）。本次只验证 claude |
| SDK systemPrompt append 语义不符预期（如覆盖而非追加） | sdk.d.ts:1911-1918 明确 preset+append = 「Default with additions」；实测 agent 输出验证 |
| stageProfileId 持久化与切阶段 race | 切阶段时 useEffect 重读 change.stages[new_stage].profile_id，以 DB 为准 |
| system_prompt 长（几百字）撑大 lease.metadata JSON | 可接受（skill_refs/mcp_refs 也在 metadata）；无硬上限；profile_version 已在 |
| **resume/重连 systemPrompt 丢失**（Design Grill 发现） | §5.6 补 PersistedSessionRecord 持久化 + restoreAndReconnect 重注入；create/resume 同走 _buildDriverOptions |
| **前端 useState initializer 跑不通**（change 异步加载，Design Grill 发现） | §6.1 改 useEffect 依赖 current_stage/stages，change 加载后从 DB 真值恢复 |
| **batch 路径（--print）systemPrompt 未覆盖** | §1.3 明确非目标（本次只 interactive/stage run）；batch task-runner 后续覆盖 |

## 10. 自审（Self-Review）

- ✅ 对齐 SDK 能力：systemPrompt preset+append（sdk.d.ts:1911-1918 实证），保留 claude 默认能力
- ✅ 复用现有机制：_PROFILE_PAYLOAD_FIELDS 透传（零新传输，和 roots/mcp/skill 同路）
- ✅ 向后兼容：profile.system_prompt 为空 → 不写键 → 行为同今天；主线 run 不受影响
- ✅ 无 DB 迁移：change.stages 是 JSON 列，加 profile_id 子键无 schema 改动
- ✅ 每阶段独立：change.stages[stage].profile_id，切阶段各记各的（D-003）
- ✅ 非目标清晰：skill/mcp interactive 路径排除（§1.3）
- ⚠️ 待 plan 确认：daemon.ts 3 处 execPayload→input 的精确行号（3304/3658/3766 附近，plan 阶段 grep 定位）
- ⚠️ 待验证：glm/codex driver 是否需要 systemPrompt（本次只 claude，D-005）

## 11. 验收标准

- [ ] 选档案「Kimi 技术经理」触发 quick → agent 日志含 system_prompt 文本（「Kimi 驱动的高级AI知识经理」）
- [ ] 选档案后重进页面 → 档案选择器恢复选中（不回默认）
- [ ] brainstorm 选档案 A → 推进到 execute → execute 档案独立选 B（每阶段独立）
- [ ] 不选档案（跟随默认）→ run 无 system_prompt 注入（行为同今天，零回归）
- [ ] 后端单测：_apply_profile_to_lease 写 system_prompt / _PROFILE_PAYLOAD_FIELDS 透传
- [ ] daemon：claim payload 含 systemPrompt / driverOpts.systemPrompt preset+append
- [ ] 非 claude provider 不崩（driverOpts.systemPrompt 不设）
