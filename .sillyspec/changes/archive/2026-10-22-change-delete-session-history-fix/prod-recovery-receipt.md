# 生产数据修复回执 — task-07（2026-10-22）

会话：`bbdbecc9-abea-46a3-b0d9-81c22a582675`（消防设施台账6轮）
服务器：腾讯云轻量 124.222.127.242（compose 目录 /opt/sillyhub/deploy/deploy）

## 执行时序与证据

1. **备份**（回滚底线）
   `agent_runs.jsonl`=46 行 / `agent_run_logs.jsonl`=4464 行 / `agent_sessions.jsonl`=1 行
   → `/home/ubuntu/backup-cascade-fix-20261022/`（宿主机）。
2. **外键改写**（与迁移 20261022100000 同 SQL，手工先行；后续部署 `alembic upgrade head`
   重放本迁移为幂等 no-op——drop/create 同名约束同语义、对账 UPDATE 无新增虚高行）：
   ```sql
   ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_change_id_fkey;
   ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_change_id_fkey
     FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE SET NULL;
   -- 保守对账（同迁移 SQL）
   ```
   执行后 `pg_constraint`：`FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE SET NULL` ✅
   对账 `UPDATE 3`（3 个会话存在计数虚高被保守下调；全库此前排查仅 bbdbecc9 显著虚高 13）。
3. **回灌 dry-run**：`turns: 13 / runs_new: 13 / logs_new: 770`（571 段 + tool_use 双写
   stdout+tool_call 共 199 条）。
4. **回灌 apply**（单事务）：`runs_new: 13 / logs_new: 770 / turn_count_after: 59` ✅
   首跑曾因独立进程缺全量模型注册表 flush 失败（NoReferencedTableError），补齐
   `_MODEL_MODULES` 注册后成功；事务原子，失败无残留。
5. **幂等复跑**：`runs_new: 0 / logs_new: 0 / runs_existing: 13 / logs_existing: 770` ✅
6. **终态对账（SQL）**：
   ```text
    turn_count | runs | expected
   ------------+------+----------
           59 |   59 |       59
   ```
   `restored_runs=13，with_change=0`（回灌 run 的 change_id 全部 NULL，不再被任何
   change 删除波及）。

## 遗留

- turn-outline API 用管理员 token 访问返回 404（端点按会话属主隔离，属预期）；
  属主用户在 UI 打开会话即可看到 59 轮完整时间线。
- 新镜像（含 reparse 解绑代码与本迁移）待下一次常规部署带上；当前 DB 约束已
  在线生效，旧代码运行下根因同样被阻断。
- 服务器 `/tmp/recovered_turns_10_22.*`、`/tmp/restore_lost_session_turns.py`、
  宿主 `/home/ubuntu/backup-cascade-fix-20261022/` 保留作为恢复物证与回滚底。
