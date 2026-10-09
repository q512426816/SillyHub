# 符号影响面报告

> tasks.md 内容指纹（生成时）: 7b71202f4101b076——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——runSillyspecInit 函数签名与 RunSillyspecInitParams 接口不变（sillyhub-daemon/src/spec-sync.ts:1697），仅函数体内 spawn argv 删 --no-skills 一项与导出常量 MIN_SILLYSPEC_VERSION_FOR_INIT 改值（消费方仅同文件 compareSemver 门控与测试 run-sillyspec-init.test.ts，均在任务范围内）。
- task-02: 无签名级变更——SILLYSPEC_VALID_TOOLS 是导出 ReadonlySet 常量（值集扩充，类型不变），mapDetectedToSillyspecTools 签名不变；消费点 sillyhub-daemon/src/cli.ts:1188 与 task-runner/index.ts:14 re-export，均为值消费无类型耦合，零改动。
- task-03: 无签名级变更——complete_lease(self, lease_id, claim_token, result) 签名不变（backend/app/modules/daemon/lease/service.py:362），仅 init 回写段内部条件收紧；result dict 的 status 键是既有合法值（daemon task-runner.ts:1073 现状上报）。
- task-04: 无对外签名级变更——workspace-scan-dialog.tsx 内部 Phase 类型联合扩成员（idle/creating → +initializing/done/init_failed），组件 Props（onCreated/onCancel）契约不变，父组件 frontend/src/app/(dashboard)/workspaces/page.tsx:216 零改动；lib 封装 createWorkspace/initDispatch/fetchMyBinding 签名均复用不改。
- task-05: 无签名级变更——workspace-config-card.tsx 仅渲染层插入 Alert，Props 与 handleInit 逻辑零改动。
