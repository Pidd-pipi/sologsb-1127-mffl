import { Tooltip } from 'antd';
import type { AccessPoint } from '../../types/point';
import { getOpenInfo, type OpenState } from '../../utils/schedule';

const TAG_TEXT: Record<OpenState, string> = {
  open: '开放中',
  'closing-soon': '即将关闭',
  closed: '已关闭',
};

export const OPEN_TAG_COLOR: Record<OpenState, string> = {
  open: 'success',
  'closing-soon': 'warning',
  closed: 'error',
};

interface OpenStatusTagProps {
  point: AccessPoint;
  at: Date;
  /** 自定义尺寸（默认小号标签） */
  size?: 'small' | 'default';
  /** 未登记时段（全天开放）时仍显示开放标签；置 false 可隐藏道路类设施标签 */
  showAlwaysOpen?: boolean;
}

/** 点位开放状态标签：当前开放 / 即将关闭 / 已关闭，悬浮查看最近可开放时间 */
export default function OpenStatusTag({
  point,
  at,
  size = 'small',
  showAlwaysOpen = true,
}: OpenStatusTagProps) {
  const info = getOpenInfo(point, at);
  if (info.state === 'open' && !info.scheduled && !showAlwaysOpen) return null;
  return (
    <Tooltip title={info.reason}>
      <span
        data-testid={`open-status-${point.id}`}
        data-open-state={info.state}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: size === 'small' ? '0 6px' : '2px 10px',
          fontSize: size === 'small' ? 12 : 13,
          lineHeight: size === 'small' ? '20px' : '22px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          color:
            info.state === 'open' ? '#389e0d' : info.state === 'closing-soon' ? '#d48806' : '#cf1322',
          background:
            info.state === 'open' ? '#f6ffed' : info.state === 'closing-soon' ? '#fffbe6' : '#fff1f0',
          border: `1px solid ${
            info.state === 'open' ? '#b7eb8f' : info.state === 'closing-soon' ? '#ffe58f' : '#ffa39e'
          }`,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background:
              info.state === 'open' ? '#52c41a' : info.state === 'closing-soon' ? '#faad14' : '#ff4d4f',
          }}
        />
        {TAG_TEXT[info.state]}
      </span>
    </Tooltip>
  );
}
