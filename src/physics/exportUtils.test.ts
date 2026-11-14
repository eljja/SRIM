import { describe, it, expect } from 'vitest';
import { generateSvgLinePlot, generateCsvData } from './exportUtils';

describe('Publication-Ready Vector SVG & CSV Exporter', () => {
  it('generates valid vector SVG string with academic styling', () => {
    const x = [0, 10, 20, 30, 40, 50];
    const y = [0, 25, 80, 120, 60, 5];

    const svgAcademic = generateSvgLinePlot({
      title: 'Ion Range Profile (10 keV B in Si)',
      xLabel: 'Depth (Å)',
      yLabel: 'Concentration ((atoms/cm³) / (atoms/cm²))',
      series: [{ name: 'Ion Range', color: '#0284c7', x, y }],
      theme: 'academic',
    });

    expect(svgAcademic).toContain('<svg');
    expect(svgAcademic).toContain('</svg>');
    expect(svgAcademic).toContain('Ion Range Profile (10 keV B in Si)');
    expect(svgAcademic).toContain('Depth (Å)');
    expect(svgAcademic).toContain('Concentration');
    // Academic theme has white background
    expect(svgAcademic).toContain('#ffffff');
    expect(svgAcademic).toContain('<polyline');

    const svgDark = generateSvgLinePlot({
      title: 'Ion Range Profile Dark',
      xLabel: 'Depth (Å)',
      yLabel: 'Counts',
      series: [{ name: 'Ion Range', color: '#38bdf8', x, y }],
      theme: 'dark',
    });

    expect(svgDark).toContain('#0f172a'); // slate-900 dark background
  });

  it('generates well-formatted CSV text for OriginLab / Excel import', () => {
    const headers = ['Depth_A', 'Ion_Range_cmInv', 'Vacancies_per_A'];
    const rows = [
      [10, 12450.5, 0.45],
      [20, 34500.2, 1.25],
      [30, 89100.0, 2.80],
    ];

    const csv = generateCsvData(headers, rows);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Depth_A,Ion_Range_cmInv,Vacancies_per_A');
    expect(lines[1]).toBe('10,12450.5,0.45');
    expect(lines[2]).toBe('20,34500.2,1.25');
    expect(lines[3]).toBe('30,89100,2.8');
  });

  it('handles empty or single-point series without error', () => {
    const emptySvg = generateSvgLinePlot({
      title: 'Empty Plot',
      xLabel: 'X',
      yLabel: 'Y',
      series: [{ name: 'Empty', color: '#000', x: [], y: [] }],
      theme: 'academic',
    });
    expect(emptySvg).toContain('<svg');
    expect(emptySvg).toContain('Empty Plot');
  });
});
