import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Download, Sliders, Layers, Eye } from 'lucide-react';
import type { TrimSetupConfig, TrimSnapshot } from '../physics/types';

interface ContourMap2DProps {
  snapshot: TrimSnapshot;
  config: TrimSetupConfig;
}

type ColorMapType = 'turbo' | 'viridis' | 'plasma';
type AxisMode = 'xy' | 'xr'; // X vs Y (Lateral) or X vs R (Radial)

// Colormap lookup approximations (t in [0, 1])
function getColor(t: number, map: ColorMapType): [number, number, number] {
  const clampT = Math.max(0, Math.min(1, t));
  if (map === 'turbo') {
    // Google Turbo colormap polynomial fit
    const r = Math.sin(Math.PI * (clampT * 1.5 - 0.5)) * 127 + 128;
    const g = Math.sin(Math.PI * (clampT * 1.5 - 0.1)) * 127 + 128;
    const b = Math.sin(Math.PI * (clampT * 1.5 + 0.3)) * 127 + 128;
    return [Math.round(r), Math.round(g), Math.round(b)];
  } else if (map === 'viridis') {
    // Viridis: deep purple -> teal -> yellow
    const r = Math.round(255 * (0.2 + 0.8 * Math.pow(clampT, 2)));
    const g = Math.round(255 * (0.1 + 0.85 * clampT));
    const b = Math.round(255 * (0.4 + 0.5 * (1 - clampT)));
    return [r, g, b];
  } else {
    // Plasma: dark blue -> violet -> orange -> yellow
    const r = Math.round(255 * Math.pow(clampT, 0.7));
    const g = Math.round(255 * Math.pow(clampT, 1.8));
    const b = Math.round(255 * (0.6 * (1 - clampT) + 0.2));
    return [r, g, b];
  }
}

export const ContourMap2D: React.FC<ContourMap2DProps> = ({ snapshot, config }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState<number>(840);
  const canvasHeight = 660; // 1.5x of previous 440px height
  const [colormap, setColormap] = useState<ColorMapType>('turbo');
  const [axisMode, setAxisMode] = useState<AxisMode>('xy');
  const [showContours, setShowContours] = useState<boolean>(true);
  const [hoverCoord, setHoverCoord] = useState<{ xA: number; yA: number; val: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 240) setCanvasWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridSize = 64;

  // Compute 2D density grid from stopped ion coordinates
  const { grid, maxVal, maxDepthA, maxLatA } = useMemo(() => {
    const maxX = Math.max(100, config.plotXMaxA || 1000);
    let maxL = 50;

    // Determine lateral bound
    const lats = axisMode === 'xy'
      ? snapshot.stoppedIons.map((i) => Math.abs(i.yA))
      : snapshot.stoppedIons.map((i) => Math.sqrt(i.yA * i.yA + i.zA * i.zA));

    if (lats.length > 0) {
      const sorted = [...lats].sort((a, b) => a - b);
      // 95th percentile lateral bound with margin
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 50;
      maxL = Math.max(30, Math.ceil(p95 * 1.3));
    }

    const arr: number[][] = Array.from({ length: gridSize }, () =>
      new Array<number>(gridSize).fill(0)
    );

    const minL = axisMode === 'xy' ? -maxL : 0;
    const rangeL = axisMode === 'xy' ? 2 * maxL : maxL;

    for (const ion of snapshot.stoppedIons) {
      const latVal = axisMode === 'xy' ? ion.yA : Math.sqrt(ion.yA * ion.yA + ion.zA * ion.zA);
      const ix = Math.floor((ion.xA / maxX) * gridSize);
      const iy = Math.floor(((latVal - minL) / rangeL) * gridSize);
      if (ix >= 0 && ix < gridSize && iy >= 0 && iy < gridSize) {
        arr[iy][ix] += 1;
      }
    }

    // Apply 3x3 Gaussian blur to smooth the discrete ion impacts into continuous density
    const smooth: number[][] = Array.from({ length: gridSize }, () =>
      new Array<number>(gridSize).fill(0)
    );
    let peak = 0;

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        let sum = 0;
        let wSum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize) {
              const weight = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
              sum += arr[ny][nx] * weight;
              wSum += weight;
            }
          }
        }
        const val = sum / wSum;
        smooth[y][x] = val;
        if (val > peak) peak = val;
      }
    }

    return { grid: smooth, maxVal: Math.max(1e-4, peak), maxDepthA: maxX, maxLatA: maxL };
  }, [snapshot.stoppedIons, config.plotXMaxA, axisMode]);

  // Render on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Compact horizontal pads so the heatmap fills the plot box edge-to-edge
    const padL = 56;
    const padR = 14;
    const padT = 22;
    const padB = 42;
    const pw = w - padL - padR;
    const ph = h - padT - padB;

    // Draw background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(padL, padT, pw, ph);

    // Draw density heatmap cells
    const cellW = pw / gridSize;
    const cellH = ph / gridSize;

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const val = grid[y][x];
        const norm = val / maxVal;
        if (norm > 0.005) {
          const [r, g, b] = getColor(norm, colormap);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(padL + x * cellW, padT + y * cellH, cellW + 0.5, cellH + 0.5);
        }
      }
    }

    // Draw contour isolines if enabled
    if (showContours && maxVal > 0) {
      ctx.lineWidth = 1.2;
      const levels = [0.15, 0.35, 0.6, 0.85];
      for (const lvl of levels) {
        ctx.strokeStyle = lvl >= 0.6 ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';
        for (let y = 0; y < gridSize - 1; y++) {
          for (let x = 0; x < gridSize - 1; x++) {
            const v00 = grid[y][x] / maxVal;
            const v10 = grid[y][x + 1] / maxVal;
            const v01 = grid[y + 1][x] / maxVal;
            // Simple marching squares segment approximation
            if ((v00 < lvl && v10 >= lvl) || (v00 >= lvl && v10 < lvl)) {
              const cx = padL + (x + 0.5) * cellW;
              const cy = padT + (y + 0.5) * cellH;
              ctx.beginPath();
              ctx.arc(cx, cy, 1, 0, 2 * Math.PI);
              ctx.stroke();
            }
          }
        }
      }
    }

    // Draw target layer boundary lines
    let curD = 0;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#94a3b8';

    for (const l of config.layers) {
      curD += l.widthA;
      if (curD < maxDepthA) {
        const lx = padL + (curD / maxDepthA) * pw;
        ctx.beginPath();
        ctx.moveTo(lx, padT);
        ctx.lineTo(lx, padT + ph);
        ctx.stroke();
        ctx.fillText(l.name, lx - 20, padT - 8);
      }
    }
    ctx.setLineDash([]);

    // Draw Border and Axes
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padL, padT, pw, ph);

    // X Axis Ticks & Labels (Depth A)
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.font = '11px Inter, sans-serif';
    for (let i = 0; i <= 5; i++) {
      const dVal = (maxDepthA * i) / 5;
      const xPos = padL + (pw * i) / 5;
      ctx.fillText(`${dVal.toFixed(0)} Å`, xPos, padT + ph + 18);
    }
    ctx.fillText('Depth X (Å)', padL + pw / 2, padT + ph + 38);

    // Y Axis Ticks & Labels (Lateral / Radial A)
    ctx.textAlign = 'right';
    const minL = axisMode === 'xy' ? -maxLatA : 0;
    const maxL = maxLatA;
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const latVal = maxL - ((maxL - minL) * i) / ySteps;
      const yPos = padT + (ph * i) / ySteps;
      ctx.fillText(`${latVal.toFixed(0)} Å`, padL - 8, yPos + 4);
    }

    ctx.save();
    ctx.translate(20, padT + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(axisMode === 'xy' ? 'Lateral Y Axis (Å)' : 'Radial Distance R (Å)', 0, 0);
    ctx.restore();
  }, [grid, maxVal, maxDepthA, maxLatA, colormap, axisMode, showContours, config.layers, canvasWidth]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const clientY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;

    const padL = 56;
    const padR = 14;
    const padT = 22;
    const padB = 42;
    const pw = canvas.width - padL - padR;
    const ph = canvas.height - padT - padB;

    if (clientX >= padL && clientX <= padL + pw && clientY >= padT && clientY <= padT + ph) {
      const fracX = (clientX - padL) / pw;
      const fracY = (clientY - padT) / ph;
      const xA = fracX * maxDepthA;
      const minL = axisMode === 'xy' ? -maxLatA : 0;
      const maxL = maxLatA;
      const yA = maxL - fracY * (maxL - minL);

      const gx = Math.min(gridSize - 1, Math.max(0, Math.floor(fracX * gridSize)));
      const gy = Math.min(gridSize - 1, Math.max(0, Math.floor(fracY * gridSize)));
      const val = grid[gy][gx] || 0;
      setHoverCoord({ xA, yA, val });
    } else {
      setHoverCoord(null);
    }
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `SRIM_2D_Contour_${config.ion.symbol}_in_${config.layers[0]?.name || 'Target'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>2D Implantation Concentration Contour Map &amp; Heatmap</span>
          </h3>
          <p className="text-xs text-slate-400">
            Spatial distribution of stopped {config.ion.name} ions ({snapshot.stoppedCount.toLocaleString()} ions stopped)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Axis Mode Toggle */}
          <div className="flex items-center rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs">
            <button
              onClick={() => setAxisMode('xy')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                axisMode === 'xy' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Depth vs Lateral (X-Y)
            </button>
            <button
              onClick={() => setAxisMode('xr')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                axisMode === 'xr' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Depth vs Radial (X-R)
            </button>
          </div>

          {/* Colormap Select */}
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value as ColorMapType)}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500"
          >
            <option value="turbo">Colormap: Turbo</option>
            <option value="viridis">Colormap: Viridis</option>
            <option value="plasma">Colormap: Plasma</option>
          </select>

          {/* Contour Lines Toggle */}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showContours}
              onChange={(e) => setShowContours(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
            />
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            <span>Isolines</span>
          </label>

          {/* Download PNG */}
          <button
            onClick={handleDownloadPng}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export PNG</span>
          </button>
        </div>
      </div>

      {/* Canvas Viewport - full width & 1.5x height */}
      <div
        ref={containerRef}
        className="relative bg-slate-950/60 rounded-xl p-1 border border-slate-800/80 w-full"
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverCoord(null)}
          className="rounded-lg shadow-lg cursor-crosshair w-full h-[660px] block"
        />

        {/* Hover Readout Tooltip */}
        {hoverCoord && (
          <div className="absolute bottom-6 left-6 px-3 py-2 rounded-lg bg-slate-900/90 border border-cyan-500/40 text-xs font-mono text-cyan-300 shadow-xl backdrop-blur-md space-y-0.5">
            <div>Depth X: <span className="text-white font-bold">{hoverCoord.xA.toFixed(1)} Å</span></div>
            <div>{axisMode === 'xy' ? 'Lateral Y' : 'Radial R'}: <span className="text-white font-bold">{hoverCoord.yA.toFixed(1)} Å</span></div>
            <div>Density: <span className="text-amber-400 font-bold">{hoverCoord.val.toFixed(1)} hits</span></div>
          </div>
        )}
      </div>

      {/* Footer Statistical Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-slate-950/40 p-3 rounded-xl border border-slate-800/50">
        <div>
          <span className="text-slate-400">Peak Projected Range Rₚ:</span>{' '}
          <span className="font-semibold text-cyan-300">{snapshot.rangeMoments.meanA.toFixed(1)} Å</span>
        </div>
        <div>
          <span className="text-slate-400">Longitudinal Straggling ΔRₚ:</span>{' '}
          <span className="font-semibold text-emerald-300">{snapshot.rangeMoments.stragglingA.toFixed(1)} Å</span>
        </div>
        <div>
          <span className="text-slate-400">Radial Range R_r:</span>{' '}
          <span className="font-semibold text-purple-300">{snapshot.radialMoments.meanA.toFixed(1)} Å</span>
        </div>
        <div>
          <span className="text-slate-400">Radial Straggling ΔR_r:</span>{' '}
          <span className="font-semibold text-amber-300">{snapshot.radialMoments.stragglingA.toFixed(1)} Å</span>
        </div>
      </div>
    </div>
  );
};
