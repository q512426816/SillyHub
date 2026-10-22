---
author: flow-machine-draft
created_at: 2026-10-22T02:35:37.287Z
---
# 需求规格（Requirements）— 2026-10-22-agent-profile-edit-refresh

## 功能需求

### FR-01: useCreateAgentProfile/useUpdateAgentProfile 成功后必须同时 invalidate workspaceList(wid) 与 mineList 两桶（全局页编辑/新建保存后卡片墙立即刷新）

- 新建/更新 mutation 成功后必须同时失效 `agentProfileQueryKeys.workspaceList(workspaceId)` 与 `agentProfileQueryKeys.mineList` 两个缓存桶——mineList 是全局卡片墙聚合全集，任何档案增改必然影响它；mutation 失败时禁止失效。

#### 场景：全局页编辑保存

- Given：用户在 /agent-profiles（mineList 桶）打开编辑弹窗并修改保存
- When：mutation 成功返回
- Then：mineList 桶被失效，卡片墙立即重拉显示新值（无需手动刷新）

#### 场景：全局页新建保存

- Given：用户在 /agent-profiles 新建档案保存成功
- When：mutation 成功返回
- Then：新档案出现在卡片墙

### FR-02: 工作区内页（workspaceList 桶）刷新行为不回归

- 工作区内页（/workspaces/[id]/agent-profiles，数据在 workspaceList(wid) 桶）在新建/编辑保存后必须照旧立即刷新；useDelete/useCopy hook 行为本变更不动（其消费页列表桶已正确失效，全局页复制/删除由页面层手动失效 mineList 覆盖——page.tsx 头注释明载的既有约定）。

#### 场景：工作区内页编辑

- Given：工作区内页打开编辑保存成功
- When：mutation 成功
- Then：workspaceList(wid) 桶照旧失效刷新

### FR-03: lib 层新增 hook 失效行为单测（断言两桶 key 均被失效）

- 必须新增 lib 层单测（vitest + renderHook + 真 QueryClient），断言 create/update mutation 成功后 invalidateQueries 覆盖 workspaceList(wid) 与 mineList 两键；mutation 失败路径 SHOULD 不触发失效。

#### 场景：单测覆盖

- Given：mock apiFetch 成功/失败两种返回
- When：mutateAsync 执行
- Then：成功断言两桶 key 均在 invalidate 调用里；失败断言零调用

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/lib/__tests__/agent-profiles.test.tsx「create/update 成功后失效 workspaceList 与 mineList 两桶」
FR-02: test/frontend/src/lib/__tests__/agent-profiles.test.tsx「既有 workspaceList 失效不回归（同一用例内并断言）」
FR-03: test/frontend/src/lib/__tests__/agent-profiles.test.tsx「mutation 失败不触发失效」
