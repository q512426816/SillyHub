# 符号影响面报告

> tasks.md 内容指纹（生成时）: 41dad5338fa99562——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: FloatingSessionState 接口新增 lockedRuntime 字段+openRuntimeSession/closeRuntimeLock 两个新 action；既有动作签名不变，仅闭包内不自动清 lockedRuntime；store 唯一消费方 FloatingSessionHost 由 task-03 同步适配
- task-02: SessionListScope 联合新增 RuntimeScope 成员（kind:runtime + runtimeId）；SessionListPanelProps.scope 接受该新变体，既有 workspace/change 调用零影响；新增 RuntimeScope 导出类型
- task-03: 内部实现变更（左栏 CompactSessionList→SessionListPanel、抽屉 CSS 宽度），无导出符号签名变更
- task-04: page.tsx 内部删除 dialogRuntime/initialSessionId 两个 state+RuntimeSessionDialog import/渲染；handleOpenSession 改调 store（传参形状不变仍传 runtime）；均为 page.tsx 内部实现无外部消费方
- task-05: RuntimeSessionDialog 组件与 RuntimeSessionDialogProps 接口删除；由 task-04 清零引用后安全删除
- task-06: 无签名级变更（纯验证）
