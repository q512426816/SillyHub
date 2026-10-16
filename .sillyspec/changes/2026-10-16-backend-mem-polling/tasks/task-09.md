---
id: task-09
title: 'compose 配额重分配（1.85G）+oom_score_adj+entrypoint 兜底+部署文档 swappiness'
title_zh: 'compose 配额重分配（1.85G）+oom_score_adj+entrypoint 兜底+部署文档 swappiness'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-10]
decision_ids: [D-001@v1]
allowed_paths:
  - deploy/docker-compose.yml
  - backend/docker-entrypoint.sh
  - .zcode/skills/deploy-to-server/SKILL.md
target_files:
  - deploy/docker-compose.yml
  - backend/docker-entrypoint.sh
  - .zcode/skills/deploy-to-server/SKILL.md
goal: >
  容器内存配额去超卖（2.14G→1.85G）+ backend 主进程 OOM 保护 + 部署文档补系统调优建议。
implementation:
  - 改 deploy/docker-compose.yml：frontend mem_limit 400m→300m、minio 256m→128m、redis 128m→64m（backend 1100m / postgres 256m 不动）+ backend 服务加 oom_score_adj: -500
  - 改 backend/docker-entrypoint.sh：exec uvicorn 前 try-best 写 /proc/self/oom_score_adj=-500（失败告警不阻塞——compose 服务级设置为主路径）
  - 改 .zcode/skills/deploy-to-server/SKILL.md 常见坑：补 vm.swappiness=10 sysctl 建议（服务器手动操作不入库）
acceptance:
  - docker compose config 渲染通过，mem_limit 五值合计 1848m、backend oom_score_adj=-500
  - entrypoint 兜底写失败不阻塞启动（语法/逻辑审查 + bash -n）
verify:
  - docker compose -f deploy/docker-compose.yml config 2>&1 | grep -E "mem_limit|oom_score_adj" || python -c "import yaml;d=yaml.safe_load(open('deploy/docker-compose.yml'));print({k:v.get('mem_limit') for k,v in d['services'].items()})"
  - bash -n backend/docker-entrypoint.sh
constraints:
  - 不改端口/卷/镜像/挂载
  - 服务器上 ppdmq-* 容器不碰（部署纪律）
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
