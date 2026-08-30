# 符号影响面报告

> tasks.md 内容指纹（生成时）: da9f2db11a72e75a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增 ORM 类 AgentRunModelUsage（新符号，无既有签名变更）；受影响调用点=backend conftest create_all（自动纳入，无需改）；范围内。
- task-02: DTO 扩展：InteractiveRunResultRequest 增可选 model_usage/api_requests 字段、RuntimeUsageRead 增 by_provider（可选字段追加，向后兼容）；受影响调用点=daemon hub-client（生产方，不校验 schema）、前端 api-types（生成物）；范围内。
- task-03: 无签名级变更（close_interactive_run 内部逻辑扩展，函数签名不变）；受影响调用点=daemon notifyRunResult 上游（payload 加可选键，兼容）；范围内。
- task-04: 无签名级变更（complete_lease 内部 stats 应用段扩展）；范围内。
- task-05: RuntimeUsageRead 构造新增 by_provider 装配（schema 已在 task-02 扩，本 task 是查询侧实现）；受影响调用点=runtime router（透传响应，零改）；范围内。
- task-06: daemon.ts payload 新增可选键 model_usage/api_requests；新增内部函数 _modelUsageRows（私有，无外部签名影响）；受影响调用点=hub-client notifyRunResult payload 类型（duck-type 可选键，兼容）；范围内。
- task-07: StreamJsonAdapter 新增公开 getter（messageStartCount，只读）；task-runner stats 组装扩展、hub-client body 条件透传（可选键）；范围内。
- task-08: 纯测试文件，无签名级变更。
- task-09: 组件内部删块（SessionConfigCtrlKind 枚举收缩 + props 删除 machine 相关）；受影响调用点=session-panel/父组件传参处（需同步清理传参，session-config-bar.test 同步修剪）；范围内（前端两文件簇）。
- task-10: injectSession 函数签名追加可选 model 参数（lib/daemon.ts）；受影响调用点=session-config-bar 切换提交处（本 task 内改）；范围内。
- task-11: inject_session 方法签名追加可选 model 参数（backend facade+impl 两层）；受影响调用点=daemon WS 路由透传（SESSION_INJECT payload 加可选键）+ 前端（task-10 对齐）；范围内。
- task-12: 组件展示扩展（runtime-card 消费 by_provider 可选字段）；受影响调用点=page-usage.test mock 需补字段；范围内。
- task-13: 回归验证类 task，无签名级变更。
- task-14: 文档 task，无签名级变更。
