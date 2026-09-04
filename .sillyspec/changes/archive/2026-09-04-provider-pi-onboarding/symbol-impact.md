# 符号影响面报告

> tasks.md 内容指纹（生成时）: 2e153900044dab6f——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增类 PiEventNormalizer（pi-events.ts，纯函数 normalizeRpcLine）——无存量签名变更；产出契约 AgentEvent（上游已合入）。
- task-04: 数据表扩展：INTERACTIVE_PROVIDERS/PROVIDER_CAPS 加 pi 键（Record 动态，无类型签名变更——InteractiveProvider keyof 推导自动扩展）；cli.ts drivers 对象加一行（对象字面量非签名）；detector PROVIDER_SPECS.pi 加 minVersion 字段（表内数据）；backend/frontend caps 镜像 dict 加键。
- task-02: 新增类 PiRpcDriver implements InteractiveDriver（pi-rpc-driver.ts）——实现既有接口，无接口签名变更；新增内部 LF 分帧器。
- task-03: PiRpcDriver 内部方法扩展（inject 三模式/settled 收敛/ui_request 处理/resume/interrupt）——类内新增，无对外签名变更。
- task-05: 无签名级变更：前端两处引擎白名单集合字面量加 pi（数据非函数签名）。
- task-06: 条件性：caps.subagent 翻值（表数据）+ pi-rpc-driver.ts spawn 参数加 --extension（内部参数）；pi-events.ts 若实测有归属则增映射分支（类内方法）。
- task-07: 无签名级变更：纯冒烟+文档。
