# Spikes — V0 风险验证

> 这 3 个 spike 是 V1 开工前的**强制前置验证**。**任何一个不通过，V1 必须暂停**，先解决底层问题。
>
> **当前状态：3/3 PASS（2026-05-25）— 详见 [`REPORT.md`](./REPORT.md)。V1 前置门禁已解除。**

## 目的

| Spike | 验证 | 不通过的后果 |
|---|---|---|
| 01-git-isolation | 单机多用户 Git 凭据 / 环境隔离 | 平台核心安全模型不成立，重新选型 |
| 02-workspace-scan | SillySpec Native Layout 实际可解析、性能可接受 | 重新评估 SillySpec 协议是否够稳定 |
| 03-claude-code | Claude Code 子进程可受控、工具调用可拦截 | V4 Agent Adapter 设计需要改用 Docker / 其他工具 |

## 推荐执行顺序

```text
01 → 02 → 03
```

01 失败立即停，01-02 都过再做 03。

## 运行环境

- Linux / macOS：bash + git ≥ 2.40 + python ≥ 3.12
- Windows：PowerShell 7 + Git for Windows，部分脚本需另行适配
- Claude Code CLI（spike 03 需要）：`npm install -g @anthropic-ai/claude-code` 或按官方文档

## 通过准则

每个 spike 在 `<spike>/README.md` 列出 PASS 条件。脚本最后会打印 PASS / FAIL。**至少跑 3 次连续 PASS 才能视为通过**（避免偶然）。
