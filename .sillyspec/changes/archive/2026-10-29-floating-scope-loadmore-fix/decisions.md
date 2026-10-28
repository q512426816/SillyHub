---
author: flow-machine-draft
created_at: 2026-10-28T23:32:25.637Z
---
# 决策记录（Decisions）— 2026-10-29-floating-scope-loadmore-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：稳定键漏拼某个标识字段——某分支字段未进键，则该字段变化不触发清空（旧口径附加段泄漏进新视图）。对策：键构造与类型判别联合同文件同居（类型加字段时函数在同文件可被 tsc 联合收窄错误立即暴露）+ 纯函数四分支键唯一性用例钉死。放弃的方案：①floating-session-host 侧 `useMemo` 包 scope——只修一个调用入口，未来新调用方内联传参复发；且 `lockedRuntime` 若引用不稳定 useMemo 依赖仍需二次防御，不如消费端标量化根本。②effect 依赖改 `scope?.kind` 仅判 kind——同 kind 不同 id 切换漏清（FR-02 场景），不可行。
