interface WidgetGridProps {
  children: React.ReactNode;
}

/**
 * A 12-column CSS grid container.
 * Widgets declare their own column span via the widget-{size} class.
 */
export default function WidgetGrid({ children }: WidgetGridProps) {
  return <div className="widget-grid">{children}</div>;
}
