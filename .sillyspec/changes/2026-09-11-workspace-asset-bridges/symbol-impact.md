# 符号影响面报告

> tasks.md 内容指纹（生成时）: 9bcbaf5567b643ef——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 签名扩展 2 处——toggle_enable 增可选 workspace_id（缺省 None 零回归）；_collect_enabled_git_skills 增 workspace_id（None 显式 IS NULL）；model 表约束改双 partial。均在任务范围
- task-02: 全新符号（get_server_for_import+import 端点路由）；不改既有签名
- task-03: 全新符号（adoptable/adopt 端点路由）；不改既有签名
- task-04: 签名扩展 1 处——fetchRemoteManifest 增可选 workspaceId；manifest 端点增查询参数；daemon.ts/task-runner.ts 新调用点（选槽）均在范围
- task-05: 无签名级变更——前端区块新增+hook 调用扩展
- task-06: 无签名级变更——弹窗新增+gen:types 生成物
