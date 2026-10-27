# 符号影响面报告

> tasks.md 内容指纹（生成时）: afb41eb02c588960——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——只读调研卡，产出为 design.md 清单文本回写
- task-02: 接口新增（向后兼容）——解析器导出新段类型与纯函数 parseTaskNotification(text)；既有段类型与导出面零变化
- task-03: 接口新增（向后兼容）——hub-client.ts 新方法 notifyBgTaskFinal(sessionId,payload)；daemon.ts 桥拦截新分支（内部）；events.ts 发桥标记（内部）；既有签名零变化
- task-04: 接口新增——backend 新端点 POST /api/daemon/sessions/{id}/bg-task-final + schema.py 新 DTO BgTaskFinalReportRequest（gen:types 双端义务归 task-07）
- task-05: 接口消费——session-sse.ts 信封类型扩展 bg_task_final；条目组件内部翻转逻辑，props 签名零变化
- task-06: 无签名级变更——计数推导纯函数（新本地导出）+既有状态区挂显示，组件 props 零变化
- task-07: 生成物变更——openapi.json+frontend/sillyhub-daemon 两份 api-types.ts 再生成（task-04 类型面，规则 21）
