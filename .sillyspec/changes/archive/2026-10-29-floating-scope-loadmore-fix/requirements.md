---
author: flow-machine-draft
created_at: 2026-10-28T23:13:04.592Z
---
# 需求规格（Requirements）— 2026-10-29-floating-scope-loadmore-fix

## 功能需求

### FR-01: 清理 effect 的 scope 依赖改为口径稳定键（kind+标识字段标量），同值新引用 scope 重渲染不再清附加段/复位游标（组件级用例固化：rerender 传同值新对象 scope 后已加载条目不回跳）

- 附加段清理 effect 的 scope 依赖**必须**为口径稳定键（`kind` 与全部标识字段拼出的标量串），**禁止**以 scope 对象引用本身作为依赖——调用方（floating-session-host lockedRuntime 分支）内联对象每次渲染产生新引用，Object.is 比较会误判「口径变化」。同值新引用 scope 重渲染后：已加载条目数**必须**保持（附加段不清）、续拉游标**必须**延续（下次续拉 offset 从已请求累计继续，不从首屏长度重拉）、**禁止**因此触发多余 listAgentSessions 请求（queryKey 结构化哈希同值不重拉）。

#### 场景：同值新引用重渲染

- Given：workspace scope 首屏 2 条、total 8，已点「加载更多会话」续拉 3 条（去重后已加载 5、游标=5）
- When：rerender 传入**内容相同、引用不同**的 scope 对象（模拟 floating-host 宿主重渲染）
- Then：已加载条目仍为 5（不回跳）、再点「加载更多会话」续拉请求 offset=5（游标未复位）、rerender 未产生新请求

### FR-02: scope 口径真实变化（kind 或标识 id 变化）时附加段仍正确清空（既有口径语义零回归，用例固化）

- scope 口径真实变化（kind 变化或任一标识字段——workspaceId/changeId/runtimeId/qlId——变化）时，附加段**必须**清空、续拉游标**必须**复位为 null（下次续拉从新口径首屏长度起 offset）。稳定键**必须**覆盖判别联合全部四个分支的全部标识字段，**禁止**仅按 kind 区分（同 kind 不同 id 的切换不清即是漏清）。

#### 场景：同 kind 换 id

- Given：workspace ws-1 scope 已加载 5 条（含附加段 3 条）、游标=5
- When：rerender 换 scope 为 workspace ws-2（同 kind 不同 workspaceId），服务端返回 ws-2 首屏 1 条、total 3
- Then：列表只显 ws-2 的 1 条（ws-1 首屏与附加段全清）、再点「加载更多会话」续拉请求 offset=1（= ws-2 首屏长度，游标已复位而非沿用 5）

### FR-03: 会话列表现有测试套件全绿，tsc/eslint 0 error

- 本变更**必须**保持 session-list-panel 既有测试套件全部通过（含 2026-10-28-session-list-loadmore-fetch 系列用例），tsc 与 eslint 对改动文件 0 error。改动面**禁止**超出 session-list-panel.tsx 与其测试文件（floating-session-host 侧零改动——根修在消费组件，对所有调用方免疫）。

#### 场景：主路径

- Given：本分支改动落盘
- When：运行 session-list-panel 测试套件 + tsc + eslint
- Then：全绿 / 0 error

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「FR-01：scope 同值新引用重渲染不清附加段不复游标」
FR-02: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「FR-02：scope 口径真实变化（同 kind 换 id）清附加段+游标复位」+「sessionScopeStableKey 四分支键唯一性（纯函数）」
FR-03: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「套件全量 + tsc/eslint 0 error（收口实测）」
