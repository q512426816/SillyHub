# 符号影响面报告

> tasks.md 内容指纹（生成时）: f7e34b95fccef746——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增导出 writeFileAtomic（新符号，无既有签名变更）；调用点=本变更 task-02/03 新接入，无既有调用点受影响——在任务范围内。
- task-02: 无签名级变更——六个写盘点函数（writeAuthJson/writeCodexHome/writeModelsJson/writeSettingsJson/mirrorCodexHostAuth）签名与返回形状不变，仅体内 writeFile/copyFile 换 writeFileAtomic；调用点（provider-file-settings.ts writer.write / restore 探测镜像）零影响——在任务范围内。
- task-03: 新增导出 MANAGED_MARKER_FILENAME 常量（新符号）；applyProviderFileSettingsForReload 签名与五分支返回值语义不变（分支四标记失败时返回值仍为 prior 键——既有「镜像失败=等同未切」语义延伸，非签名变更）；消费方=task-04/05 在任务范围内。
- task-04: _reloadSessionNow 签名不变（类私有方法，无外部调用点）；内部新增局部常量 PROVIDER_RELOAD_ENGINES 与局部布尔 fileLayerTouched；catch 块新增回滚调用——调用方（markPendingSwitch/markPendingConfigSwitch/_onResult/events.ts 四处）均为 .catch 兜底，行为面=白名单外 provider 切换从静默尝试变显式 throw（D-005@v2 设计内），在任务范围内。
- task-05: 无签名级变更——persistence 恢复函数签名与返回形状不变，null+codex 探测判据从 stat 目录改标记/legacy/零动作三态；消费方=restoreAndReconnect 既有链路，行为面=迁移钩子形态目录从误判 managed 改零动作（F3 修复目标），在任务范围内。
- task-06: 无签名级变更——纯测试回归与模块文档更新，无源码符号改动。
