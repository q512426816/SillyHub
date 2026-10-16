---
id: task-10
title: '服务器部署实测（内存回落/轮询请求率/列表耗时/idle-in-transaction 四指标）'
title_zh: '服务器部署实测（内存回落/轮询请求率/列表耗时/idle-in-transaction 四指标）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-16-backend-mem-polling/
  - docs/releases/
target_files:
  - .sillyspec/changes/2026-10-16-backend-mem-polling/verify-result.md
  - NEW:docs/releases/2026-10-16-deploy-backend-mem-polling.md
goal: >
  本地打包部署到阿里云服务器，实测四指标收口（内存回落/轮询降载/列表毫秒级/idle-in-transaction 归零）——全变更的最终实证。
implementation:
  - 部署前征得用户确认窗口；按 .zcode/skills/deploy-to-server/SKILL.md 流程：pnpm -C sillyhub-daemon bundle → deploy/scripts/build-and-save.sh（PROD_API_URL 按服务器 .env）→ scp → 服务器先备份 tag 再 load-and-up.sh
  - 部署验证：compose ps 五容器 healthy / /api/health ok / daemon 分发端点公网与后端一致
  - 四指标实测（结果写入 verify-result.md 部署段）：①backend RSS 曲线——触发一次知识搜索后观察子进程退出与主进程 RSS 回落；②change-write 轮询请求率——docker logs 单位时间 pending-change-writes 计数对比部署前后；③curl -w 计时 GET /api/daemon/sessions?limit=500；④postgres 日计 idle-in-transaction FATAL 是否归零
  - 写发布记录 docs/releases/YYYY-MM-DD-<三位序号>-<HEAD短SHA>.md（按 skill 契约 8 字段）并同步服务器镜像目录 /tmp/sillyhub-repos/multi-agent-platform/docs/releases/
acceptance:
  - 五容器 healthy + health ok
  - 四指标达标：嵌入闲置后主进程 RSS 回落；轮询请求率降 ~75%；sessions 列表毫秒级；idle-in-transaction 无新增
  - 发布记录落盘并同步服务器
verify:
  - ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'docker ps --format "{{.Names}} {{.Status}}" | grep multi-agent; docker stats --no-stream multi-agent-platform-backend-1'
  - 服务器 docker logs 采样计数留证进 verify-result.md
constraints:
  - 部署窗口须用户确认；失败按 backup-<时间> tag 回滚（skill 回滚节）
  - 不动服务器 ppdmq-* 容器；宿主 nginx 配置不碰
  - 生产数据可重置但默认只做滚动部署不清库
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
