import { useRef, useState, type PointerEvent } from 'react';
import type { SelectionRect } from '../../lib/chartSelection';
import { useStore } from '../../store/useStore';

type Point = [number, number];

function pointerInChart(event: PointerEvent<HTMLDivElement>): Point {
  const node = event.currentTarget;
  const bounds = node.getBoundingClientRect();
  return [(event.clientX - bounds.left) * node.clientWidth / bounds.width,
    (event.clientY - bounds.top) * node.clientHeight / bounds.height];
}

function withinGrid([x, y]: Point, grid: SelectionRect): Point {
  return [Math.max(grid.x, Math.min(x, grid.x + grid.width)), Math.max(grid.y, Math.min(y, grid.y + grid.height))];
}

function rectangle(start: Point, [x, y]: Point): SelectionRect {
  return { x: Math.min(start[0], x), y: Math.min(start[1], y), width: Math.abs(start[0] - x), height: Math.abs(start[1] - y) };
}

export function ChartSelectionLayer({ chartId, choosing, getGrid, onSelect }: {
  chartId: string;
  choosing: boolean;
  getGrid: () => SelectionRect | undefined;
  onSelect: (rect: SelectionRect) => void;
}) {
  const selected = useStore((state) => state.activeChartId === chartId && state.dataSelection?.chartId === chartId
    ? state.dataSelection.rect : undefined);
  const [preview, setPreview] = useState<SelectionRect>();
  const drag = useRef<{ pointer: number; start: Point; grid: SelectionRect } | null>(null);
  const finish = () => {
    drag.current = null;
    setPreview(undefined);
  };
  const shown = (choosing && preview) || selected;

  return (
    <>
      {shown && <div aria-hidden="true" data-selection-rectangle="true"
        className="pointer-events-none absolute z-[11] border border-accent bg-accent/10"
        style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }} />}
      {choosing && <div aria-hidden="true" data-selection-layer="true"
        className="absolute inset-0 z-[12] cursor-crosshair touch-none select-none"
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          const grid = getGrid();
          if (!grid || grid.width <= 0 || grid.height <= 0) return;
          const start = withinGrid(pointerInChart(event), grid);
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, start, grid };
          const state = useStore.getState();
          state.setActiveChart(chartId);
          setPreview(rectangle(start, start));
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (active?.pointer === event.pointerId) setPreview(rectangle(active.start, withinGrid(pointerInChart(event), active.grid)));
        }}
        onPointerUp={(event) => {
          const active = drag.current;
          if (active?.pointer !== event.pointerId) return;
          const area = rectangle(active.start, withinGrid(pointerInChart(event), active.grid));
          finish();
          const state = useStore.getState();
          if (area.width < 3 || area.height < 3) state.setDataSelection(null);
          else {
            onSelect(area);
            state.setTool('select');
          }
        }}
        onLostPointerCapture={finish} />}
    </>
  );
}
