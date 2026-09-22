# 符号影响面报告

> tasks.md 内容指纹（生成时）: 3f364e4226d14b4b——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增符号 PlatformChangeEventORM（新 ORM 类，12 列）+ 迁移模块 20260923040000。纯新增类，无既有签名修改、无既有调用点（消费方 task-02 service 尚未存在）。conftest 建表清单追加（fixture 内部数组，非签名）。**无既有签名级变更**。
- task-02: 新增符号 PlatformSyncService.append_events / list_events（新方法）+ ChangeEventPush/ChangeEventPushRequest/ChangeEventItem/ChangeEventPushOk/ChangeEventListResponse（新 Pydantic schema）。全部纯新增，不改既有方法签名。**无既有签名级变更**。
- task-03: router 新增两路由函数（纯新增装饰器端点）；既有端点函数零触碰。**无既有签名级变更**。
- task-04: 新增测试模块 test_change_events.py。**无签名级变更**。
- task-05: lib/changes.ts 新增 listChangeEvents 函数 + 类型 re-export（纯新增导出）；api-types.ts/openapi.json 生成产物（schema 面新增 ChangeEvent* 类型，不删改既有）。**无既有签名级变更**。
- task-06: 新组件 ChangeEventsCard（纯新增）；page.tsx aside 挂载点追加 JSX（不改既有组件 props）。**无既有签名级变更**。
- task-07: 新增测试文件。**无签名级变更**。
- task-08: 纯验证任务，零代码改动。**无签名级变更**。
