"use client";

/**
 * KanbanTaskDetailDrawer — 对齐源 `TaskDetailDrawer.vue`。
 *
 * 结构:
 *  - 基本信息(el-descriptions):标题/描述/状态/项目/负责人/截止/工时/创建/更新时间。
 *    本仓数据约束:title=PlanTask.content 首行;描述=content 剩余行;无独立
 *    createTime/updateTime 暴露给看板(KanbanTaskCard 未含),用 deadline/estimate_hours
 *    /status/project_name/user_name 替代展示。
 *  - Tabs:子任务(SubTaskVO list + toggle)/ 评论(CommentVO list + add)/ 附件(file_urls)。
 *  - 修改负责人:Drawer 内嵌 Modal,searchUsers → updateKanbanTask user 字段(本仓
 *    update 不支持改 user_id,故走 store.assignTask,与 AssignTaskDialog 一致)。
 *
 * 字段差异:源子任务 SubTaskVO 含 assigneeId/assigneeName;本仓 KanbanSubtask 无
 * assignee 字段,只展示 title + done 勾选 + toggle。源附件是独立 VO 列表;本仓用
 * PlanTask.file_urls 字符串数组(对齐 task-01 设计)。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Drawer, Input, Modal, Select, Spin, Tabs, Tag, message } from "antd";

import { PpmFileUrls } from "@/components/ppm-file-urls";
import { ApiError } from "@/lib/api";
import {
  addKanbanComment,
  listKanbanComments,
  listKanbanSubtasks,
  searchKanbanUsers,
  toggleKanbanSubtask,
} from "@/lib/ppm/kanban";
import { useKanbanStore } from "@/stores/kanban";
import type {
  KanbanComment,
  KanbanSubtask,
  KanbanTaskCard,
  KanbanUserColumn,
} from "@/lib/ppm/types";
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

/** 把 content 拆成 title 首行 + 描述剩余行(对齐 create dialog 合并写入语义)。 */
function splitContent(content: string | null): { title: string; desc: string } {
  if (!content) return { title: "", desc: "" };
  const idx = content.indexOf("\n\n");
  if (idx < 0) return { title: content, desc: "" };
  return { title: content.slice(0, idx), desc: content.slice(idx + 2) };
}

export function KanbanTaskDetailDrawer({
  task,
  onClose,
  onTaskUpdated,
}: {
  task: KanbanTaskCard | null;
  onClose: () => void;
  onTaskUpdated?: (task: KanbanTaskCard) => void;
}) {
  const assignTask = useKanbanStore((s) => s.assignTask);
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);

  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<KanbanComment[]>([]);
  const [subtasks, setSubtasks] = useState<KanbanSubtask[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [activeTab, setActiveTab] = useState("subtasks");

  // 修改负责人内嵌 Modal
  const [assigneeModalOpen, setAssigneeModalOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [userResults, setUserResults] = useState<KanbanUserColumn[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigning, setAssigning] = useState(false);

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

  // 修改负责人(对齐源 showAssigneeDialog + handleUpdateAssignee)
  const openAssigneeModal = () => {
    setAssigneeId(task?.user_id ?? undefined);
    setAssigneeModalOpen(true);
    void runUserSearch("");
  };

  const runUserSearch = async (kw: string) => {
    setSearching(true);
    try {
      const list = await searchKanbanUsers(kw.trim());
      setUserResults(list ?? []);
    } catch {
      setUserResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleUpdateAssignee = async () => {
    if (!task || !assigneeId) return;
    setAssigning(true);
    try {
      await assignTask({ task_id: task.id, assignee_id: assigneeId });
      await fetchTasks();
      void message.success("负责人修改成功");
      setAssigneeModalOpen(false);
      onTaskUpdated?.({ ...task, user_id: assigneeId });
    } catch (err) {
      void message.error(
        err instanceof ApiError ? err.message : "修改负责人失败",
      );
    } finally {
      setAssigning(false);
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
  const tag = statusTagOf(task.status);

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
        {/* 基本信息 */}
        <section className="mb-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="m-0 text-base font-semibold text-foreground">基本信息</h3>
            <Button size="small" type="primary" onClick={openAssigneeModal}>
              修改负责人
            </Button>
          </div>
          <div className="space-y-1.5 rounded border border-border bg-muted/20 p-3 text-sm">
            <Row label="任务标题">
              <span className="font-medium text-foreground">{title || "(未命名)"}</span>
            </Row>
            <Row label="任务描述">
              <span className="whitespace-pre-wrap break-words text-muted-foreground">
                {desc || "暂无描述"}
              </span>
            </Row>
            <Row label="状态">
              <Tag color={tag.color}>{tag.text}</Tag>
            </Row>
            <Row label="所属项目">{task.project_name ?? "—"}</Row>
            <Row label="负责人">{task.user_name ?? "未分配"}</Row>
            <Row label="截止日期">{task.deadline ? fmtDay(task.deadline) : "—"}</Row>
            <Row label="预估工时">{task.estimate_hours ?? "—"}h</Row>
          </div>
        </section>

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

      {/* 修改负责人 Modal */}
      <Modal
        title="修改负责人"
        open={assigneeModalOpen}
        onOk={handleUpdateAssignee}
        onCancel={() => setAssigneeModalOpen(false)}
        confirmLoading={assigning}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: !assigneeId }}
        destroyOnHidden
      >
        <div className="mb-1 text-xs text-muted-foreground">负责人</div>
        <Select
          showSearch
          allowClear
          style={{ width: "100%" }}
          placeholder="请搜索人员"
          value={assigneeId}
          onChange={(v) => setAssigneeId((v as string | undefined) ?? undefined)}
          onSearch={(kw) => void runUserSearch(kw)}
          filterOption={false}
          notFoundContent={searching ? <Spin size="small" /> : "无数据"}
          options={userResults.map((u) => ({
            value: u.user_id,
            label: u.username
              ? `${u.username}${u.dept_name ? ` · ${u.dept_name}` : ""}`
              : u.user_id,
          }))}
        />
      </Modal>
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-xs text-muted-foreground">{text}</div>
  );
}

export default KanbanTaskDetailDrawer;
