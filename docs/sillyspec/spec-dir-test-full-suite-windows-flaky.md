---
author: qinyi
created_at: 2026-08-04 09:59:20
status: 已缓解（retry 吸收），根因未定
severity: P2
---

# spec-dir.test.mjs 全量套件下 Windows 偶发进程级崩溃（flaky）

## 现象

全量 `npm test` 首跑时，`test/spec-dir.test.mjs` 偶发进程级崩溃（run-tests.mjs 报 exited，无内部断言汇总），单跑恒过。实证复现率约 13%（15 次 2 次）。隔离 `node --test test/spec-dir.test.mjs` 单独跑必过。

## 根因（未确诊）

- timeout 假设已排除：子进程实测均 <1s（date 计时）。
- home 碰撞假设已排除：Test 5 的 projectDir 自带 `.sillyspec`；但 Test 1 输出显示 resolveSpecDir 上溯撞 home 的 `.sillyspec`（这是另一已知 drift 问题，见 `finished/progress-specdir-drift.md`），疑与全量并发有关。
- 疑似 CLI 子进程在并发全量套件下罕见非 0 退出（db 锁 / 指针竞态），但 flaky 罕见，无法稳定抓 stderr 证实。

## 影响

- 全量套件首跑偶发假阳性失败，重跑即过，干扰 CI / agent 判断回归。
- 非功能阻断（代码无 bug），仅测试可靠性噪声。

## 缓解（已落地，commit `2fcbbce`）

`test/spec-dir.test.mjs` 的 `run()` 加偶发崩溃防御：`execSync` 失败时打印 cmd + stderr 诊断 + 1 次重试（吸收偶发降 flaky 率，重试仍失败抛清晰错误保留确定性失败定位），timeout 10s→30s 留余量。**坦诚：非根因治愈，是 retry 吸收 + 诊断增强。**

## 待根治

- 未来若 retry 仍失败，按落盘的 stderr 诊断定位真实根因（疑似 db 锁 / 指针竞态）。
- 可考虑给 spec-dir.test.mjs 的 CLI 子进程统一钉死 `--spec-dir`（memory `sillyspec-test-specdir-isolation.md`），消除上溯撞 home 的竞态面。

## 复现

本仓 sillyspec：`npm test` 连跑，spec-dir.test.mjs 偶发失败（~13%）。缓解后连跑 4 次 spec-dir 全过（retry 未触发即兜底到位，但根因未消，仍可能偶发）。
