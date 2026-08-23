# 符号影响面报告

> tasks.md 内容指纹（生成时）: 638e65bdc833ab9d——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更。build_scan_bundle 参数签名不变（session/workspace_id/spec_root/root_path/run_id/runtime_root 原样），仅函数体内增 SpecWorkspace.strategy 读取与模板三分支；render_bundle_to_claude_md 签名不变，仅 sillyspec 工具提示文案。调用点 service.py:1589（scan dispatch）无需改动，在任务范围内已覆盖回归断言。
- task-02: 新增导出 2 个符号：isSelfReferentialSpecRoot(cwd, specRoot) / isPlatformMode(platformOpts, cwd)（src/run/shared.js，全新无既有调用点破坏）。既有四处裸判定表达式（triggerSync:536/triggerPull:609/triggerPullActiveChange:631/checkApproval:698）替换为 isPlatformMode 调用——非自指输入下布尔语义逐字节等价，无第三方消费方。
- task-03: 无签名级变更。command.js 指针恢复块（:309-345）/writePlatformPointer 调用门禁（:364）/接管声明 fail-closed 分支（:349-359）均为函数体内控制流调整；init.js isExternalSpec 判定表达式补 realpath；doctor-diagnostics.js 新增告警条目（导出结构不变）。消费方（sync.js disconnect 三清等）不受影响。
- task-04: 无签名级变更。package.json version 字段唯一改动，bin/main 入口与依赖零变化。
- task-05: 无签名级变更。纯验证任务（allowed_paths 仅被验证入口与 verify-evidence.md 产物），零代码产出。
