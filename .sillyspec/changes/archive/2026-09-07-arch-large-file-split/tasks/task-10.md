---
id: task-10
title: 'Wave2 拆分 run_sync/service.py → run_sync/service/ 9 文件包'
title_zh: 'Wave2 拆分 run_sync/service.py → run_sync/service/ 9 文件包'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3, D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/run_sync/service/__init__.py
  - backend/app/modules/daemon/run_sync/service/sdk_pipeline.py
  - backend/app/modules/daemon/run_sync/service/group_bridge.py
  - backend/app/modules/daemon/run_sync/service/gate.py
  - backend/app/modules/daemon/run_sync/service/stage_team.py
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
  - backend/app/modules/daemon/run_sync/service/submit_commit.py
  - backend/app/modules/daemon/run_sync/service/close_run_steps.py
  - backend/app/modules/daemon/run_sync/service/publish.py
goal: >
  把 4055 行的 run_sync/service.py 拆为 run_sync/service/ 9 文件包，submit_messages
  872 行与 close_interactive_run 603 行各拆分步函数，对 session.service 私有符号的既有
  导入不改语义，45 处 patch 目标零失效，既有测试零修改通过。
implementation:
  - sdk_pipeline.py 先落 _extract_sdk_messages/_persist_agent_event/_channel_from_event_type 模块级管线（纯搬移），group_bridge.py（桥接/投影簇）与 gate.py（gate 决策簇）随后
  - submit_messages 872 行拆分步函数——解析/派发/override 段落 submit_steps.py，分段撤销/持久化/发布段落 submit_commit.py
  - close_interactive_run 603 行拆分步函数落 close_run_steps.py，stage_team.py（stage/team 推进簇）与 publish.py（publish_* 模块级函数 + stamp 闭包去重）随后
  - RunSyncService 类壳在 __init__.py 保留同名方法一行委托，公共签名不变；聚合导出 ⊇ task-06 清单符号集
  - 保持原 service.py 47 行对 session.service 私有符号 _apply_session_terminal_status/_send_session_end_best_effort 的导入语句原样（改由 session/service/ 包 __init__ 聚合导出提供，语义不变）
  - 45 处 run_sync.service patch 白名单符号（以 task-06 白名单为准）在子模块经原模块命名空间延迟解析
acceptance:
  - from app.modules.daemon.run_sync.service import RunSyncService 等既有导入原样工作
  - 对 session.service 私有符号的两条导入语句原样保留且语义不变
  - 45 处 patch("app.modules.daemon.run_sync.service.<sym>") 目标零失效，test_run_sync_*/test_submit_*/test_close_* 既有测试文件内容零修改通过
  - RunSyncService 公共方法签名逐一不变，方法体只做搬移 + this 状态显式传参
  - 9 个子模块全部 ≤800 行（D-005@v3）
verify:
  - cd backend && uv run ruff check app/modules/daemon/run_sync
  - cd backend && uv run pytest app/modules/daemon/tests -q -k "run_sync or submit or close" --no-cov -n auto
constraints:
  - 不改方法行为/异常文案/日志格式——方法体下沉只做搬移 + this 状态显式传参
  - patch 目标零失效（按 task-06 白名单）——被白名单符号禁止 from 原点 import 后调用，一律经原模块命名空间延迟解析
  - 既有测试零修改——需改测试才能通过即判定兼容层设计失败，回炉而非改测试
  - 不碰在途 4 个 backend 文件（protocol.py / runtime/service.py / ws_hub.py / lease/context.py），git diff 为空
  - 每搬一簇跑定向测试全绿再搬下一簇，不为行数目标顺手改逻辑
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
