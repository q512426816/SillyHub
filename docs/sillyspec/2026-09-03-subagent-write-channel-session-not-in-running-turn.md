# 子代理写入通道故障：session not in running turn

- 发现：2026-09-03（2026-09-02-changes-overview-card 变更 plan 阶段 TaskCard 批量生成时）
- 状态：活跃（当日自愈路径已验证：主会话代写）

## 现象

并行 TaskCard 填充子代理（4 个 batch）中，子代理会话内一切**变更类**工具调用——Edit（多次）、Write、Bash 的 mkdir/touch/重定向/python/sed -i——统一报错 **"session not in running turn"**。特征：

1. **平台/审批通道层故障，非策略拒绝**——策略拒绝（如 /tmp 写入）有明确 Runtime Policy 消息，此错误无策略理由且发生在命令执行前。
2. **读类调用全部正常**（Read/Grep/Glob/只读 Bash）。
3. **等待无效**——batch C 子代理间隔重试约 8 分钟未恢复；batch D 的回退探测会话确认 Edit 与写路径 Bash 均被拦，"该会话已无法通过任何机制执行编辑"。
4. **主会话不受影响**——同一时间主会话 Edit/Write/Bash 写路径全部正常（已实证：主会话代为落盘 5 张卡片全成功）。
5. **无副作用**——被拒写入均未发生（临时文件未创建、目标文件保持原状、git status 干净），fail-closed 行为正确。

## 影响

子代理「调研成功但产物无法落盘」——工作白做一半，需主会话人工代写恢复。

## 自愈路径（已验证）

- 子代理在结果报告中**带回完整填充内容**（含精确 old_string/新块 YAML），主会话逐卡 Edit 套用——batch C 三卡 + task-08 主会话自填，全部成功。
- 主代理派工 prompt 中要求「完成后返回 allowed_paths 摘要」间接救了场——建议今后批量派工 prompt 一律加「若写入失败，将完整产物内容以可直接 Edit 套用的形式带回」。

## 待确认

- 触发条件不明（4 个同时启动的并行子代理全部命中，当日主会话正常——疑似子代理会话审批通道的间歇性平台故障）。
- 复现样本：会话 9e13677e（2026-09-03 08:46 前后），子代理 task-id a1069eeadcb4fce96（batch C）与 aa270a2647dbe0335（batch D 回退探测）。
