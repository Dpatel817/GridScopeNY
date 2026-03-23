/**
 * DraggableGrid — drop-in replacement for WidgetGrid that supports
 * drag-to-reorder and resize via react-grid-layout.
 */
import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { ResponsiveGridLayout } from 'react-grid-layout';
import type { Layout, Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;   // columns (out of 12)
  h: number;   // row units
  minH?: number;
  minW?: number;
  static?: boolean;
}

interface DraggableGridProps {
  /** Unique ID used for localStorage persistence */
  id: string;
  defaultLayout: GridItem[];
  children: React.ReactNode;
  rowHeight?: number;
}

const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
const LAYOUT_VERSION = '4'; // Increment to force reset

function storageKey(id: string) {
  return `gs-layout-${id}-v${LAYOUT_VERSION}`;
}

/**
 * Scale layout to different column counts while preventing overlaps
 */
function scaleLayoutToColumns(items: GridItem[], targetCols: number): Layout[] {
  // Sort by original y position, then x position
  const sorted = [...items].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
  
  const result: Layout[] = [];
  
  for (const item of sorted) {
    // Scale width proportionally, but ensure it fits
    const scaledW = Math.min(targetCols, Math.max(1, Math.round((item.w / 12) * targetCols)));
    
    // Try to maintain relative x position, but wrap if needed
    let x = Math.floor((item.x / 12) * targetCols);
    if (x + scaledW > targetCols) {
      x = 0; // Wrap to next row if it doesn't fit
    }
    
    // Find first available y position without collision
    let y = item.y;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
      const hasCollision = result.some(placed => {
        const xOverlap = x < placed.x + placed.w && x + scaledW > placed.x;
        const yOverlap = y < placed.y + placed.h && y + item.h > placed.y;
        return xOverlap && yOverlap;
      });
      
      if (!hasCollision) break;
      
      // Try next row
      y++;
      attempts++;
    }
    
    result.push({
      i: item.i,
      x,
      y,
      w: scaledW,
      h: item.h,
      minH: item.minH,
      minW: item.minW ? Math.max(1, Math.round((item.minW / 12) * targetCols)) : undefined,
      static: item.static,
    });
  }
  
  return result;
}

/**
 * Build responsive layouts for all breakpoints
 */
function buildResponsiveLayouts(defaultLayout: GridItem[]): Layouts {
  return {
    lg: scaleLayoutToColumns(defaultLayout, COLS.lg),
    md: scaleLayoutToColumns(defaultLayout, COLS.md),
    sm: scaleLayoutToColumns(defaultLayout, COLS.sm),
    xs: scaleLayoutToColumns(defaultLayout, COLS.xs),
    xxs: scaleLayoutToColumns(defaultLayout, COLS.xxs),
  };
}

/**
 * Load layouts from localStorage or use default
 */
function loadLayouts(id: string, defaultLayout: GridItem[]): Layouts {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (raw) {
      const saved = JSON.parse(raw) as Layouts;
      
      // Validate saved layout has all required widgets
      const currentKeys = new Set(defaultLayout.map(i => i.i));
      const savedLg = saved.lg || [];
      const savedKeys = new Set(savedLg.map((i: Layout) => i.i));
      
      // Check if layouts match (same widgets, no extras)
      const hasAllWidgets = [...currentKeys].every(k => savedKeys.has(k));
      const noExtraWidgets = [...savedKeys].every(k => currentKeys.has(k));
      
      if (hasAllWidgets && noExtraWidgets) {
        return saved;
      }
    }
  } catch (e) {
    console.warn('Failed to load saved layout:', e);
  }
  
  // Return clean default layout
  return buildResponsiveLayouts(defaultLayout);
}

export default function DraggableGrid({
  id,
  defaultLayout,
  children,
  rowHeight = 60,
}: DraggableGridProps) {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  // Load initial layouts
  const initialLayouts = useMemo(
    () => loadLayouts(id, defaultLayout),
    [id, defaultLayout]
  );

  const [layouts, setLayouts] = useState<Layouts>(initialLayouts);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(w);
      }
    });
    ro.observe(el);
    // Initial measurement
    const w = el.getBoundingClientRect().width;
    if (w > 0) setContainerWidth(w);
    return () => ro.disconnect();
  }, []);

  // Mark as mounted to prevent SSR issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Save layout changes to localStorage
  const handleLayoutChange = useCallback(
    (_currentLayout: Layout[], allLayouts: Layouts) => {
      if (!mounted) return;
      try {
        localStorage.setItem(storageKey(id), JSON.stringify(allLayouts));
        setLayouts(allLayouts);
      } catch (e) {
        console.warn('Failed to save layout:', e);
      }
    },
    [id, mounted]
  );

  if (!mounted) {
    return <div className="draggable-grid-wrapper" ref={containerRef} />;
  }

  return (
    <div className="draggable-grid-wrapper" ref={containerRef}>
      <ResponsiveGridLayout
        className="draggable-grid"
        layouts={layouts}
        cols={COLS}
        rowHeight={rowHeight}
        width={containerWidth}
        margin={[14, 14]}
        containerPadding={[0, 0]}
        draggableHandle=".widget-drag-handle"
        onLayoutChange={handleLayoutChange}
        resizeHandles={['se']}
        compactType="vertical"
        preventCollision={false}
        isDraggable={true}
        isResizable={true}
        useCSSTransforms={true}
        autoSize={true}
      >
        {children}
      </ResponsiveGridLayout>
    </div>
  );
}
