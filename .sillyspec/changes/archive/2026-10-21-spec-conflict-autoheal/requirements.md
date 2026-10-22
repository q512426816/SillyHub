---
author: flow-machine-draft
created_at: 2026-10-21T04:36:02.760Z
---
# 需求规格（Requirements）— 2026-10-21-spec-conflict-autoheal

## 功能需求

### FR-01: 同一工作区连续 2 次推送冲突（rebase 重试仍败）时 daemon 自动备份并删本地 manifest、立即走全量 tar 重推（本地为准），全程零人工

- `postSpecSync` 必须按工作区记录连续 `SpecPushConflict` 次数（推送成功必须清零）：连续冲突达 2 次时必须自动（可以不经任何人工命令）①把该工作区 manifest 缓存备份到 `~/.sillyhub/daemon/manifests-backup/{wsId}-{时间戳}.json`（best-effort，失败不阻断）②删除 manifest 缓存 ③立即重入推送——无缓存走全量 tar（无乐观锁，本地为准覆盖服务端）并返回其结果；触发时必须输出含 `conflict_autoheal_local_wins` 的 warn 日志。
- env `SILLYHUB_DAEMON_CONFLICT_AUTOHEAL` 值 '0'/'false'（大小写不敏感）必须禁用自愈（冲突照旧上抛）；缺席/其他值必须保持默认开启。
- 单次冲突（计数 1）禁止触发自愈（照旧上抛）；自愈重入产生的推送若再失败，禁止二次递归自愈（计数已清零，按既有传输失败语义落 pending_push 后上抛）。

#### 场景：连续两次冲突触发自愈

Given manifest 缓存在位且 mock 客户端增量推送恒 conflict、全量 tar 推送成功，When 连续调两次 postSpecSync，Then 第一次照旧抛 SpecPushConflict（无 tar 调用），第二次返回全量推送结果 ok、manifest 缓存已被重建、备份文件出现在 manifests-backup/。

#### 场景：单次冲突不触发

Given 首次冲突，When postSpecSync，Then 必须抛 SpecPushConflict 且 manifests-backup/ 无新文件。

#### 场景：env 禁用

Given SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0，When 连续多次冲突，Then 始终照旧上抛、不删 manifest、无备份。

#### 场景：成功清零

Given 冲突 1 次后推送成功，When 再次冲突，Then 计数从 1 重计（不立即自愈）。

### FR-02: event-loop 循环 abort 退出不再被 _fire 误记 loop_crashed

- `runEventLoopWatch` 必须在 sleep 因 abort（无论 reason 形态：AbortError/通用 Error/自定义）被 reject 时于循环内捕获并优雅退出（正常返回、finally disable 直方图），禁止向调用方抛出；daemon stop 路径不得因此产生 `loop_crashed` 日志。

#### 场景：优雅退出

Given 注入的 sleep 在第 N 拍 abort reject（reason 为非 AbortError 的 Error），When await runEventLoopWatch，Then 正常 resolve（不 reject）、直方图 disable 恰一次。

### FR-03: off 开关命中日志标明来源（env 或 flag）

- `isDaemonSpecSyncOff` 返回类型必须细化为 `Promise<'env'|'flag'|null>`（env 优先于 flag；null=未关）；`postSpecSync` 跳过推送的 warn 日志必须携带命中来源字样（`来源=env` / `来源=flag`），恢复方法照旧。

#### 场景：env 命中标来源

Given 仅 env 开启，When postSpecSync 被跳过，Then isDaemonSpecSyncOff 返回 'env' 且 warn 日志含「来源=env」。

#### 场景：flag 命中标来源

Given 仅 flag 文件在位，When postSpecSync 被跳过，Then 返回 'flag' 且 warn 日志含「来源=flag」。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/spec-sync-conflict-autoheal.test.ts「连续两次冲突自愈全量重推」「单次冲突不触发」「env 0 禁用自愈」「成功清零重计」
FR-02: sillyhub-daemon/tests/event-loop-watch.test.ts「abort 退出优雅 resolve 不 reject」
FR-03: sillyhub-daemon/tests/spec-sync-off-switch.test.ts「返回值细化 env/flag/null」「跳过日志含来源字样」
