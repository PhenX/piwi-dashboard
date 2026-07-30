import type { Ref } from 'vue';
import type { MarkerInfo } from '~~/types/api';
import { getMarkerCategory } from '#shared/marker-categories';

/**
 * Shared interactive-marker + tooltip logic for the @unovis/vue trend charts.
 *
 * All trend charts (pass rate, test runs, performance, test-case history) render
 * a line/area via VisXYContainer and then inject clickable SVG circles at each
 * data point with a floating tooltip. This composable owns that injection and
 * the tooltip position state so each chart only supplies its accessors and
 * tooltip markup.
 *
 * It can additionally draw vertical **timeline marker lines** (project events —
 * deploys, config changes, incidents) at dated x-positions, with their own
 * clickable flag handle + tooltip. Marker rendering is independent of the data
 * point loop, so bar charts that don't plot circles can still show markers.
 *
 * Usage:
 * ```ts
 * const xyContainerRef = ref<UnovisContainerRef | null>(null);
 * const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
 *   x: (d) => d.date,
 *   series: [{ y: (d) => d.value, color: 'rgb(34, 197, 94)' }],
 *   onClick: (d) => navigateTo(`/test-runs/${d.id}`),
 *   markers,                       // Ref<MarkerInfo[]>
 *   onMarkerClick: (m) => ...,
 * });
 * ```
 * Then bind `:on-render-complete="onRenderComplete"` on the VisXYContainer.
 */

interface ChartMargin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Shape of the @unovis/vue container instance exposed via a template ref. */
export interface UnovisContainerRef {
  component?: {
    // xScale/yScale live on the first child component (VisLine/VisArea), not the container.
    components?: Array<{
      xScale?: (v: Date | number) => number;
      yScale?: (v: number) => number;
    }>;
  };
}

export interface ChartSeries<T> {
  y: (d: T) => number | null | undefined;
  /** Solid color string, or a per-point function (e.g. green when passing). */
  color: string | ((d: T) => string);
}

export interface ChartMarkerOptions<T> {
  x: (d: T) => Date | number;
  series: ChartSeries<T>[];
  radius?: number;
  hoverRadius?: number;
  strokeWidth?: number;
  hoverStrokeWidth?: number;
  /** Tooltip width used to flip it left of the cursor near the viewport edge. */
  tooltipWidth?: number;
  onClick?: (d: T) => void;
  /** Optional timeline markers to draw as vertical dated lines. */
  markers?: Ref<MarkerInfo[]>;
  onMarkerClick?: (m: MarkerInfo) => void;
}

const NS = 'http://www.w3.org/2000/svg';

function positionTooltip(e: MouseEvent, width: number) {
  const offset = 12;
  const margin = 8;
  let x = e.clientX + offset + width > window.innerWidth - margin ? e.clientX - width - offset : e.clientX + offset;
  x = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
  const y = Math.max(margin, Math.min(e.clientY - 12, window.innerHeight - 160));
  return { x, y };
}

export function useChartMarkers<T>(
  containerRef: Ref<UnovisContainerRef | null>,
  data: Ref<T[]>,
  options: ChartMarkerOptions<T>,
) {
  const tooltipData = ref<T | null>(null) as Ref<T | null>;
  const tooltipPos = ref({ x: 0, y: 0 });
  const markerTooltip = ref<MarkerInfo | null>(null) as Ref<MarkerInfo | null>;
  const markerTooltipPos = ref({ x: 0, y: 0 });

  const radius = options.radius ?? 4.5;
  const hoverRadius = options.hoverRadius ?? radius + 2.5;
  const strokeWidth = options.strokeWidth ?? 1.5;
  const hoverStrokeWidth = options.hoverStrokeWidth ?? 2.5;
  const tooltipWidth = options.tooltipWidth ?? 260;

  function drawMarkerLines(svgNode: SVGSVGElement, margin: ChartMargin, xScale: (v: Date | number) => number) {
    const list = options.markers?.value ?? [];
    if (!list.length) return;

    const svgH = svgNode.clientHeight || svgNode.getBoundingClientRect().height;
    const svgW = svgNode.clientWidth || svgNode.getBoundingClientRect().width;
    const plotHeight = svgH - margin.top - margin.bottom;
    const plotWidth = svgW - margin.left - margin.right;
    if (plotHeight <= 0 || plotWidth <= 0) return;

    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'chart-marker-line');
    group.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    svgNode.appendChild(group);

    for (const marker of list) {
      const cx = xScale(new Date(marker.occurredAt));
      if (cx == null || Number.isNaN(cx) || cx < 0 || cx > plotWidth) continue;
      const color = getMarkerCategory(marker.category).hex;

      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(cx));
      line.setAttribute('x2', String(cx));
      line.setAttribute('y1', '0');
      line.setAttribute('y2', String(plotHeight));
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '4 3');
      line.setAttribute('opacity', '0.75');
      group.appendChild(line);

      // Clickable flag handle at the top of the line.
      const handle = document.createElementNS(NS, 'circle');
      handle.setAttribute('cx', String(cx));
      handle.setAttribute('cy', '0');
      handle.setAttribute('r', '4');
      handle.setAttribute('fill', color);
      handle.setAttribute('stroke', '#fff');
      handle.setAttribute('stroke-width', '1.5');
      handle.setAttribute('cursor', 'pointer');
      if (options.onMarkerClick) {
        handle.addEventListener('click', () => options.onMarkerClick!(marker));
      }
      handle.addEventListener('mouseenter', () => {
        handle.setAttribute('r', '6');
        line.setAttribute('opacity', '1');
        line.setAttribute('stroke-width', '2');
        markerTooltip.value = marker;
      });
      handle.addEventListener('mousemove', (e: MouseEvent) => {
        markerTooltipPos.value = positionTooltip(e, tooltipWidth);
      });
      handle.addEventListener('mouseleave', () => {
        handle.setAttribute('r', '4');
        line.setAttribute('opacity', '0.75');
        line.setAttribute('stroke-width', '1.5');
        markerTooltip.value = null;
      });
      group.appendChild(handle);
    }
  }

  function onRenderComplete(svgNode: SVGSVGElement, margin: ChartMargin) {
    svgNode.querySelectorAll('.chart-marker, .chart-marker-line').forEach((el) => el.remove());

    const comp = containerRef.value?.component?.components?.[0];
    const xScale = comp?.xScale;
    const yScale = comp?.yScale;
    if (!xScale) return;

    // Vertical timeline marker lines (independent of the data-point circles).
    drawMarkerLines(svgNode, margin, xScale);

    if (!yScale || !data.value.length) return;

    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'chart-marker');
    group.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    svgNode.appendChild(group);

    for (const point of data.value) {
      const cx = xScale(options.x(point));
      for (const s of options.series) {
        const yVal = s.y(point);
        if (yVal == null) continue;
        const cy = yScale(yVal);
        const color = typeof s.color === 'function' ? s.color(point) : s.color;

        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', String(strokeWidth));
        circle.setAttribute('cursor', 'pointer');
        if (options.onClick) {
          circle.addEventListener('click', () => options.onClick!(point));
        }
        circle.addEventListener('mouseenter', () => {
          circle.setAttribute('r', String(hoverRadius));
          circle.setAttribute('stroke-width', String(hoverStrokeWidth));
          tooltipData.value = point;
        });
        circle.addEventListener('mousemove', (e: MouseEvent) => {
          tooltipPos.value = positionTooltip(e, tooltipWidth);
        });
        circle.addEventListener('mouseleave', () => {
          circle.setAttribute('r', String(radius));
          circle.setAttribute('stroke-width', String(strokeWidth));
          tooltipData.value = null;
        });
        group.appendChild(circle);
      }
    }
  }

  return { tooltipData, tooltipPos, markerTooltip, markerTooltipPos, onRenderComplete };
}
