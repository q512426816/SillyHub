---
author: flow-machine-draft
created_at: 2026-10-09T20:40:00.000Z
---
# 需求规格（Requirements）— 2026-10-09-status-root-write-race

## 功能需求

### FR-01: 落盘串行链——最后一次 note 的值必最后落盘

- `_noteSillySpecStatusRoot` 触发的单槽位（sillyspec-status-root.json）与映射槽位（sillyspec-status-roots.json）落盘必须经 `_statusRootPersistChain` 串行链（`.then()` 链式 + `.catch(() => {})` 防链毒化），禁止并行的 fire-and-forget writeFile——两次快速 note 在同文件上的竞态不得让旧值后落盘。

#### 场景：两次快速切换 root

- Given note(alpha) 后立即 note(beta)（或 ×20 交替）
- When 落盘完成
- Then 文件最终值为最后一次 note 的值（CI 实证红形态：alpha 盖 beta 不再发生）

### FR-02: 回归用例钉住

- 测试必须新增「快速连续切换 ×20」用例（轮询 3s 断言最终值=最后一次）；既有「切换 root → 落盘覆盖为最新值」用例保持不变并转稳定；红证=该既有用例在旧码上 CI 实跑红 + 本地 3 跑 1 红（竞态窗口窄属概率复现，机理由代码读证：两未串行 writeFile 无顺序保证）。

#### 场景：回归可检

- Given 未来回退为 fire-and-forget 写
- When CI 跑本文件
- Then 概率性红（窗口窄），×20 用例放大检出概率

### FR-03: 相关面全绿

- daemon `tsc --noEmit` 必须 0 error；tests/daemon-status-root-persistence.test.ts 全绿（含新增共 10 用例）；重推后 daemon-ci 必须转绿。

#### 场景：CI 转绿

- Given 修复推送
- When daemon-ci 实跑
- Then success

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/daemon-status-root-persistence.test.ts「快速连续切换 ×20 → 落盘最终必为最后一次值（2026-10-09 竞态回归：串行链）」
FR-02: test/sillyhub-daemon/tests/daemon-status-root-persistence.test.ts「切换 root → 落盘覆盖为最新值（既有用例转稳定；红证=旧码 CI run 37862831833 实跑红 + 本地 3 跑 1 红）」
FR-03: test/sillyhub-daemon「本文件 10 用例全绿 + tsc 0（本地实测）；daemon-ci 重推转绿（推送后验证）」
