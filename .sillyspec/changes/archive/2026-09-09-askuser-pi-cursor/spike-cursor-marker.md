# Spike 记录 — spike-01 / task-05：cursor-agent 标记遵守率判定

> 状态：**INCONCLUSIVE（额度受阻）**——非 GO 非 NO-GO；task-08（prompt 注入）挂起至补测完成。判定人：主代理（自动化脚本），2026-09-09 深夜。

## 执行历史

| 轮次 | 结果 | 原因 |
|---|---|---|
| 1 | 0/10（无效） | 脚本缺陷：cwd 不受信被 CLI 拒（缺 --trust --force） |
| 2 | 0/10（无效） | 脚本缺陷：Node 经 cmd /c 传参，提示词内 JSON 双引号破坏 cmd 引号解析，标志被吞 |
| 3 | 语法错误未跑 | 脚本转义缺陷（\2026 八进制），整文件重写（path.join 直连 node.exe） |
| 4 | **2/2 有效运行全 PASS，其余 8 次 CLI 直接报额度错误** | `ActionRequiredError: You've hit your usage limit. Get Cursor Pro for more Agent usage`（exit=1，stderr 原文在 %TEMP%/askuser-spike-results.json） |

## 判定口径与证据

- 协议前缀：与 task-08 计划注入的协议说明同文（fenced ```askuser 单行 JSON，kind/question 必填，输出后结束本轮）。
- 判定器：与 task-06 前端解析器同口径（宽松 fenced 匹配 + JSON.parse + kind/question 校验）。
- 有效运行 2 次（场景 1「登录页按钮样式」/ 场景 2「数据库配置」）：**2/2 合规**（kind=select，问题与选项完整，位于回复末尾）。
- 其余 8 次：CLI 层面被额度墙拒绝，模型未运行——**不构成遵守率反证**。

## 结论与后续

1. **不满足 ≥8/10 判据（样本不足），不判 NO-GO**——D-003@v2 的降级路径针对「模型不吐标记」，本次是账号额度问题。
2. **task-08（daemon prompt 注入）挂起**，补测条件：Cursor 免费额度恢复（预计次日窗口）后重跑脚本（%TEMP%/askuser-spike.mjs，path.join 直连形态已验证可用）；补测 ≥8/10 → task-08 执行 + cursor caps 保持 marker；<8/10 → task-08 取消 + 三端 caps cursor 改 none（task-12 已预留联动锚点）。
3. task-06（解析器）/task-07（marker 卡）/task-11（群聊 marker 分支）不受影响照常交付（协议资产）；真机冒烟 task-13 的 cursor 场景同样受额度约束，届时视额度状态执行或记录受阻。
4. 环境事实沉淀：cursor-agent 免费档 Agent 用量约 2 次/窗口即触顶——**生产使用 cursor 会话本身就会频繁撞墙**，这是比标记遵守率更先暴露的现实约束（用户可考虑 Pro 或知悉现状）。

> **补测第 2 轮（2026-09-10 01:30）**：额度仍未恢复（10/10 全部 ActionRequiredError usage limit）——窗口疑为每日制。task-08 继续挂起，下一补测窗口建议次日。
