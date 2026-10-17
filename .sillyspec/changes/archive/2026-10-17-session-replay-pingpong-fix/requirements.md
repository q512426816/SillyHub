---
author: flow-machine-draft
created_at: 2026-10-17T12:52:24.206Z
---
# 需求规格（Requirements）— 2026-10-17-session-replay-pingpong-fix

## 功能需求

### FR-01: storage 回放改为只回放与本地当前状态实际不同的字段，回放值与本地完全一致时不调用 setState（不产生 localStorage 写盘），切断乒乓环路

- storage 回放事件到达时，系统**必须**只将与本地当前状态实际不同的字段写入本页 store；回放内容与本地完全一致（含 user 内容等价但对象引用/键序不同）时**禁止**调用 setState，即**禁止**产生 localStorage 写盘。

#### 场景：主路径

- 同值回放静默：Given 本页持有 (tok-a, rf-a, user甲)，When 对方标签写入内容完全相同的持久化信封（user 经 JSON 往返为新引用），Then 本页状态零迁移、Storage.setItem 零调用。
- 键序差异视为同值：Given 本页 user甲（键序 id,email,displayName），When 远端信封 user 内容等价但键序打乱，Then 静默跳过。

### FR-02: 真实跨标签同步语义保留：对方标签的 accessToken/refreshToken/user 真实变化仍正确回放到本页

- 对方标签的 accessToken / refreshToken / user 任一**真实**变化**必须**被回放到本页内存；仅部分字段变化时**必须**只回放变化字段，未变化字段保持本页原对象引用。

#### 场景：主路径

- token 变化回放：Given 本页 (tok-a, rf-a, user甲)，When 远端写入 (tok-b, rf-b, user甲)，Then 本页 token 对同步为 (tok-b, rf-b)。
- 部分差异只动差异字段：When 远端仅 accessToken 变为 tok-b（user 内容不变），Then 本页 accessToken 更新且 user 引用保持原对象。
- 登出/换账号同步：远端字段置 null 或换 user 时本页同步（既有用例语义不变）。

### FR-03: 新增单测覆盖：同值回放跳过、异值回放生效、部分字段差异只回放差异字段

- 本变更**必须**携带单测覆盖三类回放路径：同值回放静默（断言不写盘）、token 变化回放生效、部分字段差异只回放差异字段；user 键序差异**必须**被断言为同值。

#### 场景：主路径

- frontend/src/stores/session.test.ts 新增「session storage 同值回放静默（乒乓环路切断）」describe 共 3 用例，全部通过。

### FR-04: 既有 token-refresh 等相关测试不回归

- 既有相关单测（session 既有用例、token-refresh 全量）**必须**保持全部通过，**禁止**为通过而修改既有断言语义。

#### 场景：主路径

- 2026-10-17 本机实测：session.test.ts 9/9 + token-refresh.test.ts 14/14 通过；`pnpm -C frontend exec tsc --noEmit` 退出码 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/stores/session.test.ts「同值回放（user 经 JSON 往返产生新引用）静默跳过：不改状态、不写 localStorage」+「user 内容相同但键序不同（跨端序列化顺序差异）同样静默跳过」
FR-02: frontend/src/stores/session.test.ts「仅 token 变化时只回放 token（本页 user 对象引用保持不动）」+ 既有「其它标签页续票写入新 token 对 → 本页内存同步（不再持旧 refresh 去续票）」等 6 用例
FR-03: frontend/src/stores/session.test.ts describe「session storage 同值回放静默（乒乓环路切断）」全部 3 用例
FR-04: frontend/src/lib/__tests__/token-refresh.test.ts 全量 14 用例 + session.test.ts 既有 6 用例（2026-10-17 实测 23/23 通过，未改任何既有断言）
