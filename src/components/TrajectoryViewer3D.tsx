import React, { useEffect, useRef, useState } from 'react';
import {
  RotateCcw,
  Eye,
  Box,
  Grid,
  Maximize2,
  Camera,
} from 'lucide-react';
import type { TrimLayerConfig, TrimTrajectory } from '../physics/types';

interface TrajectoryViewer3DProps {
  layers: TrimLayerConfig[];
  trajectories: TrimTrajectory[];
  maxDepthA: number;
}

type ProjectionView = '3D' | 'XY' | 'XZ' | 'YZ';

const RECOIL_COLORS = [
  '#f97316', // orange-500
  '#ec4899', // pink-500
  '#eab308', // yellow-500
  '#a855f7', // purple-500
  '#14b8a6', // teal-500
];

export const TrajectoryViewer3D: React.FC<TrajectoryViewer3DProps> = ({
  layers,
  trajectories,
  maxDepthA,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<ProjectionView>('3D');
  const [showIons, setShowIons] = useState<boolean>(true);
  const [showRecoils, setShowRecoils] = useState<boolean>(true);
  const [showStoppedMarkers, setShowStoppedMarkers] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // Camera spherical coordinates for 3D perspective projection
  const [yaw, setYaw] = useState<number>(-0.48);
  const [pitch, setPitch] = useState<number>(0.32);
  const [zoom, setZoom] = useState<number>(1.0);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    if (!autoRotate || viewMode !== '3D') return;
    let animId = 0;
    const tick = () => {
      setYaw((prev) => prev + 0.008);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [autoRotate, viewMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 720;
    const height = canvas.clientHeight || 420;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background gradient
    const bgGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      20,
      width * 0.5,
      height * 0.5,
      width * 0.7
    );
    bgGrad.addColorStop(0, '#091326');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const depthMax = Math.max(10, maxDepthA);
    const halfSpan = depthMax * 0.5;

    // Project 3D point (xA in [0, depthMax], yA, zA in [-halfSpan, halfSpan]) to 2D canvas
    const projectPoint = (xA: number, yA: number, zA: number): [number, number] => {
      // Normalized coordinates nx, ny, nz in [-0.5, 0.5]
      const nx = xA / depthMax - 0.5;
      const ny = yA / depthMax;
      const nz = zA / depthMax;
      const scale = Math.min(width, height) * 0.68 * zoom;
      const cx = width * 0.5;
      const cy = height * 0.52;

      if (viewMode === 'XY') {
        return [cx + nx * scale * 1.25, cy + ny * scale * 1.25];
      }
      if (viewMode === 'XZ') {
        return [cx + nx * scale * 1.25, cy - nz * scale * 1.25];
      }
      if (viewMode === 'YZ') {
        return [cx + ny * scale * 1.25, cy - nz * scale * 1.25];
      }

      // 3D Isometric / Perspective rotation with yaw & pitch
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);

      const rx = nx * cosY - ny * sinY;
      const ry0 = nx * sinY + ny * cosY;
      const ry = nz * cosP - ry0 * sinP;
      const rz = nz * sinP + ry0 * cosP;

      const persp = 2.4 / Math.max(0.8, 2.4 - rz * 0.65);
      return [cx + rx * scale * persp, cy - ry * scale * persp];
    };

    // 1. Draw Multi-Layer Target Bounding Box & Layer Interface Planes
    let cumDepth = 0;
    const layerPalette = [
      'rgba(14, 165, 233, 0.16)',
      'rgba(99, 102, 241, 0.16)',
      'rgba(16, 185, 129, 0.16)',
      'rgba(245, 158, 11, 0.16)',
    ];

    layers.forEach((layer, idx) => {
      const x0 = cumDepth;
      const x1 = cumDepth + layer.widthA;
      cumDepth = x1;
      const s = halfSpan * 0.72;

      // Draw wire box for layer slab [x0..x1] x [-s..s] x [-s..s]
      const corners: [number, number, number][] = [
        [x0, -s, -s],
        [x0, s, -s],
        [x0, s, s],
        [x0, -s, s],
        [x1, -s, -s],
        [x1, s, -s],
        [x1, s, s],
        [x1, -s, s],
      ];
      const pCorners = corners.map(([x, y, z]) => projectPoint(x, y, z));

      const edges = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ];
      ctx.strokeStyle =
        idx === 0 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of edges) {
        ctx.moveTo(pCorners[a][0], pCorners[a][1]);
        ctx.lineTo(pCorners[b][0], pCorners[b][1]);
      }
      ctx.stroke();

      // Layer label at top edge
      const [lx, ly] = projectPoint(0.5 * (x0 + x1), -s, s);
      ctx.fillStyle = layerPalette[idx % layerPalette.length];
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#bae6fd';
      ctx.fillText(
        `L${idx + 1}: ${layer.name} (${x0}–${x1} Å)`,
        lx - 35,
        ly - 8
      );
    });

    // Draw Central Beam Axis (Y=0, Z=0, X=0..depthMax)
    const [ax0, ay0] = projectPoint(0, 0, 0);
    const [ax1, ay1] = projectPoint(depthMax, 0, 0);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.beginPath();
    ctx.moveTo(ax0, ay0);
    ctx.lineTo(ax1, ay1);
    ctx.stroke();
    ctx.restore();

    // Draw Incident Ion Beam Entry Marker at (0, 0, 0)
    const [bx0, by0] = projectPoint(-depthMax * 0.08, 0, 0);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    ctx.lineTo(ax0, ay0);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(ax0, ay0, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 2. Draw Recoil Sub-Cascades
    if (showRecoils) {
      for (const traj of trajectories) {
        for (let rIdx = 0; rIdx < traj.recoils.length; rIdx++) {
          const rec = traj.recoils[rIdx];
          if (rec.points.length < 2) continue;
          ctx.strokeStyle = RECOIL_COLORS[rec.z2 % RECOIL_COLORS.length];
          ctx.lineWidth = 1.0;
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          const [rx0, ry0] = projectPoint(
            rec.points[0].xA,
            rec.points[0].yA,
            rec.points[0].zA
          );
          ctx.moveTo(rx0, ry0);
          for (let k = 1; k < rec.points.length; k++) {
            const [rx, ry] = projectPoint(
              rec.points[k].xA,
              rec.points[k].yA,
              rec.points[k].zA
            );
            ctx.lineTo(rx, ry);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1.0;
    }

    // 3. Draw Primary Ion Trajectories
    if (showIons) {
      for (const traj of trajectories) {
        if (traj.points.length < 2) continue;
        ctx.strokeStyle =
          traj.fate === 'backscattered'
            ? '#fbbf24'
            : traj.fate === 'transmitted'
            ? '#c084fc'
            : '#22d3ee';
        ctx.lineWidth = 1.45;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        const [px0, py0] = projectPoint(
          traj.points[0].xA,
          traj.points[0].yA,
          traj.points[0].zA
        );
        ctx.moveTo(px0, py0);
        for (let k = 1; k < traj.points.length; k++) {
          const [px, py] = projectPoint(
            traj.points[k].xA,
            traj.points[k].yA,
            traj.points[k].zA
          );
          ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Draw Stopped Ion Endpoint Dot
        if (showStoppedMarkers && traj.fate === 'stopped') {
          const last = traj.points[traj.points.length - 1];
          const [ex, ey] = projectPoint(last.xA, last.yA, last.zA);
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.arc(ex, ey, 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1.0;
    }

    ctx.restore();
  }, [
    layers,
    trajectories,
    maxDepthA,
    viewMode,
    showIons,
    showRecoils,
    showStoppedMarkers,
    yaw,
    pitch,
    zoom,
  ]);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
      {/* Viewer Toolbar */}
      <div className="px-4 py-2.5 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-white">
            3D Collision Cascade & Ion Trajectory Visualizer
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">
            {trajectories.length} Tracks Rendered
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Projection Switcher */}
          <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            {(['3D', 'XY', 'XZ', 'YZ'] as ProjectionView[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  viewMode === mode
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {mode === '3D' ? '3D Orbit' : `${mode} Plane`}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowIons(!showIons)}
            className={`px-2 py-1 rounded text-[11px] font-medium border ${
              showIons
                ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            Ions
          </button>

          <button
            onClick={() => setShowRecoils(!showRecoils)}
            className={`px-2 py-1 rounded text-[11px] font-medium border ${
              showRecoils
                ? 'bg-orange-950/70 border-orange-500/50 text-orange-200'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            Recoil Cascades
          </button>

          <button
            onClick={() => setShowStoppedMarkers(!showStoppedMarkers)}
            className={`px-2 py-1 rounded text-[11px] font-medium border ${
              showStoppedMarkers
                ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            Stopped Dots
          </button>

          {viewMode === '3D' && (
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={`px-2 py-1 rounded text-[11px] font-medium border ${
                autoRotate
                  ? 'bg-indigo-600 border-indigo-400 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Auto-Orbit
            </button>
          )}

          <button
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const a = document.createElement('a');
              a.href = canvas.toDataURL('image/png');
              a.download = `TRIM_3D_Trajectory_${viewMode}_${Date.now()}.png`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 font-medium border border-slate-700 transition-colors"
            title="Export High-Res PNG Screenshot"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Snapshot</span>
          </button>

          <button
            onClick={() => {
              setYaw(-0.48);
              setPitch(0.32);
              setZoom(1.0);
            }}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            title="Reset Camera View"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive Canvas */}
      <div className="relative h-[390px] w-full select-none">
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => {
            dragRef.current = {
              active: true,
              lastX: e.clientX,
              lastY: e.clientY,
            };
          }}
          onMouseMove={(e) => {
            if (!dragRef.current.active || viewMode !== '3D') return;
            const dx = e.clientX - dragRef.current.lastX;
            const dy = e.clientY - dragRef.current.lastY;
            dragRef.current.lastX = e.clientX;
            dragRef.current.lastY = e.clientY;
            setYaw((y) => y + dx * 0.008);
            setPitch((p) =>
              Math.max(-1.3, Math.min(1.3, p + dy * 0.008))
            );
          }}
          onMouseUp={() => {
            dragRef.current.active = false;
          }}
          onMouseLeave={() => {
            dragRef.current.active = false;
          }}
          onWheel={(e) => {
            e.preventDefault();
            setZoom((z) =>
              Math.max(0.4, Math.min(3.0, z * (e.deltaY < 0 ? 1.1 : 0.9)))
            );
          }}
          className="w-full h-full cursor-grab active:cursor-grabbing block"
        />

        {/* Color Legend Overlay */}
        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-950/85 border border-slate-800 text-[10px] text-slate-300 pointer-events-none">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
            Ion Track
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
            Stopped Ion
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            Backscattered
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block" />
            Transmitted
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
            Target Recoil Cascade
          </span>
          <span className="text-slate-500 ml-2">
            Drag to rotate 3D · Scroll to zoom
          </span>
        </div>
      </div>
    </div>
  );
};
