"use client";

/**
 * 关联仓共享字段表单 Modal（2026-10-10-workspec-maintenance task-05 / FR-06）。
 *
 * 新增/编辑共用（editing=null 为新增）。字段：名称（必填，编辑态只读——
 * 唯一键+yaml 文件名不可改，design 数据模型节）/ 仓库地址 / 描述 / 约定相对路径。
 * 提交/异常经 App.useApp message 反馈；提交成功由父级回调刷新。
 */

import { useEffect, useState } from "react";
import { App, Form, Input, Modal } from "antd";

import { ApiError } from "@/lib/api";
import type { LinkedRepoUpsertInput, LinkedRepoView } from "@/lib/linked-repos";

export interface LinkedRepoFormModalProps {
  open: boolean;
  /** null=新增；否则编辑该行（name 锁定）。 */
  editing: LinkedRepoView | null;
  onClose: () => void;
  onSubmit: (input: LinkedRepoUpsertInput) => Promise<void>;
}

interface FormValues {
  name: string;
  repo_url?: string;
  description?: string;
  rel_path?: string;
}

export function LinkedRepoFormModal({
  open,
  editing,
  onClose,
  onSubmit,
}: LinkedRepoFormModalProps): JSX.Element {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: editing?.name ?? "",
        repo_url: editing?.repo_url ?? "",
        description: editing?.description ?? "",
        rel_path: editing?.rel_path ?? "",
      });
    }
  }, [open, editing, form]);

  const handleOk = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败：antd 已在表单项下展示错误，静默止步
    }
    setSaving(true);
    try {
      await onSubmit({
        ...(editing ? {} : { name: values.name.trim() }),
        repo_url: values.repo_url?.trim() || null,
        description: values.description?.trim() || null,
        rel_path: values.rel_path?.trim() || null,
      });
      message.success(editing ? "已保存修改" : "已新增关联仓");
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? "编辑关联仓" : "新增关联仓"}
      width={520}
      destroyOnHidden
      onCancel={onClose}
      onOk={() => void handleOk()}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
    >
      <p className="mb-3 text-xs text-muted-foreground">
        登记一个与本工作区关联的仓库（工作区共享信息，管理员维护）。
      </p>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="仓库名称"
          rules={[
            { required: true, message: "请填写仓库名称" },
            {
              pattern: /^[A-Za-z0-9_.\-]+$/,
              message: "限字母数字 . _ -（作 sillyspec 子项目名）",
            },
          ]}
          extra={editing ? "名称创建后不可改（唯一键 + 子项目 yaml 文件名）" : "显示名，同一工作区内唯一"}
        >
          <Input placeholder="如 platform-specs / frontend" disabled={!!editing} maxLength={100} />
        </Form.Item>
        <Form.Item name="repo_url" label="仓库地址（repo URL）">
          <Input placeholder="https://github.com/org/repo.git（可空）" maxLength={500} />
        </Form.Item>
        <Form.Item
          name="rel_path"
          label="约定相对路径"
          extra="相对本工作区根目录的团队约定路径（如 ../platform-specs，进 git 须全员一致）；留空则该仓只落本机 repos 注册表层"
        >
          <Input placeholder="../platform-specs（可空）" maxLength={500} />
        </Form.Item>
        <Form.Item name="description" label="关系描述">
          <Input.TextArea
            rows={2}
            placeholder="一句话说明关联关系，如：本产品的 spec 规范仓，变更文档集中存放地"
            maxLength={2000}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
