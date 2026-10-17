---
author: flow-machine-draft
created_at: 2026-10-17T13:14:59.532Z
---
# 需求规格（Requirements）— 2026-10-17-session-envelope-rev-stale-guard

## 功能需求

### FR-01: SessionState 新增单调 rev 计数器：setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自动加一而是采纳远端 rev

- setTokens/setUser/clear **必须**各令本地 rev 加一；storage 回放**禁止**自行加一，**必须**采纳远端 rev（随内容或单独同步）。

#### 场景：主路径

- Given 本地 rev N，When setTokens 调用，Then rev=N+1 且 token 更新；clear 同理；markHydrated 不变 rev。
- 回放采纳：远端信封 rev=R 被采纳后本页 rev 必为 R（非 N+1）。

### FR-02: 回放守卫：远端信封 rev 严格小于本地 rev 时整体忽略（陈旧）；等于时走既有内容比对（同值静默）；大于时采纳内容并同步 rev；内容全等但 rev 更新时仅同步 rev

- 远端信封带 rev 时：rev 严格小于本地**必须**整体忽略（不 setState 不写盘）；rev 等于本地**必须**走内容比对（同值静默、异值采纳）；rev 大于本地**必须**采纳内容差异并同步 rev；内容全等而 rev 更新时**必须**仅同步 rev。

#### 场景：主路径

- 陈旧忽略：本地 rev 3，远端 rev 2 内容不同 → 状态零迁移、Storage.setItem 零调用。
- 新 rev 采纳：远端 rev 7 → token 同步且本页 rev=7。
- 同内容新 rev：内容引用不动、仅 rev 变 9。
- 等 rev 同内容：静默（乒乓切断语义在 rev 层成立）。

### FR-03: 向后兼容：无 rev 字段的旧形状信封走既有内容比对路径，既有 6+3 用例语义不变

- 无 rev 字段的旧形状信封**必须**走既有内容比对路径（不适用 rev 守卫、不改动本地 rev），既有 pingpong 修复与多标签同步用例语义**必须**保持不变。

#### 场景：主路径

- 旧信封新 token → 内容采纳、本地 rev 不动（session.test.ts「无 rev 旧形状信封」用例）。
- 既有「同值回放静默」「其它标签页续票写入」等 9 用例全部原语义通过。

### FR-04: 新增单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等值同内容静默、变更加一

- 本变更**必须**携带单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等 rev 同内容静默、等 rev 异内容采纳、旧形状兼容、变更加一（setTokens/clear +1、markHydrated 不加）。

#### 场景：主路径

- frontend/src/stores/session.test.ts 新增 describe「session 信封 rev 防乱序（陈旧忽略/采纳）」7 用例全部通过。

### FR-05: 既有 token-refresh/session 测试不回归

- 既有 session（9 用例）与 token-refresh（14 用例）测试**必须**全部保持通过，**禁止**为通过而修改既有断言语义；`tsc --noEmit` **必须**零错误。

#### 场景：主路径

- 2026-10-17 本机实测：session.test.ts 16/16 + token-refresh.test.ts 14/14 通过；tsc 退出码 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
