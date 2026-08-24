---
id: task-07
title: '前端新增 BashProgressCard 组件'
title_zh: '前端新增 BashProgressCard 组件'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-05']
blocks: ['task-09']
requirement_ids: [FR-01]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/bash-progress-card.tsx
expects_from:
  task-05: 'onBashStatus / onBashChunk 事件 envelope（含 command / status / channel / content）'
goal: >
  实现 BashProgressCard UI 组件：接收 bash_status 与 bash_chunk 事件，实时展示命令行、
  执行状态、退出码、运行时长与 stdout/stderr 输出片段。
implementation:
  - 创建 BashProgressCard 组件：props 含 command、status、exitCode、elapsedMs、chunks
  - 命令行展示可复制按钮；running 态显示 spinner，completed/failed 显示退出码徽标
  - 组件内部按到达顺序累加 stdout/stderr chunk，等宽字体分区展示
  - 输出超过阈值时默认折叠，提供展开/收起按钮（R-03 性能缓解）
  - is_final=true 时停止 spinner；状态由 props 驱动，不额外请求数据
acceptance:
  - running 态无退出码且显示 spinner
  - completed/failed 展示 exit_code 与 elapsed_ms
  - stdout/stderr chunk 按顺序追加、channel 标签正确
  - 超长输出可折叠/展开
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/bash-progress-card.test.tsx
constraints:
  - 不直接发起 SSE 或 HTTP 请求
  - 不支持前端取消 Bash 命令
  - 仅做展示层消费，不修改事件对象
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
