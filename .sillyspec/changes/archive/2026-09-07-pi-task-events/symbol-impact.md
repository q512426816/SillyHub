# 符号影响面报告

> tasks.md 内容指纹（生成时）: quick-pass——逐行替换自 CLI 骨架。
> gate 拒绝仍含 <!--TODO--> 的行。

- task-01: 符号内增（无签名级破坏）——PiEventNormalizer 增私有字段 turnTask 状态与私有方法（派生逻辑）；公共方法 normalizeRpcLine 签名不变；构造器 opts?.now 已存在（ql-20260904-031，pi-events.ts:119-122）直接复用。受影响调用点：pi-rpc-driver.ts:518 唯一实例化点（实例级状态每会话独立，行为兼容，在范围内——该文件零改动）。
- task-02: 无签名级变更——纯测试文件：既有用例 expected 数组适配（追加派生事件）+ 新 describe。受影响调用点：无（仅 tests/interactive/pi-events.test.ts 自身）。
- task-03: 无签名级变更——新增测试文件 pi-task-dispatch.test.ts，复用 session-manager 测试 harness 与真实 normalizeRpcLine 事件源。受影响调用点：无。
- task-04: 无签名级变更——模块文档 daemon.md 追加 pi 派生说明段。
