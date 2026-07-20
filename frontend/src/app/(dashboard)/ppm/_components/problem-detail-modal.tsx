"use client";

/**
 * ProblemDetailModal — 问题清单详情 + 执行记录 + 跨天填报 公共弹窗。
 *
 * 仿 task-detail-modal.tsx (变更 2026-07-20-problem-list-align-task-plan D-006
 * 方案 B),与任务计划执行模式完全一致:
 *  - mode=detail : 只读问题信息 + 执行记录表
 *  - mode=execute: 进行中问题额外展开跨天填报区(提交回新建 / 完成)
 *
 * 数据自管: problem 变化 → listTaskExecutes({problem_task_id}) 拉 100 条 →
 * 预填 in-flight(status="30") + 跨天拆分(actual_start~today 按天); 提交 →
 * executeProblem 跨天逐天收口 (首条收口 in-flight; 后续天 startProblem+execute;
 * 中间天 submit 回新建, 末天用 action) → onChanged 回调外层刷新。
 * 跨天逻辑逐字复刻 task-detail-modal handleSubmit。
 *
 * TaskExecute 表 plan/problem 共用 (plan_task_id / problem_task_id 互斥),
 * 此处仅按 problem_task_id 查询 (D-002)。
 *
 * problem=null 时不渲染(由调用方控制开关)。
 */
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Modal, Tag } from "antd";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { isOverEstimate } from "@/lib/ppm/format";
import { executeProblem, startProblem } from "@/lib/ppm/problem";
import { listTaskExecutes } from "@/lib/ppm/task";
import type { ProblemList, TaskExecute } from "@/lib/ppm/types";
import { fmtDay, inputCls, Toast, useToast } from "../shared";
import {
  PROBLEM_STATUS_COLOR,
  PROBLEM_STATUS_TEXT,
  PROBLEM_TYPE_TEXT,
} from "@/components/ppm-status-actions";

export type ProblemDetailMode = "detail" | "execute";

export interface ProblemDetailModalProps {
  /** 当前查看的问题；null 表示关闭（不渲染）。 */
  problem: ProblemList | null;
  /** detail=只读问题信息+执行记录表；execute=进行中问题额外展开跨天填报区。 */
  mode: ProblemDetailMode;
  /** 关闭回调。 */
  onClose: () => void;
  /** 执行提交成功后回调，外层据此刷新列表。 */
  onChanged?: () => void;
}

/** 跨天拆分的一行填报(日期/耗时/说明)。 */
export interface DetailDay {
  date: string;
  timeSpent: string;
  execInfo: string;
}

/** buildDetailDays 的输入(in-flight 执行记录的子集)。 */
export interface InflightLike {
  actual_start_time: string | null;
  time_spent: number | null;
  execute_info: string | null;
}

/**
 * 按 in-flight 执行记录的 actual_start_time ~ 今天 跨天拆分填报行 (复刻
 * task-detail-modal)。首条预填 inflight 的 time_spent/execute_info; 后续天空白。
 *
 * - inflight 为 null / actual_start_time 为 null → 返回 [] (无有效 in-flight)
 * - 超过 60 天 → 截断到 60 条 (兜底防死循环)
 * - today 可注入 (默认 dayjs().startOf("day")) 便于单测固定时间。
 */
export function buildDetailDays(
  inflight: InflightLike | null,
  today: dayjs.Dayjs = dayjs().startOf("day"),
): DetailDay[] {
  if (!inflight || !inflight.actual_start_time) return [];
  const startDay = dayjs(inflight.actual_start_time).startOf("day");
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
    if (i > 60) break;
  }
  return days;
}

export function ProblemDetailModal({
  problem,
  mode,
  onClose,
  onChanged,
}: ProblemDetailModalProps) {
  const [records, setRecords] = useState<TaskExecute[]>([]);
  const [inflightId, setInflightId] = useState<string | null>(null);
  const [detailDays, setDetailDays] = useState<DetailDay[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  // problem 变化 → 拉执行记录 + 预填 in-flight + 跨天拆分(复刻 task-detail-modal)
  useEffect(() => {
    if (!problem) {
      setRecords([]);
      setInflightId(null);
      setDetailDays([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const page = await listTaskExecutes({
          problem_task_id: problem.id,
          page: 1,
          page_size: 100,
        });
        if (cancelled) return;
        const items = page.items ?? [];
        setRecords(items);
        const inflight = items.find((e) => e.status === "30");
        if (inflight && inflight.actual_start_time) {
          setInflightId(inflight.id);
          setDetailDays(buildDetailDays(inflight));
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
    // showToast 来自 useToast 闭包,不作为依赖(避免反复触发拉取)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem]);

  // 跨天提交(逐字复刻 task-detail-modal handleSubmit: 首条收口 in-flight; 后续天
  // start+execute; 中间天 submit 回新建, 末天用 action)
  const handleSubmit = async (action: "submit" | "complete") => {
    if (!problem || !inflightId || detailDays.length === 0) {
      showToast(false, "无进行中的执行记录");
      return;
    }
    // 必填校验:跨天填报每天的「耗时」+「执行情况」都必填(对齐任务计划)
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
        // 首条 execute 的 end 用 in-flight 的 start(同时刻, 确保 UTC date 一致);
        // 后续天用 dayIso
        const endIso = i === 0 ? inflightRec?.actual_start_time ?? dayIso : dayIso;
        if (i > 0) {
          // 后续天: start 创建新 in-flight(记当天 UTC 中午)
          const newExc = await startProblem(problem.id, {
            actual_start_time: dayIso,
          });
          lastExcId = newExc.id;
        }
        await executeProblem(problem.id, {
          task_execute_id: lastExcId,
          action: isLast ? action : "submit",
          execute_info: d.execInfo || undefined,
          time_spent: ts !== undefined && !Number.isNaN(ts) ? ts : undefined,
          actual_end_time: endIso,
        });
      }
      showToast(true, action === "complete" ? "问题已完成" : "执行已保存");
      onChanged?.();
      onClose();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "执行失败");
    } finally {
      setBusy(false);
    }
  };

  if (!problem) return null;

  const showForm =
    mode === "execute" && problem.status === "进行中" && !!inflightId;

  return (
    <Modal
      open
      title={
        <div className="flex items-center gap-2">
          <span>问题详情</span>
          <Tag color={PROBLEM_STATUS_COLOR[problem.status] ?? "default"}>
            {PROBLEM_STATUS_TEXT[problem.status] ?? problem.status}
          </Tag>
          {problem.is_urgent === "1" || problem.is_urgent === "是" ? (
            <Tag color="red">急</Tag>
          ) : null}
          <span className="text-sm font-normal text-muted-foreground">
            {problem.pro_desc ?? ""}
          </span>
        </div>
      }
      onCancel={onClose}
      footer={null}
      width={760}
    >
      {/* 问题信息 */}
      <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
        <div className="mb-3 text-xs font-semibold text-foreground/70">问题信息</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div><span className="text-muted-foreground">项目：</span>{problem.project_name ?? "—"}</div>
          <div><span className="text-muted-foreground">模块：</span>{problem.model_name ?? "—"}</div>
          <div className="col-span-2">
            <span className="text-muted-foreground">问题描述：</span>{problem.pro_desc ?? "—"}
          </div>
          <div><span className="text-muted-foreground">功能名称：</span>{problem.func_name ?? "—"}</div>
          <div>
            <span className="text-muted-foreground">问题类型：</span>
            {problem.pro_type ? (
              <Tag>{PROBLEM_TYPE_TEXT[problem.pro_type] ?? problem.pro_type}</Tag>
            ) : (
              "—"
            )}
          </div>
          <div><span className="text-muted-foreground">发现人：</span>{problem.find_by ?? "—"}</div>
          <div>
            <span className="text-muted-foreground">发现时间：</span>
            {problem.find_time ? fmtDay(problem.find_time) : "—"}
          </div>
          <div><span className="text-muted-foreground">责任人：</span>{problem.duty_user_name ?? "—"}</div>
          <div><span className="text-muted-foreground">验证人：</span>{problem.audit_user_name ?? "—"}</div>
          <div className="col-span-2">
            <span className="text-muted-foreground">计划时间：</span>
            {problem.plan_start_time ? fmtDay(problem.plan_start_time) : "—"} ~{" "}
            {problem.plan_end_time ? fmtDay(problem.plan_end_time) : "—"}
          </div>
          <div><span className="text-muted-foreground">工作量：</span>{problem.work_load ?? "—"}</div>
          <div>
            <span className="text-muted-foreground">已消耗：</span>
            {problem.spent_time != null && problem.spent_time > 0 ? (
              <span
                className={
                  isOverEstimate(problem.spent_time, problem.work_load)
                    ? "font-medium text-red-600"
                    : "font-medium text-emerald-600"
                }
              >
                {problem.spent_time} 人天
              </span>
            ) : (
              "—"
            )}
          </div>
          {problem.remarks ? (
            <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{problem.remarks}</div>
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
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handleSubmit("submit")}
            >
              提交(回新建)
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void handleSubmit("complete")}>
              完成
            </Button>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </Modal>
  );
}
