---
author: flow-machine-draft
created_at: 2026-10-20T03:44:06.234Z
---
# 提案书（Proposal）— 2026-10-20-session-error-visibility

## 动机

任务原话转写：会话页失败轮错误信息不可见修复

用户在腾讯云平台 codex 会话失败时（会话 71419980），页面只显示「第 1 轮 · ✕ 已中止」，真实错误（codex exited code=1 / stream disconnected 等）完全不可见，无法排查。根因：backend 把 SDK error_during_execution（含全部模型错误）统一落 error_code=interactive_interrupted，前端 runTerminalTurnStatus/deriveTurnTerminalStatus 据此归 killed（已中止）且不回填 errorDetail，错误卡（RunErrorItem）永不渲染；且错误卡 raw 藏在「查看详情」折叠里。修复：快照与实时两路径按 error_detail 非空区分「模型失败」与「真打断」——前者渲染错误卡（status failed + errorDetail），后者保持已中止；RunErrorItem 默认展示 raw 首行摘要。

成功标准：
- 失败轮（error_code=interactive_interrupted 且 error_detail 非空）在会话页面渲染错误卡，轮状态显示为失败而非已中止
- 错误卡默认直接可见原始错误文本首行（如 codex exited code=1），无需点击查看详情
- 真打断（error_detail 为空的 interactive_interrupted）仍显示已中止，不出现错误卡
- 相关前端测试更新并通过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 失败轮（error_code=interactive_interrupted 且 error_detail 非空）在会话页面渲染错误卡，轮状态显示为失败而非已中止
2. 错误卡默认直接可见原始错误文本首行（如 codex exited code=1），无需点击查看详情
3. 真打断（error_detail 为空的 interactive_interrupted）仍显示已中止，不出现错误卡
4. 相关前端测试更新并通过

## 成功标准（可验证）

1. 失败轮（error_code=interactive_interrupted 且 error_detail 非空）在会话页面渲染错误卡，轮状态显示为失败而非已中止
2. 错误卡默认直接可见原始错误文本首行（如 codex exited code=1），无需点击查看详情
3. 真打断（error_detail 为空的 interactive_interrupted）仍显示已中止，不出现错误卡
4. 相关前端测试更新并通过
