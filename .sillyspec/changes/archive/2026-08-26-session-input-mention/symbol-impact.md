# 符号影响面报告

> tasks.md 内容指纹（生成时）: 4620ce1402ce3c86——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无既有签名级变更——新文件 session-mention.ts 纯新增导出符号 detectMention 与 applyMentionPick，无调用点受影响（消费方 task-02/03 为本变更新增接线）。
- task-04: 新增导出符号——session-mention-sources.ts 新文件导出 useMentionSources；query-keys.ts 追加缓存键常量（纯新增，不动既有键）；既有 fetch 函数与 usePlatformSkillsManifest 签名零改动。
- task-06: 私有符号返回结构扩展——_summarize_skills（模块内私有）聚合 dict 每项新增 invoke_name 键；受影响调用点 build_skills_manifest（同文件）与 test_skills_bundle.py 精确断言（:449）均在任务 allowed_paths 内；manifest 端点响应 dict 新增键对既有消费方（skill-manager.ts 只读 version/files）零影响。
- task-07: 公共 schema 与方法签名扩展（均可选默认，零破坏）——①SessionInjectRequest 新增 bind_change_key/bind_quick_id 可选字段（生成类型经 gen:types 自动扩展，task-08 消费）；②daemon/service.py Facade inject_session 与 SessionService.inject_session 方法签名追加可选参数；③router inject_session 端点透传新参。既有调用点（不传新参）行为逐字节不变（page_context 先例模式）。
- task-02: 无既有签名级变更——新组件文件纯新增导出 SessionMentionPopover 及其 Props 类型；props 数据经注入（onSelect 抛原始实体），不改任何既有组件接口。
- task-08: 类型级可选扩展——①custom-skills.ts PlatformSkillSummary 加可选 invoke_name（手写类型，消费方零影响）；②daemon.ts injectSession 的 options 类型经 Omit<SessionInjectRequest> 自动获得新字段，函数签名本身零改动，组装分支为增量；api-types.ts/openapi.json 为生成产物整体更新。
- task-03: 接口可选成员扩展——SessionInputBarProps 新增可选 onMentionsChange 回调（3 个既有渲染点不传则行为不变，task-05 接线时传入）；组件内部新增 textareaRef 复用与 pendingCaretRef，不动既有 props 语义。
- task-05: 无签名级变更——session-panel.tsx 组件内部接线（state/useCallback 闭包内组装请求体），不改导出符号与 props 契约；placeholder 经既有 prop 传参更新文案。
- task-09: 无签名级变更——纯测试执行任务，不改任何源码。
- task-10: 无签名级变更——冒烟验收任务，仅新增 smoke-result.md 记录文件。
