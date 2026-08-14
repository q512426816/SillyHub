"""Agent 适配器目录（**故意为空**）。

backend **不在进程内执行 agent**——``AgentAdapter``（``base.py``）是抽象占位，
无具体子类。所有 agent 执行走 daemon lease + subprocess 路径（见
``app.modules.agent.placement.RunPlacementService`` + daemon ``task-runner.ts``），
backend 的职责是编排、治理、收敛，不是执行。

详见平台 4A 架构总纲 §7 关键设计特征「平台只编排不执行」（``docs/architecture-4a.md``）。
"""
