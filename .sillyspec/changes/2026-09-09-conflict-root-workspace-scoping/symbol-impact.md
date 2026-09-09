# 符号影响面报告

> tasks.md 内容指纹（生成时）: 34d6e318d878be26——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: **签名级变更 ×3**（均在任务范围内，调用点同步改）：① `SillySpecManager.Deps` 增可选字段 `statusRootFor?`（消费方仅 daemon.ts 构造注入，task-02 接线）；② `conflictSnapshot(change, kind)` → `(change, kind, workspaceId?)` 可选尾参（唯一外部调用 daemon.ts L6321 RPC handler，task-02 透传；可选参不改既有调用兼容）；③ `runResolve(change, strategy)` → `(change, strategy, workspaceId?)` 同上（SillySpecCommandExecutor 接口 L1454 与 _routeSillySpecResolve L6727 同步，task-02）；内部 `_requireCommandPrecondition(action, identify)` → 增可选 workspaceId 尾参（私有，manager 内 runResolve/runGhostCleanup 两调用位，ghost 不传走 legacy）。
- task-03: **签名级变更 ×1**：`_ensure_workspace_member(user_id, workspace_id)` → 公开 `ensure_workspace_member(user_id, workspace_id, action="查看")` 增可选尾参（调用点：compare() 内 1 处 + task-04 resolve 端点新增 1 处；测试若直调私有名同步改）。`_fetch_snapshot(instance_id, change, kind)` → 增 workspace_id 尾参（私有，compare() 内 2 调用位）。
- task-04: **DTO 签名级变更 ×1**：`MachineSillySpecResolveRequest` 增必填 `workspace_id`（pydantic——消费方前端 task-06 经 gen:types 同步；缺失请求 422 属预期行为变化）。`ws_hub.send_sillyspec_resolve(daemon_id, change, strategy)` → 增 workspace_id 必填尾参（调用点 machines.py resolve 端点 1 处，同任务内改）。端点函数体签名不变。
- task-02: **接口签名级变更 ×1**：`SillySpecCommandExecutor.runResolve` 接口（daemon.ts L1454）增可选 workspaceId 尾参——实现方 SillySpecManager.runResolve（task-01 已改）、duck-type 探测点 L6800（typeof 检查不受影响）。`_routeSillySpecResolve` 私有签名同步。`_noteSillySpecStatusRoot` 签名不变（仅内部行为：无 ws 提前 return）。
- task-05: 无签名级变更（仅 message 字符串字面量分叉）。
- task-06: 无签名级变更（消费 task-04 生成的 api-types.ts 新字段；modal 调用处传参扩充属调用侧）。
