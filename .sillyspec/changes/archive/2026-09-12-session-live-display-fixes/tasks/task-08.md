---
id: task-08
title: '部署验证（backend/frontend 镜像 + daemon bundle 分发 + 生产会话实测）'
title_zh: '部署验证（backend/frontend 镜像 + daemon bundle 分发 + 生产会话实测）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.4, FR-2.3, FR-3.1, FR-4.1, FR-5.1]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
depends_on: [task-07]
allowed_paths:
  - deploy/
target_files: []  # 部署任务：无仓内代码改动
goal: >
  integration-critical 集成证据：本地打包、部署阿里云、生产会话实测四项验收（直播无碎片/失败卡文案/切换轮计数/运行中计时），并确认 daemon bundle 分发版本更新。
implementation:
  - 按 deploy-to-server skill：sillyhub-daemon pnpm bundle；PROD_API_URL=https://crrcdt.ppdmq.top bash deploy/scripts/build-and-save.sh；scp + 服务器 load-and-up.sh（先备份旧镜像 tag）。
  - 部署后验证：compose ps 5 容器 healthy、/api/health ok、公网与后端 /daemon/latest.json 版本一致。
  - 生产实测（会话面板）：pi 引擎直播轮刷新前后渲染等价；失败卡显示「上游输出流中断」且无伪 code；切换供应商后轮次计数不增、时间线无空气泡；运行中轮 elapsed 随真实时长增长。
acceptance:
  - 部署健康检查全过；latest.json 公网/后端一致。
  - 四项生产实测逐项通过并留证（结果记录进 verify-result）。
verify:
  - ssh 部署验证命令组（见 deploy-to-server skill 第 4 步）
constraints:
  - 部署前先备份旧镜像（backup-<stamp> tag）。
  - 不动 ppdmq-* 容器；.sh 必须 LF。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
