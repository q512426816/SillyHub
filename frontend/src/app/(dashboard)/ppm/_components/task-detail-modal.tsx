"use client";

/**
 * TaskDetailModal — 任务详情 + 执行记录 + 跨天填报 公共弹窗。
 *
 * 抽自 task-plans/page.tsx (变更 2026-07-20-workbench-task-modal-align D-001)，
 * 任务计划页与个人工作台「我的任务」共用，单一真实源消除两处分叉。
 *
 * mode:
 *  - detail : 只读任务信息 + 执行记录表
 *  - execute: 进行中任务额外展开跨天填报区(提交回未开始 / 完成)
 *
 * 数据自管: task 变化 → listTaskExecutes 拉 100 条 → 预填 in-flight(status=30) +
 * 跨天拆分(actual_start~today 按天); 提交 → executePlanTask 跨天逐天收口 →
 * onChanged 回调外层刷新。跨天逻辑逐字复刻 task-plans handleDetailExecute(D-006)。
 *
 * task=null 时不渲染(由调用方控制开关)。
 */
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Button, Modal, Tag } from "antd";

import { ApiError } from "@/lib/api";
import { isOverEstimate } from "@/lib/ppm/format";
import {
  executePlanTask,
  listTaskExecutes,
  startPlanTask,
} from "@/lib/ppm/task";
import type { PlanTask, TaskExecute } from "@/lib/ppm/types";
import { fmtDay, inputCls, taskStatusTag, Toast, useToast } from "../shared";

export type TaskDetailMode = "detail" | "execute";

export interface TaskDetailModalProps {
  /** 当前查看的任务；null 表示关闭（不渲染）。 */
  task: PlanTask | null;
  /** detail=只读任务信息+执行记录表；execute=进行中任务额外展开跨天填报区。 */
  mode: TaskDetailMode;
  /** 关闭回调。 */
  onClose: () => void;
  /** 执行提交成功后回调，外层据此刷新列表/summary。 */
  onChanged?: () => void;
}

/** 跨天拆分的一行填报(日期/耗时/说明)。 */
interface DetailDay {
  date: string;
  timeSpent: string;
  execInfo: string;
}

export function TaskDetailModal({
  task,
  mode,
  onClose,
  onChanged,
}: TaskDetailModalProps) {
  const [records, setRecords] = useState<TaskExecute[]>([]);
  const [inflightId, setInflightId] = useState<string | null>(null);
  const [detailDays, setDetailDays] = useState<DetailDay[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  // task 变化 → 拉执行记录 + 预填 in-flight + 跨天拆分(复刻 task-plans handleOpenDetail)
  useEffect(() => {
    if (!task) {
      setRecords([]);
      setInflightId(null);
      setDetailDays([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const page = await listTaskExecutes({
          plan_task_id: task.id,
          page: 1,
          page_size: 100,
        });
        if (cancelled) return;
        const items = page.items ?? [];
        setRecords(items);
        const inflight = items.find((e) => e.status === "30");
        if (inflight && inflight.actual_start_time) {
          setInflightId(inflight.id);
          const startDay = dayjs(inflight.actual_start_time).startOf("day");
          const today = dayjs().startOf("day");
          const days: DetailDay[] = [];
          let cur = startDay;
          let i = 0;
          while (cur.isBefore(today) || cur.isSame(today, "day")) {
            days.push({
              date: cur.format("YYYY-MM-DD"),
              timeSpent:
                i === 0 && inflight.time_spent != null
                  ? String(inflight.time_spent)
                  : "",
              execInfo: i === 0 ? inflight.execute_info ?? "" : "",
            });
            cur = cur.add(1, "day");
            i += 1;
            if (i > 60) break; // 兜底防死循环
          }
          setDetailDays(days);
        } else {
          setInflightId(null);
          setDetailDays([]);
        }
      } catch (err) {
        if (!cancelled) {
          showToast(false, err instanceof ApiError ? err.message : "加载执行记录失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // showToast 来自 useToast 闭包，不作为依赖(避免反复触发拉取)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  // 跨天提交(逐字复刻 task-plans handleDetailExecute: 首条收口 in-flight; 后续天 start+execute;
  // 中间天 submit 回未开始, 末天用 action)
  const handleSubmit = async (action: "submit" | "complete") => {
    if (!task || !inflightId || detailDays.length === 0) {
      showToast(false, "无进行中的执行记录");
      return;
    }
    // 必填校验：跨天填报每天的「耗时」+「执行情况」都必填（2026-07-20 用户要求）
    for (let i = 0; i < detailDays.length; i++) {
      const d = detailDays[i];
      if (!d) continue;
      const dayLabel = detailDays.length > 1 ? `第 ${i + 1} 天（${d.date}）` : d.date;
      const ts = Number(d.timeSpent);
      if (!(d.timeSpent ?? "").trim() || Number.isNaN(ts)) {
        showToast(false, `${dayLabel} 的耗时未填写`);
        return;
      }
      if (!(d.execInfo ?? "").trim()) {
        showToast(false, `${dayLabel} 的执行情况未填写`);
        return;
      }
    }
    setBusy(true);
    try {
      const inflightRec = records.find((e) => e.id === inflightId);
      let lastExcId = inflightId;
      for (let i = 0; i < detailDays.length; i++) {
        const d = detailDays[i];
        if (!d) continue;
        const isLast = i === detailDays.length - 1;
        const ts = d.timeSpent ? Number(d.timeSpent) : undefined;
        const dayIso = `${d.date}T12:00:00Z`;
        // 首条 execute 的 end 用 in-flight 的 start(同时刻, 确保 UTC date 一致); 后续天用 dayIso
        const endIso = i === 0 ? inflightRec?.actual_start_time ?? dayIso : dayIso;
        if (i > 0) {
          // 后续天: start 创建新 in-flight(记当天 UTC 中午)
          const newExc = await startPlanTask({
            plan_task_id: task.id,
            actual_start_time: dayIso,
          });
          lastExcId = newExc.id;
        }
        await executePlanTask({
          plan_task_id: task.id,
          action: isLast ? action : "submit",
          task_execute_id: lastExcId,
          execute_info: d.execInfo || undefined,
          time_spent: ts !== undefined && !Number.isNaN(ts) ? ts : undefined,
          actual_end_time: endIso,
        });
      }
      showToast(true, action === "complete" ? "任务已完成" : "执行已保存");
      onChanged?.();
      onClose();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "执行失败");
    } finally {
      setBusy(false);
    }
  };

  if (!task) return null;

  const showForm =
    mode === "execute" && task.status === "进行中" && !!inflightId;

  return (
    <Modal
      open
      title={
        <div className="flex items-center gap-2">
          <span>详情</span>
          <Tag color={taskStatusTag(task.status).color}>
            {taskStatusTag(task.status).text}
          </Tag>
          <span className="text-sm font-normal text-muted-foreground">
            {task.content ?? ""}
          </span>
        </div>
      }
      onCancel={onClose}
      footer={null}
      width={760}
    >
      {/* 任务信息 */}
      <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
        <div className="mb-3 text-xs font-semibold text-foreground/70">任务信息</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="col-span-2"><span className="text-muted-foreground">任务内容：</span>{task.content ?? "—"}</div>
          {task.task_description ? (
            <div className="col-span-2"><span className="text-muted-foreground">任务描述：</span>{task.task_description}</div>
          ) : null}
          <div><span className="text-muted-foreground">项目：</span>{task.project_name ?? "—"}</div>
          <div><span className="text-muted-foreground">模块：</span>{task.module_name ?? "—"}</div>
          <div><span className="text-muted-foreground">预估工时：</span>{task.work_load ?? "—"}</div>
          <div>
            <span className="text-muted-foreground">已消耗：</span>
            {task.spent_time != null && task.spent_time > 0 ? (
              <span
                className={
                  isOverEstimate(task.spent_time, task.work_load)
                    ? "font-medium text-red-600"
                    : "font-medium text-emerald-600"
                }
              >
                {task.spent_time} 人天
              </span>
            ) : (
              "—"
            )}
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">计划时间：</span>
            {task.start_time ? fmtDay(task.start_time) : "—"} ~{" "}
            {task.end_time ? fmtDay(task.end_time) : "—"}
          </div>
          <div><span className="text-muted-foreground">负责人：</span>{task.user_name ?? "—"}</div>
          <div><span className="text-muted-foreground">配合人员：</span>{task.work_partner ?? "—"}</div>
          {task.remarks ? (
            <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{task.remarks}</div>
          ) : null}
        </div>
      </div>

      {/* 执行记录(时间精确到秒) */}
      <div className="mb-2 text-xs font-semibold text-foreground/70">
        执行记录（{records.length}）
      </div>
      {records.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          暂无执行记录
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">开始时间</th>
                <th className="px-3 py-2 font-medium">结束时间</th>
                <th className="px-3 py-2 font-medium">耗时</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {records.map((e) => (
                <tr key={e.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    {e.actual_start_time
                      ? dayjs(e.actual_start_time).format("YYYY-MM-DD HH:mm:ss")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {e.actual_end_time
                      ? dayjs(e.actual_end_time).format("YYYY-MM-DD HH:mm:ss")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{e.time_spent != null ? `${e.time_spent}人天` : "—"}</td>
                  <td className="px-3 py-2">{e.execute_info ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 填报区(execute 模式 + 进行中 + 有 in-flight 记录) */}
      {showForm && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="mb-3 text-xs font-semibold text-foreground/70">
            填报执行
            {detailDays.length > 1
              ? `（跨 ${detailDays.length} 天，已自动按天拆分，逐天填写耗时与说明）`
              : ""}
          </div>
          {detailDays.map((d, idx) => (
            <div key={d.date} className="mb-3 space-y-2 rounded-md border border-border bg-muted/20 p-3 last:mb-0">
              <div className="text-[11px] font-medium">{d.date}</div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  耗时(人天) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="耗时(人天)"
                  value={d.timeSpent}
                  onChange={(e) =>
                    setDetailDays((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, timeSpent: e.target.value } : x,
                      ),
                    )
                  }
                  className={`w-40 ${inputCls}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  执行情况说明 <span className="text-red-500">*</span>
                </label>
                <input
                  placeholder="执行情况说明"
                  value={d.execInfo}
                  onChange={(e) =>
                    setDetailDays((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, execInfo: e.target.value } : x,
                      ),
                    )
                  }
                  className={`w-full ${inputCls}`}
                />
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => void handleSubmit("submit")}
            >
              提交(回未开始)
            </Button>
            <Button type="primary" disabled={busy} onClick={() => void handleSubmit("complete")}>
              完成
            </Button>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </Modal>
  );
}
