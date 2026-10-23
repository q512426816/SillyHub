---
author: flow-machine-draft
created_at: 2026-10-22T23:55:20.073Z
---
# 需求规格（Requirements）— 2026-10-23-review-risk-fixes-2

## 功能需求

### FR-01: 同根新 workspaceId 的采集不再被旧探针的淘汰条目静默跳过（竞态测试钉住），skip 命中有一次性 warn 日志

- 探汰 skip 表必须按「rootPath → 被淘汰 workspaceId」双键判定——只有采集目标与被淘汰时相同的 workspaceId 才 skip；禁止按裸 rootPath 封禁同根的其他工作区（含重 claim 后的新 wsId）。skip 命中必须落一次性 warn 日志（`sillyspec_status_skip_evicted`，每根至多一条，同名重 claim 清除标记后可再记）。

#### 场景：主路径

- Given ws-1 对根 R 连败 3 次淘汰（skip 表记 R→ws-1） / When ws-2 采集同根 R / Then 照常发起 CLI（不被 skip），skip 表条目不影响 ws-2。
- Given ws-1 淘汰后再采集（仍是 ws-1）/ Then skip 生效零 CLI，且 warn 日志恰一条（后续拍不重复刷屏）。

### FR-02: 跑马灯追平目标后 rAF 停排，新内容到达或重新可见时恢复动画

- 滚动循环在追平目标（distance ≤ 0.5）的那一帧之后必须停排 requestAnimationFrame（禁止无条件续排空转）；目标更新（entries 变化/视口 resize）或恢复可见时必须能重新起排继续动画；不可见暂停、reduced-motion、卸载清理语义保持既有行为。

#### 场景：主路径

- Given 可见且已追平（jsdom 下 target=offset=0）/ When 手动驱动已排帧执行 / Then 不再排新帧（rAF 调用计数不再增长）。
- Given 已停排 / When entries 更新（rerender 新数组）/ Then 重新起排（rAF 调用计数增长）。

### FR-03: diff 阶段非 timeout git 错误落结构化 warn 日志（stage+错误归类），不再无痕消失

- diff 两阶段（name-status/numstat）catch 到非 timeout 的 git 错误时，必须经 `onGitDiagnostic` 回调发出 `{stage, reason, message}` 结构化诊断（生产由 session-manager 落 `console.warn`）；禁止静默吞掉（现行无日志无 reason 行为）。快照 reason 枚举保持冻结（禁新增值）。

#### 场景：主路径

- Given 注入的执行器对 `--name-status` 抛非 timeout 错误（fatal: bad object）/ When collectTurnFileChanges 执行 / Then onGitDiagnostic 收到 `{stage: 'name-status', reason: null, message: 'fatal: bad object'}`，快照照常产出（降级语义与旧一致）。

### FR-04: requestBatch 响应处理异常时该批回退原文并入退避，Promise 不再悬挂

- `requestBatch` 的响应处理段（engine_ready 判定/items 解构/回填）必须处于失败降级域内：2xx 脏响应体（null / items 缺失）抛出的异常必须使该批回退原文（`failEntries`）并入 60s 退避；禁止异常逃逸导致 Assembler 永不 settle 与 inflight 泄漏。

#### 场景：主路径

- Given apiFetch 返回 2xx 但响应体解析为 null / When translateText 调用 / Then 该文本 resolve 为 null（不悬挂），退避期内后续调用零请求。
- Given apiFetch 返回 engine_ready=true 但缺 items / When translateText 调用 / Then 同款降级 resolve null。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/sillyspec-manager.test.ts「同根新 workspaceId 不被陈旧淘汰条目静默跳过 + skip 命中一次性 warn（2026-10-23-review-risk-fixes-2）」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「追平目标后 rAF 停排，entries 更新重新起排（2026-10-23-review-risk-fixes-2）」
FR-03: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「name-status 非 timeout git 错误经 onGitDiagnostic 落结构化诊断（2026-10-23-review-risk-fixes-2）」
FR-04: frontend/src/lib/__tests__/thinking-translate.test.ts「2xx 脏响应体（null/缺 items）→ 本批回退原文+退避，Promise 不悬挂（FR-04）」
