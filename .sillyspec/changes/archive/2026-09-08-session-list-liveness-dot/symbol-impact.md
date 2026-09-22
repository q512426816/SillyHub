# 符号影响面报告

> tasks.md 内容指纹（生成时）: 353facaa0142942a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增 hook use-session-liveness 与私有 helper（readLastState/writeLastState/isUnread/clearUnread）——纯新增导出，无既有签名变更。
- task-02: SessionRowProps 增可选 liveness/livenessUnread（向后兼容，既有调用点不传即旧行为）；SessionListPanel 对外 props 零改动（hook 内部消费）；无破坏性签名变更。
- task-03: 测试文件新增/扩展——无签名级变更。
