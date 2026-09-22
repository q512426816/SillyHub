# 符号影响面报告

> tasks.md 内容指纹（生成时）: 33784a65269daee8——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口定义变更：ProviderCaps 加 steering: boolean（sillyhub-daemon/src/interactive/providers.ts:69）+ PROVIDER_CAPS 表加键；受影响调用点=三端守护断言（provider-registry.test.ts thirteenKeys:153、test_provider_caps_alignment.py EXPECTED_CAPS_KEYS:46、pre-session-picker.test.tsx 全对象 toEqual）与生成镜像（gen-provider-caps.mjs CAPS_KEYS:59）——全部在 task-01 allowed_paths 7 文件内
- task-02: 无签名级变更（仅新增 spike 探测记录文档，零代码）
- task-03: 无公开签名级变更：codex 驱动输入循环（:1231-1239）内部加 turn/steer 分支与私有辅助，InteractiveDriver 契约（driver.ts）不动；调用点=driver 消费链 session-manager 既有 inject 路径，行为增量不破坏
- task-04: 无签名级变更（spike 实测 + 测试文件追加用例；claude-sdk-driver.ts 不在 allowed_paths，驱动源码零改动）
- task-05: DTO 变更：SessionInjectResponse（backend/app/modules/daemon/router/session_crud.py:83? 本地 DTO）加 steered: bool；调用点=前端手写镜像 frontend/src/lib/daemon/sessions.ts:274（task-07 allowed_paths 内，契约已声明 expects_from/provides）；execute 修正：busy_strategy 原仅服务身份路径（inject_session_as_service:279）有——用户路径三层同步加参（inject.py/__init__.py/service.py，execute task-05 提交内，仓内三层惯例），调用点全在 task-05 提交内
- task-06: DTO/返回结构变更：QueueDispatchNowResponse（backend/app/modules/daemon/schema.py:550-562）加 dispatch_mode Literal 三态（interrupted 保留）；queue.py dispatch_now 返回派生三态；调用点=backend/app/modules/daemon/router/session_queue.py:197-198（范围内）与前端 task-08（消费方，契约已声明）
- task-07: 前端接口定义变更：手写镜像 SessionInjectResponse（frontend/src/lib/daemon/sessions.ts:274）加 steered?: boolean（gen:types 覆盖不到）；调用点=session-panel-page/dialog 渲染层（范围内双挂载）
- task-08: 无签名级变更（纯展示组件文案与降级标注，回调签名不动）
- task-09: 无签名级变更（api-types.ts 生成产物 + 测试断言同步）
- task-10: 无签名级变更（模块文档同步）
