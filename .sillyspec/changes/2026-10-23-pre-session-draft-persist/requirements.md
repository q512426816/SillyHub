# 需求说明（Requirements）— 2026-10-23-pre-session-draft-persist

## 背景与动机

前序变更 `2026-10-23-session-input-clear-fix` / `2026-10-23-session-dialog-input-align` 把预会话（page「＋新建会话」/ dialog idle）定为「挂载恒空白、清残留键」——当时的取舍是「新建=全新开始」优先。用户实测后显式反转该取舍（原话）：「新建会话时候，我输入了AAA 但是我这时候切到别的会话 或者是 刷新页面 这个AAA 会丢失，这个应该要保留（我重新 新建会话要显示），如果我新建会话 时候 本来输入了 AAA 但是我觉得不对 我清空了， 这时候我切换会话或者刷新页面 再次新建会话时候要为空的」。

即：预会话未发送草稿要跨刷新 / 跨切换保留，且**清空也要如实保留**（清空后离开 → 回来是空，不是旧 AAA）。本变更取代前两变更的「恒空白」语义；发送受理即清、真会话草稿、入口隔离三条语义不动。

## 功能需求

### FR-01: 预会话未发送草稿跨刷新 / 跨切换保留（page 与 dialog 两模式）

- 预会话（page「＋新建会话」预会话态 / dialog idle 态）挂载时**必须**回读入口隔离键 `__pre__:<scope>` 的草稿到输入框。
- **场景 1（切换）**：Given 新建会话输入 AAA 未发送，When 切到其他会话后再点新建会话（dialog 关闭重开），Then 输入框原样显示 AAA。
- **场景 2（刷新）**：Given 新建会话输入 AAA 未发送，When 刷新页面后再次新建会话，Then 输入框原样显示 AAA（草稿已落 localStorage，读回即得）。
- 回读源**必须**是预会话入口键（`__pre__:<workspaceId|'-'>:<runtimeId>` / dialog `__pre__:<workspaceId|'-'>`），**禁止**读任何真会话键——前序报障「其他会话填 AAA 新建会话显示 AAA」不得复潮。

### FR-02: 清空语义如实保留

- **场景**：Given 新建会话输入 AAA 后手动清空（输入框为空），When 切换会话或刷新页面后再次新建会话，Then 输入框为空（**不得**回显旧 AAA）。
- 即草稿键**必须**随每次输入变化（含清空为空串）实时落盘，清空动作本身要被持久化。

### FR-03: 三条既有语义零回归（回归锁定）

本变更**不得**改动以下三条既有语义，回归用例**必须**全绿：

- 真会话草稿恢复（切走再切回 / 刷新恢复）语义不变。
- 发送受理即清不变：预会话发送受理后草稿键同步清空，再次新建会话输入框为空；发送失败恢复原文不变。
- 入口隔离不变：不同 workspace / runtime 维度的预会话草稿互不可见；真会话草稿不渗入预会话键；预会话 scope 不渗入真会话键。

## 成功标准承接（原文逐字，来源 flow start --input）

- 新建会话（预会话/idle）输入 AAA 未发送，切到其他会话再点新建会话，输入框原样显示 AAA → FR-01 场景 1
- 新建会话输入 AAA 未发送，刷新页面后再次新建会话，输入框原样显示 AAA → FR-01 场景 2
- 新建会话输入 AAA 后手动清空，切换会话或刷新页面后再次新建会话，输入框为空（不是旧 AAA）→ FR-02
- 真会话草稿恢复、发送受理即清（发送后新建会话为空）、不同入口（工作区/运行时维度）草稿隔离，三条既有语义零回归 → FR-03
- tsc --noEmit 零错；session-panel 草稿域相关测试全绿（更新被反转的恒空白用例 + 新增保留用例）→ 测试绑定各行 + 任务注册表 task-05

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「page 预会话：同一入口重进恢复未发送草稿（切走再回/刷新同路径）」; frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「dialog idle：同 workspaceId 重开恢复未发送草稿」
FR-02: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「page 预会话：清空后重进保持为空（不回显旧稿）」; frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「dialog idle：清空后重开保持为空」
FR-03: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「预会话发送受理即清后再次新建为空（既有语义零回归）」; frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「真会话草稿/入口隔离既有用例（套件全绿回归）」
