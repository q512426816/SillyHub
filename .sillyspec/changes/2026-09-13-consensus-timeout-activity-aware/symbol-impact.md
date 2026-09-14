# 符号影响面报告

> tasks.md 内容指纹（生成时）: 5b4e6c1502932a19——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更。consensus_sweep_once（内部插入续期段；签名/返回不变）+ 新增模块私有 helper _member_is_active（无外部调用点）+ write_consensus_card/_card_content 内部 content 拼接。调用点：consensus_sweeper_loop（同模块，不受影响）；无 task allowed_paths 外的调用点。
- task-02: 无签名级变更。create_consensus_task（内部去重，签名不变）；_parse_group_mentions（by_name 构造逻辑，签名/返回不变——调用点 messages.py 发送侧/crud 邀请等均不受影响）；_card_content 内部；messages.py 触发失败路径（gather 结果处理段内部）。均在 allowed_paths 内。
- task-03: 无签名级变更。新建测试文件，无既有符号改动。
- task-04: 无签名级变更。纯验证任务（无源码 diff）。
