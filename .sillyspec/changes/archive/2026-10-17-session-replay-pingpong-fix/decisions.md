---
author: flow-machine-draft
created_at: 2026-10-17T13:05:51.677Z
---
# 决策记录（Decisions）— 2026-10-17-session-replay-pingpong-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：比较漏判让乒乓换个字段复活。user 若未来从扁平对象演化为嵌套可变对象，现行「键排序后序列化」只对顶层键排序、不递归——需升级为递归 canonical（或改存单调版本号比对），session.test.ts 的键序用例会先红提示。 放弃的方案：①自定义 storage 包装层做写前去重——改动所有落盘路径，风险大于收益；②比较完整信封原始字符串——两端内存 user 对象键序不同会令字符串恒不等，乒乓换字段复活；③给 (dashboard)/layout 的 fetchMe 加节流——只治标，每秒 10+ 次 setItem 的写盘风暴仍在。
