"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Tag,
  Timeline,
} from "antd";
import { PpmUserSelect } from "@/components/ppm-user-select";
import { FileUpload } from "@/components/file-upload";
import { PpmText } from "@/components/ppm-text";
import {
  matchAnyUser,
  PLAN_DETAIL_STATUS_COLOR,
  PLAN_DETAIL_STATUS_TEXT,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  createPsPlanNodeDetail,
  fmtDateTime,
  listPlanNodeDetailProcesses,
  listPlanNodeModules,
  listPsPlanNodeDetailVersions,
  updatePsPlanNodeDetail,
  type PlanNodeModule,
  type PsPlanNodeDetail,
  type PsPlanNodeDetailProcess,
} from "@/lib/ppm";
import { addWorkingDaysDate } from "@/lib/ppm/workday";
import {
  type DrawerMode,
  FormSection,
  fromDate,
  IMPLEMENT_STAGE,
  ModuleReadText,
  processColor,
  toDay,
} from "@/components/ppm/milestone/milestone-helpers";

type FormVals = Record<string, string | number | null | undefined | string[]>;

export function DetailDrawer({
  mode,
  planNodeId,
  moduleId,
  overallStage,
  detail,
  projectId,
  currentUserId,
  onClose,
  onSaved,
  onSubmit,
}: {
  mode: DrawerMode;
  planNodeId: string;
  moduleId: string | null;
  /** 当前里程碑 overall_stage,仅实施阶段时展示「所属模块」字段。 */
  overallStage?: string | null;
  detail?: PsPlanNodeDetail;
  projectId: string | null;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
  onSubmit: (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: {
      handleInfo?: string;
      changeReason?: string;
      changeApproveBackFlag?: string;
      changeApproveOpinion?: string;
    },
  ) => void;
}) {
  const [form] = Form.useForm<FormVals>();

  // 所属模块下拉选项:按 planNodeId 自取当前里程碑下的模块列表(plan_node_module)。
  // DetailDrawer 在主组件渲染、模块数据在 ModuleLevelTable 子组件,跨层级透传别扭,
  // 故明细抽屉按自身 planNodeId 直接拉取,自包含且选项始终与当前里程碑一致。
  const [modules, setModules] = useState<PlanNodeModule[]>([]);
  useEffect(() => {
    if (!planNodeId) {
      setModules([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await listPlanNodeModules(planNodeId);
        if (!cancelled) setModules(list);
      } catch {
        // 模块列表加载失败不阻塞,降级为空下拉
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planNodeId]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [logs, setLogs] = useState<PsPlanNodeDetailProcess[]>([]);
  const [versions, setVersions] = useState<PsPlanNodeDetail[]>([]);

  // ── 模式语义(对照源) ────────────────────────────────────────────────────
  // 开立信息块只读性:仅 create/edit/changeInfo 可编辑(草稿新增/编辑 + rejected 返工 + 已完成信息变更)。
  const baseEditable = mode === "create" || mode === "edit" || mode === "changeInfo";
  // 审核意见块可编辑:audit 模式 + 当前用户是审核人。
  const auditEditable =
    mode === "audit" &&
    !!detail?.audit_user_id &&
    matchAnyUser([detail.audit_user_id], currentUserId);
  // ql-20260720-011: 审批信息块已去掉, approveEditable 同步移除。
  // P0-8:变更审批意见块可编辑:changeApprove 模式 + 当前用户是审批人
  // (对照源 ChangeApproveNodeDetailForm:status=change_pending 时由审批人
  // 填 changeApproveBackFlag/changeApproveOpinion)。
  const changeApproveEditable =
    mode === "changeApprove" &&
    !!detail?.approve_user_id &&
    matchAnyUser([detail.approve_user_id], currentUserId);
  // 变更原因块仅在 change 模式渲染,进入即默认可编辑,无需额外 disabled 计算。

  // 初值:detail 优先,否则用 moduleId 兜底。
  const initialValues = useMemo<FormVals>(
    () => ({
      detailed_stage: detail?.detailed_stage ?? "",
      task_theme: detail?.task_theme ?? "",
      task_description: detail?.task_description ?? "",
      requirements: detail?.requirements ?? "",
      role_name: detail?.role_name ?? "",
      achievement: detail?.achievement ?? "",
      plan_workload: detail?.plan_workload ?? "",
      plan_begin_time: detail?.plan_begin_time ?? "",
      plan_complete_time: detail?.plan_complete_time ?? "",
      module_id: detail?.module_id ?? moduleId ?? "",
      execute_user_id: detail?.execute_user_id ?? "",
      audit_user_id: detail?.audit_user_id ?? "",
      approve_user_id: detail?.approve_user_id ?? "",
      file_urls: detail?.file_urls ?? [],
      // 审批意见块默认值(对齐源:非驳回 + 「同意」)
      audit_back_flag: detail?.status === "review" ? "0" : detail?.audit_user_id ? "0" : undefined,
      audit_opinion: detail?.status === "review" ? "同意" : undefined,
      approve_back_flag: detail?.status === "approve" ? "0" : undefined,
      approve_opinion: detail?.status === "approve" ? "同意" : undefined,
      // P0-8:变更审批块默认值(对齐源 ChangeApproveNodeDetailForm:同意)。
      change_approve_back_flag:
        detail?.status === "change_pending" ? "0" : undefined,
      change_approve_opinion:
        detail?.status === "change_pending" ? "同意" : undefined,
      change_reason: "",
    }),
    [detail, moduleId],
  );

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  // 履历 + 版本链(编辑态明细才拉)。
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    void (async () => {
      try {
        const [v, l] = await Promise.all([
          listPsPlanNodeDetailVersions(detail.id),
          listPlanNodeDetailProcesses(detail.id),
        ]);
        if (cancelled) return;
        setVersions(v);
        setLogs(l);
      } catch {
        // 历史加载失败不阻塞编辑
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  // task-07 工作日联动:plan_begin_time + plan_workload → plan_complete_time
  // (仅 draft/edit 模式,且用户未手填 plan_complete_time 时自动算)。
  const recomputeComplete = useCallback(
    (begin?: string | null, workload?: string | null) => {
      if (!baseEditable) return;
      const b = begin ?? form.getFieldValue("plan_begin_time");
      const w = workload ?? form.getFieldValue("plan_workload");
      if (!b || !w) return;
      const days = Number(w);
      if (!Number.isFinite(days) || days <= 0) return;
      try {
        const computed = addWorkingDaysDate(b as string, days);
        form.setFieldValue("plan_complete_time", computed);
      } catch {
        // 联动失败忽略
      }
    },
    [baseEditable, form],
  );

  // ── 提交 ────────────────────────────────────────────────────────────────
  const submit = async (autoSubmit?: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const vals = await form.validateFields();
      // ql-20260720-006: 开立信息字段集合(create/edit/changeInfo 共用)。
      const baseBody = {
        detailed_stage: (vals.detailed_stage as string) || null,
        task_theme: (vals.task_theme as string) || null,
        task_description: (vals.task_description as string) || null,
        requirements: (vals.requirements as string) || null,
        role_name: (vals.role_name as string) || null,
        achievement: (vals.achievement as string) || null,
        plan_workload:
          vals.plan_workload != null && vals.plan_workload !== ""
            ? String(vals.plan_workload)
            : null,
        plan_begin_time: (vals.plan_begin_time as string) || null,
        plan_complete_time: (vals.plan_complete_time as string) || null,
        module_id: (vals.module_id as string) || null,
        execute_user_id: (vals.execute_user_id as string) || null,
        audit_user_id: (vals.audit_user_id as string) || null,
        approve_user_id: (vals.approve_user_id as string) || null,
        file_urls: (vals.file_urls as string[]) ?? [],
      };

      if (mode === "create" || mode === "edit") {
        const body = baseBody;
        if (mode === "create") {
          // ql-20260713-010: 提交(autoSubmit=true)=创建为正式 done（不走审核）；保存=draft 草稿。
          await createPsPlanNodeDetail(
            autoSubmit
              ? { plan_node_id: planNodeId, ...body, status: "done" }
              : { plan_node_id: planNodeId, ...body },
          );
          // task-08:autoSubmit=true=直接创建为 done,后端自动建任务计划,提示用户(仅 done 路径)。
          if (autoSubmit) {
            message.success("已提交，已自动创建任务计划");
          }
          onSaved();
          return;
        }
        // edit(draft/rejected 草稿编辑):
        //   保存(autoSubmit=undefined)= 仅 updatePsPlanNodeDetail 存草稿;
        //   提交(autoSubmit=true)= 先保存编辑,再走 saveProcess（draft→done，无审核流程）。
        if (!detail) return;
        await updatePsPlanNodeDetail(detail.id, body);
        if (autoSubmit) {
          onClose();
          await onSubmit(detail.id, "save");
          return;
        }
        onSaved();
        return;
      }

      if (!detail) return;

      // ql-20260720-006: 已完成明细信息变更——仅 updatePsPlanNodeDetail,
      // 后端 _sync_task_fields 同步关联任务字段(content/workload/time/user/module 等),
      // 不改明细 status、不生成新版本、不改任务 status(FR-03/D-007)。
      if (mode === "changeInfo") {
        await updatePsPlanNodeDetail(detail.id, baseBody);
        message.success("已变更，任务计划已同步更新");
        onSaved();
        return;
      }

      if (mode === "audit") {
        const backFlag = (vals.audit_back_flag as string) ?? "0";
        const opinion = (vals.audit_opinion as string) ?? "";
        onClose();
        if (backFlag === "1") {
          await onSubmit(detail.id, "reject", { handleInfo: opinion });
        } else {
          await onSubmit(detail.id, "save", { handleInfo: opinion });
        }
        return;
      }

      if (mode === "approve") {
        const backFlag = (vals.approve_back_flag as string) ?? "0";
        const opinion = (vals.approve_opinion as string) ?? "";
        onClose();
        if (backFlag === "1") {
          await onSubmit(detail.id, "reject", { handleInfo: opinion });
        } else {
          await onSubmit(detail.id, "save", { handleInfo: opinion });
        }
        return;
      }

      if (mode === "change") {
        const reason = ((vals.change_reason as string) ?? "").trim();
        if (!reason) {
          setErr("变更原因不能为空");
          return;
        }
        onClose();
        await onSubmit(detail.id, "change", { changeReason: reason });
        return;
      }

      if (mode === "changeApprove") {
        // P0-8:对照源 ChangeApproveNodeDetailForm.submitForm:
        // backFlag==='0' → saveProcess(同意);backFlag==='1' → rejectProcess(驳回)。
        const backFlag = (vals.change_approve_back_flag as string) ?? "0";
        const opinion = (vals.change_approve_opinion as string) ?? "";
        onClose();
        if (backFlag === "1") {
          await onSubmit(detail.id, "reject", {
            handleInfo: opinion,
            changeApproveBackFlag: "1",
            changeApproveOpinion: opinion,
          });
        } else {
          await onSubmit(detail.id, "save", {
            handleInfo: opinion,
            changeApproveBackFlag: "0",
            changeApproveOpinion: opinion,
          });
        }
        return;
      }
      // view 模式无提交
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
      } else if (e && typeof e === "object" && "errorFields" in e) {
        // AntD 校验失败,validateFields 已在字段下提示
      } else {
        setErr("操作失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const title = useMemo(() => {
    switch (mode) {
      case "create":
        return "新建里程碑明细";
      case "edit":
        return `编辑明细${detail ? ` · ${PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}` : ""}`;
      case "audit":
        return "审核明细";
      case "approve":
        return "审批明细";
      case "change":
        return "计划变更";
      case "changeApprove":
        return "变更审批";
      case "changeInfo":
        return "变更明细";
      default:
        return `明细详情${detail ? ` · ${PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}` : ""}`;
    }
  }, [mode, detail]);

  // submit 按钮文案
  const submitText = useMemo(() => {
    if (mode === "create" || mode === "edit") return "保存";
    if (mode === "audit" || mode === "approve") return "提交";
    if (mode === "change") return "提交变更";
    if (mode === "changeApprove") return "提交审批";
    if (mode === "changeInfo") return "提交";
    return "";
  }, [mode]);

  // 第二个按钮(autoSubmit=true)文案:create→「提交」(建为 done 不走审核);
  // edit/create→「提交」(无审核流程，直接落 done)。
  const submitEditOrCreateText = "提交";

  const showSubmit = mode !== "view";

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          {title}
          {detail ? (
            <Tag color={PLAN_DETAIL_STATUS_COLOR[detail.status] ?? "default"}>
              {PLAN_DETAIL_STATUS_TEXT[detail.status] ?? detail.status}
            </Tag>
          ) : null}
        </span>
      }
      open
      onCancel={onClose}
      width={720}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>关闭</Button>
          {showSubmit && (mode === "create" || mode === "edit") ? (
            <>
              <Button type="primary" loading={busy} onClick={() => void submit()}>
                {submitText}
              </Button>
              <Button type="primary" loading={busy} onClick={() => void submit(true)}>
                {submitEditOrCreateText}
              </Button>
            </>
          ) : showSubmit ? (
            <Button type="primary" loading={busy} onClick={() => void submit()}>
              {submitText}
            </Button>
          ) : null}
        </div>
      }
    >
      <Form<FormVals>
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={(changed) => {
          // 工作日联动:开始时间或工作量变化时重算完成时间
          if ("plan_begin_time" in changed || "plan_workload" in changed) {
            recomputeComplete(
              changed.plan_begin_time as string | undefined,
              changed.plan_workload as string | undefined,
            );
          }
        }}
      >
        {/* 开立信息块(对照源 AddNodeDetailForm / ViewNodeDetailForm 开立段) */}
        <FormSection title="开立信息">
          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label="明细阶段"
              name="detailed_stage"
              rules={[{ required: true, message: "请输入明细阶段" }]}
            >
              <Input disabled={!baseEditable} placeholder="请输入明细阶段" />
            </Form.Item>
            <Form.Item
              label="任务主题"
              name="task_theme"
              rules={[{ required: true, message: "请输入任务主题" }]}
            >
              <Input disabled={!baseEditable} placeholder="请输入任务主题" />
            </Form.Item>
          </div>
          <Form.Item
            label="任务描述"
            name="task_description"
            rules={[{ required: true, message: "请输入任务描述" }]}
          >
            <Input.TextArea
              disabled={!baseEditable}
              rows={2}
              placeholder="请输入任务描述"
            />
          </Form.Item>
          <Form.Item label="要求" name="requirements">
            <Input.TextArea
              disabled={!baseEditable}
              rows={2}
              placeholder="请输入要求"
            />
          </Form.Item>
          <div className="grid grid-cols-3 gap-3">
            <Form.Item label="角色" name="role_name" rules={[{ required: false }]}>
              <Input disabled={!baseEditable} placeholder="角色" />
            </Form.Item>
            <Form.Item label="成果" name="achievement" rules={[{ required: false }]}>
              <Input disabled={!baseEditable} placeholder="成果" />
            </Form.Item>
            <Form.Item
              label="计划工作量(工作日)"
              name="plan_workload"
              tooltip="填数字。修改后将按工作日自动推算计划完成时间。"
              rules={[{ required: true, message: "请输入计划工作量" }]}
            >
              <InputNumber
                disabled={!baseEditable}
                placeholder="如 5"
                step={0.5}
                precision={1}
                min={0}
                className="w-full"
                style={{ width: "100%" }}
              />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              label="计划开始时间"
              name="plan_begin_time"
              getValueProps={(v) => ({ value: toDay(v) })}
              normalize={(d) => fromDate(d)}
              rules={[{ required: true, message: "请选择计划开始时间" }]}
            >
              <DatePicker disabled={!baseEditable} className="w-full" format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item
              label="计划完成时间"
              name="plan_complete_time"
              getValueProps={(v) => ({ value: toDay(v) })}
              normalize={(d) => fromDate(d)}
              rules={[{ required: true, message: "请选择计划完成时间" }]}
            >
              <DatePicker disabled={!baseEditable} className="w-full" format="YYYY-MM-DD" />
            </Form.Item>
          </div>
          <div
            className={
              overallStage === IMPLEMENT_STAGE
                ? "grid grid-cols-2 gap-3"
                : "grid grid-cols-1 gap-3"
            }
          >
            {overallStage === IMPLEMENT_STAGE && (
              <Form.Item
                label="所属模块"
                name="module_id"
                tooltip="实施阶段必填;选项来自当前里程碑的模块列表"
                rules={[{ required: true, message: "请选择所属模块" }]}
              >
                {baseEditable ? (
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="请选择所属模块"
                    notFoundContent={
                      modules.length === 0 ? "该里程碑暂无模块" : undefined
                    }
                    options={modules.map((m) => ({
                      value: m.id,
                      label: m.module_name ?? m.id,
                    }))}
                  />
                ) : (
                  // 只读视图用文字展示:后端派生 module_name 优先(模块被删/跨里程碑也能解析),
                  // 兜底当前里程碑模块列表,避免下拉匹配不到时裸露 UUID。
                  <ModuleReadText
                    value={detail?.module_id}
                    name={detail?.module_name}
                    modules={modules}
                  />
                )}
              </Form.Item>
            )}
            <Form.Item
              label="执行人"
              name="execute_user_id"
              rules={[{ required: true, message: "请选择执行人" }]}
            >
              {!baseEditable ? (
                // 只读视图用文字展示:后端派生 execute_user_name 优先,PpmText 再按
                // user_id 反查全量用户兜底(执行人已离场也能解析),避免裸露 UUID。
                <PpmText
                  res="user"
                  value={detail?.execute_user_id}
                  name={detail?.execute_user_name}
                />
              ) : projectId ? (
                <PpmUserSelect
                  res="projectMember"
                  searchData={{ pm_project_id: projectId }}
                  allowClear
                  placeholder="选择执行人"
                />
              ) : (
                <Input placeholder="执行人 ID" />
              )}
            </Form.Item>
          </div>
          <Form.Item label="附件" name="file_urls">
            <FileUpload owner_type="ppm_ps_plan_node_detail" disabled={!baseEditable} />
          </Form.Item>
        </FormSection>

        {/* 审核信息块:audit/edit/view 可见,审批/变更/变更审批阶段也展示(只读) */}
        {(mode === "audit" ||
          mode === "approve" ||
          mode === "change" ||
          mode === "changeApprove" ||
          mode === "view") &&
          detail?.audit_user_id && (
            <FormSection title="审核信息">
              <div className="grid grid-cols-2 gap-3">
                <Form.Item label="审核人">
                  <PpmText res="user" value={detail.audit_user_id} name={detail.audit_user_name} />
                </Form.Item>
                <Form.Item label="是否驳回" name="audit_back_flag">
                  <Select
                    disabled={!auditEditable}
                    options={[
                      { value: "0", label: "否" },
                      { value: "1", label: "是" },
                    ]}
                  />
                </Form.Item>
              </div>
              <Form.Item
                label="审核意见"
                name="audit_opinion"
                rules={
                  auditEditable
                    ? [{ required: true, message: "请输入审核意见" }]
                    : undefined
                }
              >
                <Input.TextArea
                  disabled={!auditEditable}
                  rows={2}
                  placeholder="请输入意见"
                />
              </Form.Item>
            </FormSection>
          )}

        {/* ql-20260720-011: 审批信息块已去掉(当前 draft→done 无审核流程, approve 模式不触达;
            审批人/意见 UI 隐藏; approve_user_id 等数据字段保留供 submit 默认值)。 */}

        {/* 变更原因块 */}
        {mode === "change" && (
          <FormSection title="变更原因">
            <Form.Item
              label="变更原因"
              name="change_reason"
              rules={[{ required: true, message: "请输入变更原因" }]}
            >
              <Input.TextArea
                rows={3}
                placeholder="请输入变更原因,提交后生成新版本草稿,旧版本归档"
              />
            </Form.Item>
          </FormSection>
        )}

        {/* P0-8:变更审批块(对照源 ChangeApproveNodeDetailForm)。
            status=change_pending 时由审批人填写 changeApproveBackFlag/
            changeApproveOpinion,提交走 save(同意)/reject(驳回)。
            同时只读展示变更原因(detail.change_reason)。 */}
        {mode === "changeApprove" && (
          <>
            {detail?.change_reason && (
              <FormSection title="变更原因(只读)">
                <Form.Item label="变更原因">
                  <Input.TextArea value={detail.change_reason} disabled rows={3} />
                </Form.Item>
              </FormSection>
            )}
            <FormSection title="变更审批">
              <Form.Item label="审批人">
                <PpmText
                  res="user"
                  value={detail?.approve_user_id}
                  name={detail?.approve_user_name}
                />
              </Form.Item>
              <Form.Item
                label="是否驳回"
                name="change_approve_back_flag"
                rules={[{ required: true, message: "请选择" }]}
              >
                <Select
                  disabled={!changeApproveEditable}
                  options={[
                    { value: "0", label: "否" },
                    { value: "1", label: "是" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label="意见"
                name="change_approve_opinion"
                rules={[{ required: true, message: "请输入意见" }]}
              >
                <Input.TextArea
                  disabled={!changeApproveEditable}
                  rows={2}
                  placeholder="请输入意见"
                />
              </Form.Item>
            </FormSection>
          </>
        )}

        {/* 变更版本链 */}
        {detail && versions.length > 0 && (
          <FormSection title={`变更版本链(${versions.length})`}>
            <div className="space-y-1 rounded border bg-card p-2">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center gap-2 text-[11px]">
                  <Tag color={PLAN_DETAIL_STATUS_COLOR[v.status] ?? "default"}>
                    {PLAN_DETAIL_STATUS_TEXT[v.status] ?? v.status}
                  </Tag>
                  <span className="truncate">{v.task_theme ?? v.id}</span>
                  {v.change_reason && (
                    <span className="truncate text-muted-foreground">
                      {v.change_reason}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </FormSection>
        )}
      </Form>

      {/* 流程履历 Timeline(对照源 ViewNodeDetailForm el-timeline) */}
      {detail && logs.length > 0 && (
        <FormSection title={`流程履历(${logs.length})`}>
          <Timeline
            items={logs.map((l) => ({
              key: l.id,
              color: processColor(l.node_key),
              children: (
                <div className="space-y-0.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {l.handle_user_name ?? <PpmText res="user" value={l.handle_user_id} />}
                    </span>
                    <Tag className="text-[10px]">{l.node_key ?? l.business_type}</Tag>
                  </div>
                  {l.handle_info && (
                    <div className="text-muted-foreground">{l.handle_info}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {fmtDateTime(l.handle_date ?? l.created_at)}
                    {l.next_user_name ? ` → 下一处理人:${l.next_user_name}` : null}
                  </div>
                </div>
              ),
            }))}
          />
        </FormSection>
      )}

      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </Modal>
  );
}
