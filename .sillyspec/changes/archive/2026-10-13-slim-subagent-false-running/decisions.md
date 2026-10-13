---
author: flow-machine-draft
created_at: 2026-10-13T07:38:35.770Z
---
# 决策记录（Decisions）— 2026-10-13-slim-subagent-false-running

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：回退键与行内解析键不一致造成错误合并——已用优先级消解（行内解析值恒优先；回退值仅当行内解析失败，此时行内无任何键可用，不存在二义）。次风险：孤儿 stub 误标把实时暂态 stub 变灰——标记只存在于 logsToSegments（历史批量）收尾，实时增量路径不经过该函数，结构性隔离。 放弃方案：① 前端对截断行按需拉全文再装配（getAgentSessionLogFull）——装配在 attach 同步路径上，逐条串行拉取拖慢秒开，且窗口翻页放大请求数；② 后端截断时保留 JSON 头部完整包络（截 args 保尾部）——需重排 daemon 落库格式，波及存量数据与 daemon 版本兼容，收益不成比例；③ 只做方案 C 不做 A——治标，配对仍断，子代理块状态/时长/任务徽标依旧缺失。
