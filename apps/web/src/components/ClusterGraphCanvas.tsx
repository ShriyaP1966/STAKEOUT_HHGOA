"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { GRAPH_ROLES, ROLE_COLOR_VARS, ROLE_LABELS, type ClusterGraph, type GraphRole } from "@/lib/graph";

type GraphNode = { id: string; role: GraphRole };
type GraphLink = { source: string; target: string };
type Palette = Record<GraphRole, string> & { line: string; ring: string };

const CANVAS_HEIGHT = 480;
const NODE_RADIUS: Record<GraphRole, number> = { member: 7, exit_point: 9, counterparty: 5 };

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const roles = Object.fromEntries(GRAPH_ROLES.map((role) => [role, read(ROLE_COLOR_VARS[role])])) as Record<GraphRole, string>;
  return { ...roles, line: read("--line-strong"), ring: read("--surface") };
}

function usePalette(): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    const update = () => setPalette(readPalette());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export default function ClusterGraphCanvas({ graph }: { graph: ClusterGraph }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined);
  const width = useWidth(containerRef);
  const palette = usePalette();
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((node): GraphNode => ({ id: node.id.toLowerCase(), role: node.role })),
      links: graph.edges.map((edge): GraphLink => ({ source: edge.src.toLowerCase(), target: edge.tgt.toLowerCase() })),
    }),
    [graph],
  );

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-md border border-line bg-surface-2" style={{ height: CANVAS_HEIGHT }}>
      {palette && width > 0 && (
        <ForceGraph2D<GraphNode, GraphLink>
          ref={graphRef}
          graphData={data}
          width={width}
          height={CANVAS_HEIGHT}
          backgroundColor="rgba(0,0,0,0)"
          nodeLabel={(node) => `${ROLE_LABELS[node.role]}: ${node.id}`}
          nodeCanvasObject={(node, context) => {
            const radius = NODE_RADIUS[node.role];
            context.beginPath();
            context.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
            context.fillStyle = palette[node.role];
            context.fill();
            context.lineWidth = 1.5;
            context.strokeStyle = palette.ring;
            context.stroke();
          }}
          nodePointerAreaPaint={(node, color, context) => {
            context.beginPath();
            context.arc(node.x ?? 0, node.y ?? 0, NODE_RADIUS[node.role] + 2, 0, 2 * Math.PI);
            context.fillStyle = color;
            context.fill();
          }}
          linkColor={() => palette.line}
          linkWidth={1.2}
          linkDirectionalArrowLength={5}
          linkDirectionalArrowRelPos={0.92}
          linkDirectionalArrowColor={() => palette.line}
          cooldownTicks={120}
          onEngineStop={() => graphRef.current?.zoomToFit(400, 40)}
        />
      )}
    </div>
  );
}
