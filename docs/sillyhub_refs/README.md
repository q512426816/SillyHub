# SillyHub / SillySpec 参考文章整理包

本包把本轮讨论过的几篇 AI Agent / Harness / 知识库 / Runner 相关文章，整理成面向 SillyHub 平台设计的 ref 文件。

## 文件清单

- `ref-01-harness-runtime.md`：Harness Engineering 文章整理，重点是 Agent 受控运行、Tool Gateway、状态机、审计。
- `ref-02-knowledge-moat.md`：知识沉淀文章整理，重点是知识库、知识分层、知识生命周期、RAG/向量索引定位。
- `ref-03-anti-virtual-company-agent.md`：反“三省六部 / 虚拟公司式多 Agent”文章整理，重点是主线任务、委派式 Agent、上下文连续。
- `ref-04-take-root-harness.md`：take-root 文章整理，重点是机制化约束、权限隔离、对抗评审、收敛指标。
- `ref-05-cloud-claude-code-runner.md`：Claude Code 云端部署文章整理，重点是 Server Runner、HTTP/SSE、沙箱、多用户隔离。
- `ref-99-sillyhub-design-synthesis.md`：综合结论，沉淀为 SillyHub 平台设计原则。

## 总结一句话

SillyHub 不应只是“多 Agent 平台”，而应定位为：

> 受控 AI 工程交付 Harness + 团队知识沉淀系统 + 本地/云端混合 Runner。

核心原则：

> Prompt 管认知，Policy 管权限，Workflow 管流程，Sandbox 管执行，Knowledge 管复利，Audit 管追责。
