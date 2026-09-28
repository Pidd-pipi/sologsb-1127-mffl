import { Button, DatePicker, Empty, Input, Select, Space, Table, TimePicker, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ClosureDay, FacilityType, WeeklySlot, Weekday } from '../../types/point';
import { WEEKDAYS, WEEKDAY_LABELS } from '../../types/point';
import { defaultWeeklyHours, isValidSlot } from '../../utils/hours';

export interface HoursValue {
  weeklyHours: WeeklySlot[];
  closureDays: ClosureDay[];
}

interface HoursEditorProps {
  facilityType: FacilityType;
  value: HoursValue;
  onChange: (next: HoursValue) => void;
  /** 是否可编辑（点位详情默认只读，点「编辑」后开启） */
  disabled?: boolean;
}

/** 每周固定开放时段 + 例外闭馆日编辑表（点位登记 / 详情共用） */
export default function HoursEditor({ facilityType, value, onChange, disabled }: HoursEditorProps) {
  const patchSlots = (weeklyHours: WeeklySlot[]) => onChange({ ...value, weeklyHours });
  const patchClosures = (closureDays: ClosureDay[]) => onChange({ ...value, closureDays });

  const addSlot = () => {
    const used = new Set((value.weeklyHours || []).map((s) => s.weekday));
    const weekday = (WEEKDAYS.find((d) => !used.has(d)) ?? 1) as Weekday;
    patchSlots([...(value.weeklyHours || []), { weekday, start: '09:00', end: '17:00' }]);
  };

  const updateSlot = (idx: number, patch: Partial<WeeklySlot>) => {
    patchSlots((value.weeklyHours || []).map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const invalidCount = (value.weeklyHours || []).filter((s) => !isValidSlot(s)).length;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }} data-testid="hours-editor">
      <Space wrap>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          disabled={disabled}
          onClick={() => patchSlots(defaultWeeklyHours(facilityType))}
          data-testid="hours-preset"
        >
          按设施类型填入默认时段
        </Button>
        {!(value.weeklyHours || []).length ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            不配置时段表示全天开放（适用于坡道、盲道等室外设施）
          </Typography.Text>
        ) : null}
      </Space>

      {(value.weeklyHours || []).length ? (
        <Table<WeeklySlot>
          rowKey={(_, i) => `${i}`}
          size="small"
          pagination={false}
          dataSource={value.weeklyHours}
          data-testid="hours-table"
          columns={[
            {
              title: '星期',
              width: 110,
              render: (_, __, i) => (
                <Select
                  value={(value.weeklyHours || [])[i]?.weekday}
                  disabled={disabled}
                  style={{ width: 92 }}
                  onChange={(v) => updateSlot(i, { weekday: v as Weekday })}
                  options={WEEKDAYS.map((d) => ({ value: d, label: WEEKDAY_LABELS[d] }))}
                />
              ),
            },
            {
              title: '开始',
              width: 110,
              render: (_, __, i) => (
                <TimePicker
                  allowClear={false}
                  disabled={disabled}
                  format="HH:mm"
                  minuteStep={30}
                  value={dayjs((value.weeklyHours || [])[i]?.start, 'HH:mm')}
                  onChange={(d) => updateSlot(i, { start: d ? d.format('HH:mm') : '00:00' })}
                  style={{ width: 92 }}
                />
              ),
            },
            {
              title: '结束',
              width: 120,
              render: (_, __, i) => (
                <TimePicker
                  allowClear={false}
                  disabled={disabled}
                  format="HH:mm"
                  minuteStep={30}
                  value={dayjs((value.weeklyHours || [])[i]?.end, 'HH:mm')}
                  onChange={(d) => updateSlot(i, { end: d ? d.format('HH:mm') : '00:00' })}
                  style={{ width: 92 }}
                />
              ),
            },
            {
              title: '说明',
              render: (_, row) => {
                if (!isValidSlot(row)) return <Typography.Text type="danger">起止时刻不能相同</Typography.Text>;
                const [sh, sm] = [row.start, row.end].map((v) => {
                  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
                  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
                });
                return sm <= sh ? <Typography.Text type="warning">跨夜，按到达日次日判定</Typography.Text> : null;
              },
            },
            {
              title: '',
              width: 48,
              render: (_, __, i) => (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={disabled}
                  onClick={() => patchSlots((value.weeklyHours || []).filter((_, j) => j !== i))}
                />
              ),
            },
          ]}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未配置固定时段，按全天开放处理"
          style={{ margin: '4px 0' }}
        />
      )}
      {!disabled ? (
        <Button size="small" icon={<PlusOutlined />} onClick={addSlot} data-testid="hours-add-slot">
          添加时段
        </Button>
      ) : null}
      {invalidCount > 0 ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          有 {invalidCount} 条时段起止时刻相同，请修正后保存
        </Typography.Text>
      ) : null}

      <Typography.Text strong style={{ display: 'block', marginTop: 8 }}>
        例外闭馆日（覆盖周计划）
      </Typography.Text>
      <Table<ClosureDay>
        rowKey="date"
        size="small"
        pagination={false}
        dataSource={value.closureDays || []}
        locale={{ emptyText: '暂无闭馆日' }}
        columns={[
          {
            title: '日期',
            dataIndex: 'date',
            width: 170,
            render: (d: string, _row, i) => (
              <DatePicker
                value={d ? dayjs(d) : null}
                disabled={disabled}
                onChange={(v) => {
                  const date = v ? v.format('YYYY-MM-DD') : '';
                  const others = (value.closureDays || []).filter((_, j) => j !== i);
                  // 改期到已存在的闭馆日时合并；清空日期则移除该行
                  if (!date) {
                    patchClosures(others);
                    return;
                  }
                  const edited = { ...(value.closureDays || [])[i], date };
                  patchClosures([...others.filter((c) => c.date !== date), edited]);
                }}
                style={{ width: 150 }}
              />
            ),
          },
          {
            title: '闭馆原因',
            dataIndex: 'reason',
            render: (r: string, _row, i) => (
              <Input
                value={r}
                disabled={disabled}
                placeholder="如 设备检修 / 法定节假日"
                onChange={(e) => {
                  const next = [...(value.closureDays || [])];
                  next[i] = { ...next[i], reason: e.target.value };
                  patchClosures(next);
                }}
              />
            ),
          },
          {
            title: '',
            width: 48,
            render: (_, _row, i) => (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={disabled}
                onClick={() => patchClosures((value.closureDays || []).filter((_, j) => j !== i))}
              />
            ),
          },
        ]}
      />
      {!disabled ? (
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() =>
            patchClosures([
              ...(value.closureDays || []),
              { date: dayjs().add(1, 'day').format('YYYY-MM-DD'), reason: '' },
            ])
          }
          data-testid="hours-add-closure"
        >
          添加闭馆日
        </Button>
      ) : null}
    </Space>
  );
}
