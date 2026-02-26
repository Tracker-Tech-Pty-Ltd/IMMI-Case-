import { memo, useMemo, useRef, useState, useEffect } from "react";
import { Sankey, Tooltip, Rectangle, Layer } from "recharts";
import { useTranslation } from "react-i18next";
import type { FlowMatrixData } from "@/types/case";

const LAYER_LABELS: Record<string, string> = {
  court: "Court",
  nature: "Case Nature",
  outcome: "Outcome",
};

const LAYER_COLORS: Record<string, string> = {
  court: "var(--color-primary)",
  nature: "var(--color-accent)",
  outcome: "var(--color-success, #22c55e)",
};

interface FlowSankeyChartProps {
  data: FlowMatrixData;
}

function SankeyNode({
  x,
  y,
  width,
  height,
  index,
  payload,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: { name: string; layer?: string };
}) {
  const layer = payload.layer ?? "court";
  return (
    <Layer key={`node-${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={LAYER_COLORS[layer] ?? "var(--color-muted)"}
        fillOpacity={0.85}
      />
      {height > 14 && (
        <text
          x={x + width + 6}
          y={y + height / 2}
          textAnchor="start"
          dominantBaseline="middle"
          fontSize={11}
          fill="var(--color-text, currentColor)"
        >
          {payload.name}
        </text>
      )}
    </Layer>
  );
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(700);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function FlowSankeyChartInner({ data }: FlowSankeyChartProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);
  const isEmpty = !data.nodes.length || !data.links.length;
  const [showTable, setShowTable] = useState(false);

  const layers = useMemo(() => {
    const seen = new Set<string>();
    for (const node of data.nodes) {
      if (node.layer) seen.add(node.layer);
    }
    return Array.from(seen);
  }, [data.nodes]);

  if (isEmpty) {
    return (
      <div
        data-testid="flow-sankey-chart"
        className="py-12 text-center text-muted-text"
      >
        <p data-testid="flow-sankey-empty">
          {t("analytics.no_flow_data", {
            defaultValue: "No flow data available",
          })}
        </p>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={t("analytics.flow_sankey_aria", {
        defaultValue: "Flow diagram showing case nature and outcome distribution",
      })}
      data-testid="flow-sankey-chart"
      ref={containerRef}
      className="space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex justify-between px-4 text-xs font-medium text-muted-text gap-8">
          {layers.map((layer) => (
            <span key={layer}>{LAYER_LABELS[layer] ?? layer}</span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="text-xs rounded border border-border px-2 py-0.5 text-muted-text hover:text-foreground"
        >
          {showTable
            ? t("analytics.sankey_view", { defaultValue: "Flow View" })
            : t("analytics.table_view", { defaultValue: "Table View" })}
        </button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-text">
                <th className="p-2 text-left">
                  {t("analytics.flow_source", { defaultValue: "Source" })}
                </th>
                <th className="p-2 text-left">
                  {t("analytics.flow_target", { defaultValue: "Target" })}
                </th>
                <th className="p-2 text-right">
                  {t("analytics.flow_cases", { defaultValue: "Cases" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.links
                .toSorted((a, b) => b.value - a.value)
                .slice(0, 20)
                .map((link, i) => (
                  <tr key={i} className="border-b border-border-light/40">
                    <td className="p-2">
                      {typeof link.source === "number"
                        ? (data.nodes[link.source]?.name ?? String(link.source))
                        : String(link.source)}
                    </td>
                    <td className="p-2">
                      {typeof link.target === "number"
                        ? (data.nodes[link.target]?.name ?? String(link.target))
                        : String(link.target)}
                    </td>
                    <td className="p-2 text-right">
                      {link.value.toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Sankey
            width={Math.max(containerWidth, 300)}
            height={400}
            data={{ nodes: data.nodes, links: data.links }}
            node={
              <SankeyNode
                x={0}
                y={0}
                width={0}
                height={0}
                index={0}
                payload={{ name: "" }}
              />
            }
            link={{ stroke: "var(--color-primary)", opacity: 0.3 }}
            margin={{ top: 10, right: 120, bottom: 10, left: 10 }}
          >
            <Tooltip />
          </Sankey>
        </div>
      )}
    </div>
  );
}

export const FlowSankeyChart = memo(FlowSankeyChartInner);
