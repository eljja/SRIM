import React, { useEffect, useRef, useState } from 'react';
import {
  RotateCcw,
  Box,
  Move,
  Orbit,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Camera,
} from 'lucide-react';
import type {
  TransmittedIonRecord,
  TrimLayerConfig,
  TrimTrajectory,
} from '../physics/types';

interface TrajectoryViewer3DProps {
  layers: TrimLayerConfig[];
  trajectories: TrimTrajectory[];
  stoppedIons?: TransmittedIonRecord[];
  maxDepthA: number;
}

type ProjectionView = '3D' | 'XY' | 'XZ' | 'YZ';
type DragMode = 'orbit' | 'pan';

const RECOIL_COLORS = [
  '#f97316', // orange-500
  '#ec4899', // pink-500
  '#eab308', // yellow-500
  '#a855f7', // purple-500
  '#14b8a6', // teal-500
];

/** Chooses a clean 1-2-5 physical scale bar length in Angstroms spanning ~70-150 screen pixels. */
function chooseScaleBar(pxPerA: number): { lengthA: number; px: number; label: string } {
  const safePxPerA = Math.max(1e-6, pxPerA);
  const targetA = 110 / safePxPerA;
  const exp = Math.floor(Math.log10(targetA));
  const base = Math.pow(10, exp);
  const ratio = targetA / base;
  const nice = ratio >= 5 ? 5 : ratio >= 2 ? 2 : 1;
  const lengthA = nice * base;
  const px = lengthA * safePxPerA;

  let label: string;
  if (lengthA >= 10000) {
    const um = lengthA / 10000;
    label = `${um >= 10 ? um.toFixed(0) : Number(um.toFixed(2))} μm`;
  } else if (lengthA >= 10) {
    const nm = lengthA / 10;
    label = `${nm >= 10 ? nm.toFixed(0) : Number(nm.toFixed(2))} nm`;
  } else {
    label = `${lengthA >= 1 ? Number(lengthA.toFixed(2)) : Number(lengthA.toFixed(3))} Å`;
  }
  return { lengthA, px, label };
}

export const TrajectoryViewer3D: React.FC<TrajectoryViewer3DProps> = ({
  layers,
  trajectories,
  stoppedIons = [],
  maxDepthA,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<ProjectionView>('3D');
  const [dragMode, setDragMode] = useState<DragMode>('orbit');
  const [showIons, setShowIons] = useState<boolean>(true);
  const [showRecoils, setShowRecoils] = useState<boolean>(true);
  const [showStoppedMarkers, setShowStoppedMarkers] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // Camera spherical coordinates, unlimited zoom, and 2D screen-space pan (in pixels divided by zoom)
  const [yaw, setYaw] = useState<number>(-0.48);
  const [pitch, setPitch] = useState<number>(0.32);
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffsetPx, setPanOffsetPx] = useState<[number, number]>([0, 0]);
  const [focusIonIdx, setFocusIonIdx] = useState<number>(0);
  const dragRef = useRef<{
    active: boolean;
    mode: DragMode;
    lastX: number;
    lastY: number;
  }>({
    active: false,
    mode: 'orbit',
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
    const height = canvas.clientHeight || 468;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background gradient
    const bgGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.44,
      20,
      width * 0.5,
      height * 0.44,
      width * 0.72
    );
    bgGrad.addColorStop(0, '#091326');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const depthMax = Math.max(10, maxDepthA);
    const halfSpan = depthMax * 0.5;
    // 1.2x taller viewport & shifted center slightly upward so bottom legend never overlaps tracks/box
    const usableHeight = Math.max(180, height - 52);
    const baseScale = Math.min(width, usableHeight) * 0.64;
    const scale = baseScale * zoom;
    const cx = width * 0.5 + panOffsetPx[0];
    const cy = usableHeight * 0.48 + panOffsetPx[1];

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    // Project 3D point (xA in [0, depthMax], yA, zA) to 2D canvas
    const projectPoint = (xA: number, yA: number, zA: number): [number, number] => {
      const nx = xA / depthMax - 0.5;
      const ny = yA / depthMax;
      const nz = zA / depthMax;

      if (viewMode === 'XY') {
        return [cx + nx * scale * 1.2, cy + ny * scale * 1.2];
      }
      if (viewMode === 'XZ') {
        return [cx + nx * scale * 1.2, cy - nz * scale * 1.2];
      }
      if (viewMode === 'YZ') {
        return [cx + ny * scale * 1.2, cy - nz * scale * 1.2];
      }

      const rx = nx * cosY - ny * sinY;
      const ry0 = nx * sinY + ny * cosY;
      const ry = nz * cosP - ry0 * sinP;
      const rz = nz * sinP + ry0 * cosP;

      // Keep local perspective bounded smoothly even under extreme zooms (>100x)
      const persp = 2.4 / Math.max(0.75, 2.4 - Math.max(-1.5, Math.min(1.5, rz)) * 0.55);
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
      const s = halfSpan * 0.7;

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

      if (zoom < 12) {
        const [lx, ly] = projectPoint(0.5 * (x0 + x1), -s, s);
        ctx.fillStyle = layerPalette[idx % layerPalette.length];
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#bae6fd';
        ctx.fillText(
          `L${idx + 1}: ${layer.name} (${x0}–${x1} Å)`,
          lx - 35,
          ly - 8
        );
      }
    });

    // Central Beam Axis (Y=0, Z=0, X=0..depthMax)
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

    // Incident Ion Beam Entry Marker at (0, 0, 0)
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
          ctx.lineWidth = zoom >= 15 ? 1.4 : 1.0;
          ctx.globalAlpha = zoom >= 15 ? 0.8 : 0.65;
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

    // 3. Draw Primary Ion Trajectories + Single-Ion Resolution Vertices/Endpoints at High Zoom
    const detailedVertices = zoom >= 12;
    const detailedIonLabels = zoom >= 25;

    if (showIons) {
      for (const traj of trajectories) {
        if (traj.points.length < 2) continue;
        ctx.strokeStyle =
          traj.fate === 'backscattered'
            ? '#fbbf24'
            : traj.fate === 'transmitted'
            ? '#c084fc'
            : '#22d3ee';
        ctx.lineWidth = zoom >= 12 ? 2.0 : 1.45;
        ctx.globalAlpha = 0.88;
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

        // Draw atomic scattering nodes when zoomed into microscopic / single-ion scale
        if (detailedVertices) {
          ctx.fillStyle = '#38bdf8';
          for (let k = 0; k < traj.points.length; k++) {
            const pt = traj.points[k];
            const [vx, vy] = projectPoint(pt.xA, pt.yA, pt.zA);
            if (vx >= -20 && vx <= width + 20 && vy >= -20 && vy <= height + 20) {
              ctx.beginPath();
              ctx.arc(vx, vy, 2.0, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        // Draw Stopped Ion Endpoint Dot (+ atomic crosshair & coordinate tag when zoomed in)
        if (showStoppedMarkers && traj.fate === 'stopped') {
          const last = traj.points[traj.points.length - 1];
          const [ex, ey] = projectPoint(last.xA, last.yA, last.zA);
          const dotRadius = detailedVertices ? 4.2 : 2.3;
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.arc(ex, ey, dotRadius, 0, Math.PI * 2);
          ctx.fill();

          if (detailedVertices && ex >= -10 && ex <= width + 10 && ey >= -10 && ey <= height + 10) {
            ctx.strokeStyle = '#6ee7b7';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(ex - 8, ey);
            ctx.lineTo(ex + 8, ey);
            ctx.moveTo(ex, ey - 8);
            ctx.lineTo(ex, ey + 8);
            ctx.stroke();

            if (detailedIonLabels) {
              ctx.font = '600 10px monospace';
              ctx.fillStyle = '#a7f3d0';
              ctx.fillText(
                `#${traj.ionNumber} (${last.xA.toFixed(1)}, ${last.yA.toFixed(1)}, ${last.zA.toFixed(1)} Å)`,
                ex + 10,
                ey + 3
              );
            }
          }
        }
      }
      ctx.globalAlpha = 1.0;
    }

    // 3b. Draw Reservoir-Sampled Stopped Ion 3D Point Cloud (continues updating cleanly from 1k -> 10k -> 1M and in WebGPU mode)
    if (showStoppedMarkers && stoppedIons.length > 0) {
      const dotRadius = detailedVertices ? 4.0 : stoppedIons.length > 1000 ? 1.8 : 2.3;
      ctx.fillStyle = '#34d399';
      ctx.globalAlpha = stoppedIons.length > 1000 ? 0.72 : 0.9;
      for (let i = 0; i < stoppedIons.length; i++) {
        const s = stoppedIons[i];
        const [ex, ey] = projectPoint(s.xA, s.yA, s.zA);
        if (ex < -15 || ex > width + 15 || ey < -15 || ey > height + 15) continue;
        ctx.beginPath();
        ctx.arc(ex, ey, dotRadius, 0, Math.PI * 2);
        ctx.fill();
        if (detailedVertices) {
          ctx.strokeStyle = '#6ee7b7';
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.moveTo(ex - 7, ey);
          ctx.lineTo(ex + 7, ey);
          ctx.moveTo(ex, ey - 7);
          ctx.lineTo(ex, ey + 7);
          ctx.stroke();
          if (detailedIonLabels) {
            ctx.font = '600 10px monospace';
            ctx.fillStyle = '#a7f3d0';
            ctx.fillText(
              `#${s.ionNumber} (${s.xA.toFixed(1)}, ${s.yA.toFixed(1)}, ${s.zA.toFixed(1)} Å)`,
              ex + 9,
              ey + 3
            );
          }
        }
      }
      ctx.globalAlpha = 1.0;
    }

    // 4. Physical Scale Bar & Magnification HUD (Top-Left, clear of bottom legend)
    const effectiveScaleFactor = viewMode === '3D' ? scale : scale * 1.2;
    const pxPerA = effectiveScaleFactor / depthMax;
    const bar = chooseScaleBar(pxPerA);

    const sbX = 16;
    const sbY = 24;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1;
    const boxW = Math.max(bar.px + 28, 128);
    ctx.beginPath();
    ctx.roundRect(sbX - 8, sbY - 14, boxW, 40, 8);
    ctx.fill();
    ctx.stroke();

    // Scale bar bracket line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(sbX, sbY + 10);
    ctx.lineTo(sbX, sbY + 16);
    ctx.lineTo(sbX + bar.px, sbY + 16);
    ctx.lineTo(sbX + bar.px, sbY + 10);
    ctx.stroke();

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText(bar.label, sbX, sbY + 2);

    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    const zoomLabel = zoom >= 100 ? `${zoom.toFixed(0)}×` : `${zoom.toFixed(zoom >= 10 ? 1 : 2)}×`;
    ctx.fillText(`Zoom ${zoomLabel}`, sbX + bar.px + 8 > sbX + boxW - 56 ? sbX + 54 : sbX + bar.px + 8, sbY + 2);
    ctx.restore();

    ctx.restore();
  }, [
    layers,
    trajectories,
    stoppedIons,
    maxDepthA,
    viewMode,
    showIons,
    showRecoils,
    showStoppedMarkers,
    yaw,
    pitch,
    zoom,
    panOffsetPx,
  ]);

  const handleFocusSingleIon = () => {
    let lastPt: { xA: number; yA: number; zA: number } | null = null;
    if (stoppedIons.length > 0) {
      const s = stoppedIons[focusIonIdx % stoppedIons.length];
      lastPt = { xA: s.xA, yA: s.yA, zA: s.zA };
      setFocusIonIdx((prev) => prev + 1);
    } else {
      const stoppedTrajs = trajectories.filter(
        (t) => t.fate === 'stopped' && t.points.length > 0
      );
      const pool = stoppedTrajs.length > 0 ? stoppedTrajs : trajectories;
      if (pool.length === 0) return;
      const idx = focusIonIdx % pool.length;
      setFocusIonIdx((prev) => prev + 1);
      const targetTraj = pool[idx];
      lastPt = targetTraj.points[targetTraj.points.length - 1];
    }
    if (!lastPt) return;

    const canvas = canvasRef.current;
    const width = canvas?.clientWidth || 720;
    const height = canvas?.clientHeight || 468;
    const usableHeight = Math.max(180, height - 52);
    const depthMax = Math.max(10, maxDepthA);
    const baseScale = Math.min(width, usableHeight) * 0.64;

    // Target magnification showing ~25 A field of view around the single stopped ion
    const targetZoom = Math.max(25, Math.min(2000, depthMax / 35.0));
    const scale = baseScale * targetZoom;

    const nx = lastPt.xA / depthMax - 0.5;
    const ny = lastPt.yA / depthMax;
    const nz = lastPt.zA / depthMax;

    let sx = 0;
    let sy = 0;
    if (viewMode === 'XY') {
      sx = nx * scale * 1.2;
      sy = ny * scale * 1.2;
    } else if (viewMode === 'XZ') {
      sx = nx * scale * 1.2;
      sy = -nz * scale * 1.2;
    } else if (viewMode === 'YZ') {
      sx = ny * scale * 1.2;
      sy = -nz * scale * 1.2;
    } else {
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const rx = nx * cosY - ny * sinY;
      const ry0 = nx * sinY + ny * cosY;
      const ry = nz * cosP - ry0 * sinP;
      const rz = nz * sinP + ry0 * cosP;
      const persp =
        2.4 / Math.max(0.75, 2.4 - Math.max(-1.5, Math.min(1.5, rz)) * 0.55);
      sx = rx * scale * persp;
      sy = -ry * scale * persp;
    }

    setAutoRotate(false);
    setZoom(targetZoom);
    setPanOffsetPx([-sx, -sy]);
  };

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
            {trajectories.length} Tracks · {stoppedIons.length.toLocaleString()} Dots
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
                {mode === '3D' ? '3D Orbit' : `${mode}`}
              </button>
            ))}
          </div>

          {/* Orbit vs Pan toggle */}
          <button
            onClick={() => setDragMode(dragMode === 'orbit' ? 'pan' : 'orbit')}
            title="Switch drag between 3D Orbit and XY Pan (or hold Shift while dragging to Pan)"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border ${
              dragMode === 'pan'
                ? 'bg-amber-950/70 border-amber-500/60 text-amber-200'
                : 'bg-slate-900 border-slate-800 text-slate-300'
            }`}
          >
            {dragMode === 'pan' ? (
              <>
                <Move className="w-3 h-3" />
                <span>Pan</span>
              </>
            ) : (
              <>
                <Orbit className="w-3 h-3" />
                <span>Orbit</span>
              </>
            )}
          </button>

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
            Recoils
          </button>

          <button
            onClick={() => setShowStoppedMarkers(!showStoppedMarkers)}
            className={`px-2 py-1 rounded text-[11px] font-medium border ${
              showStoppedMarkers
                ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            Dots
          </button>

          <button
            onClick={handleFocusSingleIon}
            disabled={trajectories.length === 0 && stoppedIons.length === 0}
            title="Zoom straight into an individual stopped ion atom (~25 Å FOV); click again to cycle ions"
            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-950/70 hover:bg-emerald-900/70 border border-emerald-500/50 text-emerald-200 text-[11px] font-semibold disabled:opacity-40"
          >
            <Crosshair className="w-3 h-3" />
            <span>Single Ion</span>
          </button>

          <button
            onClick={() => {
              const factor = 1.6;
              setZoom((z) => Math.min(5000, z * factor));
              setPanOffsetPx(([px, py]) => [px * factor, py * factor]);
            }}
            title="Zoom In (Atomic scale up to 5000x)"
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              const factor = 1 / 1.6;
              setZoom((z) => Math.max(0.15, z * factor));
              setPanOffsetPx(([px, py]) => [px * factor, py * factor]);
            }}
            title="Zoom Out"
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <ZoomOut className="w-3.5 h-3.5" />
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
            <span>PNG</span>
          </button>

          <button
            onClick={() => {
              setYaw(-0.48);
              setPitch(0.32);
              setZoom(1.0);
              setPanOffsetPx([0, 0]);
            }}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            title="Reset Camera & Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive Canvas: 1.2x taller (390 -> 468px) with reserved bottom legend zone */}
      <div className="relative h-[468px] w-full select-none">
        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => {
            const wantPan = dragMode === 'pan' || e.shiftKey || e.button === 2 || viewMode !== '3D';
            dragRef.current = {
              active: true,
              mode: wantPan ? 'pan' : 'orbit',
              lastX: e.clientX,
              lastY: e.clientY,
            };
          }}
          onMouseMove={(e) => {
            if (!dragRef.current.active) return;
            const dx = e.clientX - dragRef.current.lastX;
            const dy = e.clientY - dragRef.current.lastY;
            dragRef.current.lastX = e.clientX;
            dragRef.current.lastY = e.clientY;
            if (dragRef.current.mode === 'pan') {
              setPanOffsetPx(([px, py]) => [px + dx, py + dy]);
            } else {
              setYaw((y) => y + dx * 0.008);
              setPitch((p) =>
                Math.max(-1.45, Math.min(1.45, p + dy * 0.008))
              );
            }
          }}
          onMouseUp={() => {
            dragRef.current.active = false;
          }}
          onMouseLeave={() => {
            dragRef.current.active = false;
          }}
          onWheel={(e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
            const rect = e.currentTarget.getBoundingClientRect();
            const usableHeight = Math.max(180, rect.height - 52);
            // Zoom toward mouse cursor so users can drill straight into any ion or collision
            const mx = e.clientX - rect.left - rect.width * 0.5;
            const my = e.clientY - rect.top - usableHeight * 0.48;
            const nextZoom = Math.max(0.15, Math.min(5000, zoom * factor));
            const appliedFactor = nextZoom / zoom;
            setZoom(nextZoom);
            setPanOffsetPx(([px, py]) => [
              mx - (mx - px) * appliedFactor,
              my - (my - py) * appliedFactor,
            ]);
          }}
          className="w-full h-full cursor-grab active:cursor-grabbing block"
        />

        {/* Color Legend Overlay (sits cleanly inside reserved bottom 48px gutter) */}
        <div className="absolute bottom-2.5 left-3 right-3 flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 text-[10px] text-slate-300 pointer-events-none">
          <div className="flex flex-wrap items-center gap-3">
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
              Recoil Cascade
            </span>
          </div>
          <span className="text-slate-400">
            Drag: Orbit · Shift/Right-Drag: Pan · Scroll: Zoom to single atom
          </span>
        </div>
      </div>
    </div>
  );
};
