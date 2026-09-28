import { Tag, Tooltip, Typography } from 'antd';
import type { AccessPoint } from '../../types/point';
import { formatNextOpen, pointOpenStatus, type OpenStatus } from '../../utils/hours';

interface OpenStatusTagProps {
  point: Pick<AccessPoint, 'weeklyHours' | 'closureDays' | 'name'>;
  at?: Date;
  /** 判定时刻（可与展示时刻不同，如路线按到达时刻判定） */
  status?: OpenStatus;
  size?: 'small' | 'default';
  showNext?: boolean;
}

/** 点位开放状态标签：当前开放 / 即将关闭 / 已关闭，悬浮显示最近可开放时间 */
export default function OpenStatusTag({ point, at, status, size = 'default', showNext }: OpenStatusTagProps) {
  const s = status ?? pointOpenStatus(point, at ?? new Date());  const fontSize = size === 'small' ? 12 : undefined;
  const tag = (
    <Tag
      color={s.color}
      data-testid="open-status-tag"
      data-status={s.label}
      style={{ marginInlineEnd: 0, fontSize }}
    >
      {s.label}
    </Tag>
  );
  const tip =
    s.kind === 'closed'
      ? s.closureReason
        ? `${s.closureReason}；最近可开放：${formatNextOpen(s.nextOpen)}`
        : `最近可开放：${formatNextOpen(s.nextOpen)}`
      : s.closingAt
        ? `营业至 ${s.closingAt.getHours()}:${`${s.closingAt.getMinutes()}`.padStart(2, '0')}`
        : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {tip ? <Tooltip title={tip}>{tag}</Tooltip> : tag}
      {showNext && s.kind === 'closed' ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          最近可开放 {formatNextOpen(s.nextOpen)}
        </Typography.Text>
      ) : null}
    </span>
  );
}
