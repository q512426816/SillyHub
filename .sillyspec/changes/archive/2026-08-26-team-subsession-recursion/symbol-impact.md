# 符号影响面报告

> tasks.md 内容指纹（生成时）: fb94807273bc170b——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——AgentSession 加 NOT NULL DEFAULT 0 列不改既有签名；新增 mission_worker_sessions_tree 递归 CTE（新函数，消费方 02/03/07/08 在范围内）
- task-02: 签名级变更——_dispatch_worker_core 调用方解析规则升级（parent 判别）；_converge_core 增调用方守卫参数；worker_done/busy 枚举换全树（内部）；对外端点响应形态不变，新增 400/403 分支
- task-03: 无签名级变更——mission_derive_status 分身集合换全树（内部）+ _virtual_status 增补映射规则（内部）；is_worker_complete/derive_status 签名不动
- task-04: 签名级变更——prepare_interactive_dispatch 追加 worker_depth 可选参数（默认 None 零回归，对齐 stage 先例）；types.ts 四处类型载体加字段（可选）；SessionManagerOptions 无改（闸为内部计数）
- task-05: 签名级变更（daemon）——受限 server 注册按 depth 两档分层（registerTool 行为分支）；MCP_TOOLSET env 语义扩展；cli 谓词分层
- task-06: 无签名级变更——run_sync 终态处理增补失败即收口规则（内部分支）
- task-07: 无签名级变更——patrol 新增职责⑥（新函数）+ 孤儿/收口枚举换全树（内部）
- task-08: DTO 字段级变更——TeamMissionWorkerSummary 加 sub_workers_count 折叠计数（nullable 可选，gen:types 再生成）；build_worker_briefing 加可选 can_dispatch 参数（默认零回归）；control/finalizer 内部换源
- task-09: 无签名级变更——纯测试新增与预期行为变更断言更新（规则 9 边界内）
