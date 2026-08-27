---
id: task-01
title: 'install-docx-preview-and-sheetjs-deps'
title_zh: '依赖引入 docx-preview + SheetJS 官方源 tarball，安装可复现实测（失败走 R-02 退路）'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: []
blocks: []
requirement_ids: []
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/package.json
  - frontend/pnpm-lock.yaml
goal: >
  在 frontend 引入 docx-preview（npm 正常源）与 xlsx（SheetJS 官方源 0.20.3 tarball，
  规避 npm 0.18.5 已知漏洞），实测安装可复现，为 docx 与 xlsx 渲染器提供依赖基础。
implementation:
  - 在 frontend 目录执行 pnpm add docx-preview（npm 正常源）
  - 在 frontend 目录执行 pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz 固定官方源 0.20.3，并核对 pnpm-lock.yaml 将其解析为该 tarball 地址
  - 若 cdn.sheetjs.com 不可达或安装失败，停止任务并按 R-02 三级退路回报（vendor 进仓、构建机代理、换 exceljs）
acceptance:
  - 本机 pnpm 安装成功且可复现，package.json 新增 docx-preview 与 xlsx 两项依赖
  - xlsx 固定为官方源 0.20.3 tarball，未引入 npm 0.18.5
  - pnpm exec tsc --noEmit 不因新依赖报错（既有无关报错不计）
verify:
  - cd frontend && pnpm install
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只改依赖清单两文件，不写任何业务代码
  - 禁止改用 npm 源 xlsx 0.18.5（CVE-2023-30533 与 CVE-2024-22363），安装失败不擅自换库换源
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
