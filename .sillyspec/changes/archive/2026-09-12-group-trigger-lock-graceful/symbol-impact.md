# 符号影响面报告

> tasks.md 内容指纹（生成时）: bee748ac4ae2ef27——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 逐行把 `<!--TODO-->` 替换为真实结论（已按下方分析填写）。

- task-01: shadow.py `_ensure_shadow_session` 内部锁段重构为三段式（无锁快查→FOR UPDATE→超时降级）。**无签名级变更**：函数签名（参数/返回二元组）与既有幂等复用分支判定不变；异常面新增出口 GroupChatInvalid（既有群错误族，调用点 send_group_message/gather 部分失败收集已按 AppError 族处理，无需改动调用方）。
- task-02: messages.py use_consensus 分支在 gather 前新增显式 commit + 标量预取。**无签名级变更**：不改任何函数签名/DTO/接口；consensus_task ORM 对象引用改预取标量属函数内局部变量，外部不可见。
- task-03: NEW 测试文件 test_group_trigger_lock.py 三用例。**无签名级变更**：纯新增测试（monkeypatch 注入 + 断言），不改生产代码符号。
- task-04: 回归 + 真实环境复验。**无签名级变更**：只跑测试与外部验证（pytest/ruff/mypy/curl/psql），不改任何代码。
