---
id: task-07
title: 'Wave2 拆分 router.py → router/ 9 文件包（挂载顺序不变量 + 同形状路由保序对）'
title_zh: 'Wave2 拆分 router.py → router/ 9 文件包（挂载顺序不变量 + 同形状路由保序对）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/router/__init__.py
  - backend/app/modules/daemon/router/version.py
  - backend/app/modules/daemon/router/heartbeat.py
  - backend/app/modules/daemon/router/runtimes.py
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/router/lease.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/router/session_queue.py
  - backend/app/modules/daemon/router/session_insights.py
  - backend/app/modules/daemon/router/session_team.py
  - backend/app/modules/daemon/router/notify.py
  - backend/app/modules/daemon/router/gateway_misc.py
  - backend/app/modules/daemon/router/daemon_rpc.py
goal: >
  把 5468 行的 daemon/router.py（83 端点 + 39 内联 Pydantic 模型 + 21 私有 helper）拆为
  router/ 9 文件包，导入路径 app.modules.daemon.router 原样工作，挂载顺序不变量与
  同形状路由相对序零变化，openapi 零 diff。
implementation:
  - __init__.py 建共享 router = APIRouter(prefix="/daemon", tags=["daemon"])，先 include change_write/audit/grants/group_chat 四子路由（对应原 router.py 469-499 行，刻意先于端点注册），再 import 端点子模块触发注册
  - 端点按域搬移——version 2 / heartbeat 1 / runtimes 11 / machines 9 / lease 9 / session_crud 12 / session_extras 14 / notify_misc 约 25（含 /ws websocket 1）个端点，39 个内联 Pydantic 模型与 21 个私有 helper 随所在端点域同迁
  - 同形状路由保序对落同一子模块并保持相对序——session_crud.py 内 /sessions/events 先于 /sessions/{session_id}；runtimes.py 内 /runtimes/usage 与 /runtimes/page 先于 /runtimes/{runtime_id}
  - 被 patch 符号（router.get_redis 等 10 处目标，以 task-06 白名单为准）在子模块经 import app.modules.daemon.router 原包命名空间延迟解析，禁止 from 原点 import 后直接调用
  - 删除原 router.py，包 __init__.py 即兼容层，对外导入语句零改动
acceptance:
  - 既有 from app.modules.daemon.router import router 等全部导入语句原样工作
  - FastAPI 路由表与拆前逐条一致——路径/方法/端点函数名/注册顺序零差异，四子路由仍先于 83 端点注册
  - 两条同形状保序对注册顺序保持（/sessions/events 先于 /sessions/{session_id}、/runtimes/usage 与 /runtimes/page 先于 /runtimes/{runtime_id}）
  - 10 处 patch("app.modules.daemon.router.<sym>") 目标零失效，既有测试文件内容零修改通过
  - 9 个子模块全部 ≤800 行（D-005@v3）
verify:
  - cd backend && uv run ruff check app/modules/daemon/router
  - cd backend && uv run pytest app/modules/daemon/tests -q -k "router or ws or heartbeat or sessions_events" --no-cov -n auto
  - cd backend && uv run python scripts/dump_openapi.py && git diff --exit-code openapi.json
constraints:
  - 端点行为与响应模型零变化——路径/方法/状态码/Pydantic 模型字段原样搬移，OpenAPI schema 零差异
  - 四子路由必须先于全部端点注册（挂载顺序不变量），端点注册顺序与拆前一致
  - patch 目标零失效（按 task-06 白名单）——被白名单符号一律经原包命名空间延迟解析
  - 不碰在途 4 个 backend 文件（protocol.py / runtime/service.py / ws_hub.py / lease/context.py），git diff 为空
  - 既有测试零修改——若需改测试才能通过，判定兼容层设计失败回炉，禁止改测试迁就
  - 每搬完一个端点域跑定向测试全绿后再搬下一域
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
