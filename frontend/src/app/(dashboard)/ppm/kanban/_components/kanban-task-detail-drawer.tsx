"use client";

/**
 * KanbanTaskDetailDrawer — 任务详情抽屉(只读为主 + 评论/子任务交互)。
 *
 * 重排版(2026-07-21 ql-006,易读优化):
 *  - 头部:状态 Tag + 逾期红标(priority=1);
 *  - 任务标题大字突出;
 *  - 任务描述独立卡片块(优先 task_description,fallback 从 content 拆);
 *  - 基本信息双列网格(项目/负责人/截止/预估工时/模块?/配合人员?);
 *  - 进度条 + 有备注才显;
 *  - Tabs:子任务/评论/附件。
 *
 * 数据:TaskCardVO 现暴露 task_description/module_name/work_partner/remarks。
 * 「修改负责人」入口已移除(改负责人走拖拽 + AssignTaskDialog)。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Drawer, Input, Progress, Spin, Tabs, Tag, message } from "antd";

import { PpmFileUrls } from "@/components/ppm-file-urls";
import { ApiError } from "@/lib/api";
import {
  addKanbanComment,
  listKanbanComments,
  listKanbanSubtasks,
  toggleKanbanSubtask,
} from "@/lib/ppm/kanban";
import type { KanbanComment, KanbanSubtask, KanbanTaskCard } from "@/lib/ppm/types";
import { fmtDay } from "../../shared";

function statusTagOf(status: string | null): { text: string; color: string } {
  switch (status) {
    case "未开始":
      return { text: "未开始", color: "default" };
    case "进行中":
      return { text: "进行中", color: "processing" };
    case "已完成":
      return { text: "已完成", color: "success" };
    default:
      return { text: status ?? "—", color: "default" };
  }
}

/** 把 content 拆成 title 首段 + 描述剩余行(看板新建任务沿用 title\n\ndesc 合并语义)。 */
function splitContent(content: string | null): { title: string; desc: string } {
  if (!content) return { title: "", desc: "" };
  const idx = content.indexOf("\n\n");
  if (idx < 0) return { title: content, desc: "" };
  return { title: content.slice(0, idx), desc: content.slice(idx + 2) };
}

export function KanbanTaskDetailDrawer({
  task,
  onClose,
}: {
  task: KanbanTaskCard | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<KanbanComment[]>([]);
  const [subtasks, setSubtasks] = useState<KanbanSubtask[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [activeTab, setActiveTab] = useState("subtasks");

  const taskId = task?.id ?? null;

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [cs, ss] = await Promise.all([
        listKanbanComments(id),
        listKanbanSubtasks(id),
      ]);
      setComments(cs);
      setSubtasks(ss);
    } catch (err) {
      setComments([]);
      setSubtasks([]);
      void message.error(
        err instanceof ApiError ? err.message : "加载详情失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!task) return;
    setCommentDraft("");
    setActiveTab("subtasks");
    void loadDetail(task.id);
  }, [task, loadDetail]);

  const onToggleSubtask = async (subtaskId: string) => {
    if (!taskId) return;
    const prev = subtasks;
    setSubtasks((cur) =>
      cur.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s)),
    );
    try {
      const updated = await toggleKanbanSubtask(taskId, subtaskId);
      setSubtasks((cur) => cur.map((s) => (s.id === subtaskId ? updated : s)));
    } catch (err) {
      setSubtasks(prev);
      void message.error(
        err instanceof ApiError ? err.message : "勾选失败",
      );
    }
  };

  const onAddComment = async () => {
    if (!taskId) return;
    const content = commentDraft.trim();
    if (!content) {
      void message.warning("评论内容不能为空");
      return;
    }
    try {
      const created = await addKanbanComment(taskId, { content });
      setComments((cur) => [...cur, created]);
      setCommentDraft("");
    } catch (err) {
      void message.error(
        err instanceof ApiError ? err.message : "评论失败",
      );
    }
  };

  if (!task) {
    return (
      <Drawer
        title="任务详情"
        placement="right"
        width={600}
        open={false}
        onClose={onClose}
      />
    );
  }

  const { title, desc } = splitContent(task.title);
  // 任务描述:优先独立字段 task_description(里程碑明细来源),fallback 看 content 合并的描述(看板新建来源)
  const description = task.task_description ?? desc;
  const tag = statusTagOf(task.status);
  const overdue = task.priority === 1;

  return (
    <Drawer
      title="任务详情"
      placement="right"
      width={600}
      open={task !== null}
      onClose={onClose}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {/* 头部:状态 + 逾期标记 */}
        <div className="mb-3 flex items-center gap-2">
          <Tag color={tag.color}>{tag.text}</Tag>
          {overdue && <Tag color="red">已逾期</Tag>}
        </div>

        {/* 任务标题 */}
        <h3 className="mb-4 text-lg font-semibold leading-snug text-foreground">
          {title || "(未命名任务)"}
        </h3>

        {/* 任务描述 */}
        <SectionLabel>任务描述</SectionLabel>
        <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
          {description ? (
            <span className="whitespace-pre-wrap break-words text-foreground">
              {description}
            </span>
          ) : (
            <span className="text-muted-foreground">暂无描述</span>
          )}
        </div>

        {/* 基本信息双列网格 */}
        <SectionLabel>基本信息</SectionLabel>
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-border bg-muted/10 p-3">
          <InfoItem label="所属项目" value={task.project_name ?? "—"} />
          <InfoItem label="负责人" value={task.user_name ?? "未分配"} />
          <InfoItem
            label="截止日期"
            value={task.deadline ? fmtDay(task.deadline) : "—"}
          />
          <InfoItem
            label="预估工时"
            value={`${task.estimate_hours ?? "—"} 人天`}
          />
          {task.module_name && (
            <InfoItem label="所属模块" value={task.module_name} />
          )}
          {task.work_partner && (
            <InfoItem label="配合人员" value={task.work_partner} />
          )}
        </div>

        {/* 进度 */}
        <SectionLabel>进度</SectionLabel>
        <div className="mb-4 px-1">
          <Progress percent={task.progress ?? 0} size="small" />
        </div>

        {/* 备注(有才显) */}
        {task.remarks && (
          <>
            <SectionLabel>备注</SectionLabel>
            <div className="mb-4 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-3 text-sm text-foreground">
              {task.remarks}
            </div>
          </>
        )}

        {/* Tabs:子任务 / 评论 / 附件 */}
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: "subtasks",
              label: "子任务",
              children: (
                <div className="min-h-48">
                  {subtasks.length === 0 ? (
                    <EmptyHint text="暂无子任务" />
                  ) : (
                    <ul className="space-y-2">
                      {subtasks.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center gap-2 rounded bg-muted/20 px-3 py-2"
                        >
                          <Checkbox
                            checked={s.done}
                            onChange={() => void onToggleSubtask(s.id)}
                          />
                          <span className={s.done ? "text-muted-foreground line-through" : ""}>
                            {s.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ),
            },
            {
              key: "comments",
              label: "评论",
              children: (
                <div className="min-h-48">
                  {comments.length === 0 ? (
                    <EmptyHint text="暂无评论" />
                  ) : (
                    <ul className="mb-4 max-h-96 space-y-2 overflow-y-auto">
                      {comments.map((c) => (
                        <li
                          key={c.id}
                          className="rounded border border-border bg-muted/20 px-3 py-2"
                        >
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>{c.user_name ?? c.user_id}</span>
                            <span>{fmtDay(c.created_at)}</span>
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words text-sm">
                            {c.content}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="space-y-2 border-t border-border pt-3">
                    <Input.TextArea
                      value={commentDraft}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      maxLength={500}
                      showCount
                      placeholder="添加评论..."
                      onChange={(e) => setCommentDraft(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="primary"
                        size="small"
                        disabled={!commentDraft.trim()}
                        onClick={() => void onAddComment()}
                      >
                        发表评论
                      </Button>
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: "attachments",
              label: "附件",
              children: (
                <div className="min-h-48">
                  {(task.file_urls?.length ?? 0) === 0 ? (
                    <EmptyHint text="暂无附件" />
                  ) : (
                    <PpmFileUrls value={task.file_urls ?? []} onChange={() => {}} disabled />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Spin>
    </Drawer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-xs text-muted-foreground">{text}</div>
  );
}

export default KanbanTaskDetailDrawer;
