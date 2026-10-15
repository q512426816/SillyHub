# 符号影响面报告

> tasks.md 内容指纹（生成时）: 2a3789e44fd2e06d——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: configure_logging 内部行为扩展（新增 FileWriter processor 挂链 + 目录创建）——函数签名不变（level: str 参数同），无调用点受影响；新增导出 get_log_file_path()/常量/FileWriter 类（新增符号）；config.py 新增 Settings.log_dir 字段（Pydantic 字段扩员，无破坏）；paths.py 新增 resolve_log_dir(raw)（新增符号）。无签名级变更（无既有签名增删改）。
- task-02: health/router.py 新增两个路由函数（新增符号，无既有签名改动）；新增 log_reader 模块函数（新增符号）；openapi.json/api-types.ts 生成物再生成（规则 21，编译期收录无手写签名面）。无签名级变更。
- task-03: frontend/src/lib/health.ts 新增导出 getServerLogs/downloadLogFile（新增符号）；新建 ServerLogPanel 组件（新增符号）。无既有签名增删改——无签名级变更。
- task-04: page.tsx 删除 StatCell 组件定义与消费（内部组件非导出符号，无外部引用——全仓 grep 已证仅本页使用）；其余为 JSX 结构变更。无签名级变更。
