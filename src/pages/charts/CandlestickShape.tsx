import type { ChartStudyPoint } from "./chartData";

type CandlestickShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChartStudyPoint;
};

export function CandlestickShape({ x = 0, y = 0, width = 0, height = 0, payload }: CandlestickShapeProps) {
  if (!payload || height <= 0) return null;
  const { open, close, high, low, live } = payload;
  const range = Math.max(high - low, 0.0001);
  const bullish = close >= open;
  const color = bullish ? "#10b981" : "#f43f5e";
  const bodyTop = y + ((high - Math.max(open, close)) / range) * height;
  const bodyBottom = y + ((high - Math.min(open, close)) / range) * height;
  const bodyHeight = Math.max(1.5, bodyBottom - bodyTop);
  const center = x + width / 2;
  const bodyWidth = Math.max(2, Math.min(width * 0.68, 10));

  return (
    <g opacity={live ? 0.75 : 1}>
      <line x1={center} x2={center} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect
        x={center - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        rx={0.6}
        fill={bullish ? color : "#0f172a"}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}
