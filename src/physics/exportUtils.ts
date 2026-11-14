export interface SvgSeries {
  name: string;
  color: string;
  x: number[];
  y: number[];
}

export interface SvgPlotOptions {
  title: string;
  xLabel: string;
  yLabel: string;
  series: SvgSeries[];
  width?: number;
  height?: number;
  theme?: 'academic' | 'dark';
}

/**
 * Generates an academic publication-ready vector SVG line chart.
 */
export function generateSvgLinePlot({
  title,
  xLabel,
  yLabel,
  series,
  width = 720,
  height = 460,
  theme = 'academic',
}: SvgPlotOptions): string {
  const isDark = theme === 'dark';
  const bgColor = isDark ? '#0f172a' : '#ffffff';
  const textColor = isDark ? '#f1f5f9' : '#0f172a';
  const axisColor = isDark ? '#475569' : '#334155';
  const gridColor = isDark ? '#1e293b' : '#e2e8f0';

  const padLeft = 85;
  const padRight = 40;
  const padTop = 60;
  const padBottom = 65;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Determine global min/max
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = 0;
  let maxY = -Infinity;

  for (const s of series) {
    for (let i = 0; i < s.x.length; i++) {
      if (s.x[i] < minX) minX = s.x[i];
      if (s.x[i] > maxX) maxX = s.x[i];
      if (s.y[i] > maxY) maxY = s.y[i];
      if (s.y[i] < minY) minY = s.y[i];
    }
  }

  if (minX === Infinity) minX = 0;
  if (maxX <= minX) maxX = minX + 100;
  if (maxY <= minY) maxY = minY + 1;

  const scaleX = (val: number) => padLeft + ((val - minX) / (maxX - minX)) * plotW;
  const scaleY = (val: number) => padTop + plotH - ((val - minY) / (maxY - minY)) * plotH;

  // Generate 5 grid ticks
  const xTicks: number[] = [];
  const yTicks: number[] = [];
  for (let i = 0; i <= 5; i++) {
    xTicks.push(minX + ((maxX - minX) * i) / 5);
    yTicks.push(minY + ((maxY - minY) * i) / 5);
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="'Times New Roman', Times, serif, system-ui">
  <rect width="100%" height="100%" fill="${bgColor}" />
  
  <!-- Title -->
  <text x="${width / 2}" y="35" font-size="16" font-weight="bold" fill="${textColor}" text-anchor="middle">${title}</text>
  
  <!-- Y Axis Label -->
  <text x="${-padTop - plotH / 2}" y="28" font-size="13" font-weight="600" fill="${textColor}" text-anchor="middle" transform="rotate(-90)">${yLabel}</text>
  
  <!-- X Axis Label -->
  <text x="${padLeft + plotW / 2}" y="${height - 18}" font-size="13" font-weight="600" fill="${textColor}" text-anchor="middle">${xLabel}</text>

  <!-- Grid Lines -->
  <g stroke="${gridColor}" stroke-dasharray="3,3" stroke-width="1">
`;

  for (const yt of yTicks) {
    const yPos = scaleY(yt);
    svg += `    <line x1="${padLeft}" y1="${yPos}" x2="${padLeft + plotW}" y2="${yPos}" />\n`;
  }
  for (const xt of xTicks) {
    const xPos = scaleX(xt);
    svg += `    <line x1="${xPos}" y1="${padTop}" x2="${xPos}" y2="${padTop + plotH}" />\n`;
  }

  svg += `  </g>

  <!-- Plot Axes -->
  <rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="none" stroke="${axisColor}" stroke-width="1.5" />

  <!-- Ticks & Values -->
  <g font-size="11" fill="${textColor}">
`;

  for (const yt of yTicks) {
    const yPos = scaleY(yt);
    const label = yt >= 1e4 || (yt < 0.01 && yt > 0) ? yt.toExponential(2) : yt.toFixed(yt < 10 ? 2 : 0);
    svg += `    <text x="${padLeft - 8}" y="${yPos + 4}" text-anchor="end">${label}</text>\n`;
    svg += `    <line x1="${padLeft - 4}" y1="${yPos}" x2="${padLeft}" y2="${yPos}" stroke="${axisColor}" stroke-width="1.2" />\n`;
  }

  for (const xt of xTicks) {
    const xPos = scaleX(xt);
    const label = xt.toFixed(xt < 10 ? 1 : 0);
    svg += `    <text x="${xPos}" y="${padTop + plotH + 18}" text-anchor="middle">${label}</text>\n`;
    svg += `    <line x1="${xPos}" y1="${padTop + plotH}" x2="${xPos}" y2="${padTop + plotH + 4}" stroke="${axisColor}" stroke-width="1.2" />\n`;
  }

  svg += `  </g>

  <!-- Data Series Polylines -->
`;

  for (const s of series) {
    if (s.x.length === 0) continue;
    const pointsStr = s.x.map((xv, i) => `${scaleX(xv).toFixed(1)},${scaleY(s.y[i] || 0).toFixed(1)}`).join(' ');
    svg += `  <polyline points="${pointsStr}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />\n`;
  }

  // Legend if multiple series
  if (series.length > 1) {
    svg += `  <g transform="translate(${padLeft + 15}, ${padTop + 15})">\n`;
    svg += `    <rect width="140" height="${series.length * 20 + 8}" fill="${bgColor}" stroke="${axisColor}" stroke-width="1" rx="4" opacity="0.9" />\n`;
    series.forEach((s, idx) => {
      const yOffset = idx * 20 + 15;
      svg += `    <line x1="10" y1="${yOffset}" x2="30" y2="${yOffset}" stroke="${s.color}" stroke-width="2.5" />\n`;
      svg += `    <text x="36" y="${yOffset + 4}" font-size="11" fill="${textColor}">${s.name}</text>\n`;
    });
    svg += `  </g>\n`;
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Generates standard CSV formatted string for external data tools (OriginLab, Excel, Python/Pandas).
 */
export function generateCsvData(headers: string[], rows: (string | number)[][]): string {
  const sanitize = (val: string | number) => {
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headerLine = headers.map(sanitize).join(',');
  const rowLines = rows.map((r) => r.map(sanitize).join(','));
  return [headerLine, ...rowLines].join('\n');
}

/**
 * Triggers a browser file download of string content.
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
