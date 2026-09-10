# 符号影响面报告

> tasks.md 内容指纹（生成时）: 97a4bd9478f9638c——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——新建文件（read-zcode-sqlite.ts 及其测试），导出的 extractZcodeSessId/createZcodeFixtureDb 为新增符号，无既有调用点。
- task-04: 无签名级变更——read_agent_log_content 端点内部加 zcode format 分支，函数签名/响应模型 AgentLogContentResponse 三字段（content/truncated/size_bytes）不变；_send_agent_log_rpc 复用不改动。
- task-02: 无签名级变更——续写新文件内部实现；导出 readZcodeSqliteMessages 为新增符号，既有调用点零（task-03 将新增消费）。
- task-03: 无签名级变更——host-fs-handler.readAgentLogMessages 内部加先库后文件分派，方法签名与 RPC 响应形状/错误映射（toRpcError not_found/forbidden/method_not_found）不变；registry.ts 不动。
- task-05: 无签名级变更——package.json devDep @types/node 单行 bump，无代码符号影响。
