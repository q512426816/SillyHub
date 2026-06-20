/**
 * PPM 工作日联动 helper — addWorkingDays。
 *
 * 对照源 `dept_project_front/src/utils/formatTime.ts` 的 `addWorkingDays`:
 * 从开始时间起算,加 N 个工作日(默认跳过周六周日),返回目标完成时间。
 * 支持整数天 + 小数天(小数部分按小时顺延,跨日继续跳周末)。
 *
 * 本任务范围(task-07):提供纯函数 + 单元测试,供 task-05 milestone 表单
 * (plan_begin_time + plan_workload → plan_complete_time)和 problem 表单
 * (plan_start_time + work_load → plan_end_time)调用。表单集成留给各自任务。
 *
 * 设计依据:tasks/task-07.md「工作日联动 helper」+ 源 addWorkingDays 实现。
 */

/** Date 构造可接受类型(毫秒数 / ISO 字符串 / Date 实例)。 */
export type WorkdayStart = number | string | Date;

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  // 0 = 周日, 6 = 周六
  return day === 0 || day === 6;
}

/**
 * 加 N 个工作日(跳过周末),返回毫秒时间戳。
 *
 * 与源实现一致:
 * 1. `days - 0.01` 微调:让「加 1 天」回到当天结束附近而非跨入次日。
 * 2. 起点是周末时先顺延到下一个工作日的零点。
 * 3. 整数工作日:先加完整周(totalDays / 5 × 7 天),再逐日推进跳过周末。
 * 4. 剩余小数小时:当日剩余空间不足时跨到下一工作日零点继续。
 *
 * @param start 开始时间(毫秒数 / ISO 字符串 / Date)
 * @param days 工作日跨度(支持小数;<=0 视为 0.01 微调后回退到当天)
 * @param ignoreWeekend 是否跳过周六周日,默认 true
 */
export function addWorkingDaysMs(
  start: WorkdayStart,
  days: number,
  ignoreWeekend = true,
): number {
  // 与源一致:加一天情况下日期不变的微调
  let remaining = (Number(days) || 0) - 0.01;

  const date = new Date(start);

  // 起点是周末则顺延到下一工作日零点
  while (ignoreWeekend && isWeekend(date)) {
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
  }

  const totalDays = Math.floor(remaining);
  let remainingHours = (remaining - totalDays) * 24;

  // 完整周
  const weeks = Math.floor(totalDays / 5);
  const restDays = totalDays % 5;
  date.setDate(date.getDate() + weeks * 7);

  // 剩余工作日(逐日跳周末)
  for (let i = 0; i < restDays; i++) {
    do {
      date.setDate(date.getDate() + 1);
    } while (ignoreWeekend && isWeekend(date));
  }

  // 剩余小数小时(跨周末)
  let remainingMs = remainingHours * 3600 * 1000;
  while (remainingMs > 0) {
    const endOfDay = new Date(date);
    endOfDay.setHours(24, 0, 0, 0);
    const availableMs = endOfDay.getTime() - date.getTime();

    if (remainingMs <= availableMs) {
      date.setTime(date.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= availableMs;
      date.setTime(endOfDay.getTime());
      do {
        date.setDate(date.getDate() + 1);
      } while (ignoreWeekend && isWeekend(date));
      date.setHours(0, 0, 0, 0);
    }
  }

  // 消除 unused 警告(remainingHours 已被消费为 ms)
  void remainingHours;
  remainingHours = 0;

  return date.getTime();
}

/**
 * 加 N 个工作日,返回 YYYY-MM-DD 字符串(只取日期部分)。
 * 表单里 `plan_complete_time` / `plan_end_time` 多以日期粒度展示时使用。
 *
 * @param start 开始时间
 * @param days 工作日跨度
 * @param ignoreWeekend 是否跳过周六周日,默认 true
 */
export function addWorkingDaysDate(
  start: WorkdayStart,
  days: number,
  ignoreWeekend = true,
): string {
  const ms = addWorkingDaysMs(start, days, ignoreWeekend);
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 加 N 个工作日,返回完整 ISO 字符串(YYYY-MM-DD HH:mm:ss)。
 * 表单字段需要带时间时使用。
 */
export function addWorkingDaysISO(
  start: WorkdayStart,
  days: number,
  ignoreWeekend = true,
): string {
  const ms = addWorkingDaysMs(start, days, ignoreWeekend);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
