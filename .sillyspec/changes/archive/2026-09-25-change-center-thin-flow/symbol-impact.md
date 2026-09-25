# 符号影响面报告

> tasks.md 内容指纹（生成时）: a1521451e57b7119——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更。StageEnum 新增枚举成员 THIN（不新增方法、不改 spec_auxiliary_stages 返回长度契约——返回列表多一项但类型不变）；STAGE_AGENT_CONFIG 加字典条目（值结构 StageAgentConfig 复用现有类型）；_stage_group_order 仅改内部排序表（函数签名不动）。消费方（dispatch/proxy/前端经 JSON）均为数据驱动，在任务范围内。
- task-02: 无签名级变更。新增 prompt 模板文件 thin.md（数据文件）+ dispatch.py 派发入口内加 _validate_thin_change_key 私有函数（模块内新私有符号，无既有调用点受影响）；白名单仅对 thin 变更生效，非 thin 路径零变化。
- task-03: 无签名级变更。change_writer service/proxy 两处仅改 initial_stage 字面量分流（"quick"→"thin"），函数签名与 stages JSON 组装结构不变（组键随 initial_stage 单变量联动）。
- task-04: 无签名级变更。extract_spec_bindings 内部循环加 flow 命令族识别分支，函数签名与返回类型 SpecCommandBinding 列表不变；消费方 submit_commit 解析链零改动。
- task-05: 无签名级变更。sync_stage_status 与 _sync_change_stage_status 两函数签名不动，仅在函数体内加守卫谓词分支（thin×非 archived 跳过回写；archived 放行）；守卫谓词为模块内私有常量/逻辑。
- task-06: 无签名级变更。_infer_current_stage 函数签名不动，仅内部推断规则前置一条（flow-state.yaml 在场→thin）。
- task-07: 无签名级变更。前端改动全部是常量映射对象加键（STAGE_KIND/STAGE_LABELS/STATUS_BADGE/STAGE_OPTIONS/WORKFLOW_STAGE_LABELS/BYPASS_BADGES）与旁路判断加 "thin" 字面量，组件 props 接口不动；current_stage 全链 string 类型（design 非目标：禁 Literal）。
- task-08: 无签名级变更。change-stage-actions.tsx 与 mobile-change-detail.tsx 加 thin 渲染分支（JSX 条件渲染），组件 props 接口不动。
- task-09: 无签名级变更。纯文案/标注改动（tab 徽标文案、空态文案、统计卡 label），数据链路与组件接口零改动。
- task-10: 无签名级变更。纯文档/配置改动（CLAUDE.md/SKILL.md/工具坑留档/模块文档四件），不涉任何代码符号。
