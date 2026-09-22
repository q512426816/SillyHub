# 符号影响面报告

> tasks.md 内容指纹（生成时）: f0da626fff2ca785——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——仅对既有私有函数 formatTokensCompact/formatCount/formatDurationZh 追加 export 关键字（函数体/参数零改动），调用点仅新增移动卡消费方（task-02，在范围内）
- task-02: 无签名级变更——MobileChangeCard props 不变（change/onClick），纯渲染增强；新增 import：ChangeActivityBadge 与 task-01 导出的三个格式化 helper（消费方在 task-01 provides 契约内）
- task-03: 无签名级变更——页面内部新增 reparseChanges 调用与本地 state（lib/changes.ts 只读复用，不改签名）
- task-04: 无签名级变更——sortDir 由模块常量 DEFAULT_SORT 升为组件 state（模块私有，无外部引用；grep 确认无其它文件 import DEFAULT_SORT/SortDir）
- task-05: 无签名级变更——quicklog query key 槽位值从字面量默认改为 state（key 形态不变，react-query 消费，无函数签名变化）
- task-06: 无签名级变更——StageStepper 为 mobile-change-detail.tsx 模块私有组件（未导出，grep 确认无外部引用），签名扩展 { currentStage } → { currentStage, stepStages, focusStage, onStageClick } 仅影响同文件调用点；ChangeStepTimeline focusStage prop 为既有 prop 透传
- task-07: 无签名级变更——页面内部 menuActions 数组追加项与本地 state；DeleteChangeConfirm/canDeleteChange/useChangeDeleteAccess/deleteChange 均只读复用
- task-08: 无签名级变更——纯测试补齐与 mock 对齐，被测源仅最小改动（无函数签名变化）
