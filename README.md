# SRIM-Web 2003.20

Pure web implementation of the **SRIM-2003** (`SRIM 2003.exe`, `TIN.exe`, `TRIM.exe`, `SR.exe`, `SRModule.exe`, `SRIM Tools`), **SRIMKorea**, and **PTableDB** ion-solid interaction & stopping/range simulation suite.

🌐 **Live Web App (GitHub Pages):** [https://eljja.github.io/SRIM/](https://eljja.github.io/SRIM/)

---

## Key Features

- **STOP2003 & SNUC03 Stopping Power Engine**: `PSTOP`, `HESTOP`, `LISTOP`, `HISTOP` (Brandt-Kitagawa effective charge), relativistic Bethe-Bloch with shell/Barkas/Bloch corrections, `SNUC03` (4,278 pair coefficients) + ZBL universal nuclear stopping, Bragg's rule, Ziegler-Manoyan Core-and-Bond (18 chemical bonds), and Gas/Solid phase corrections.
- **PRAL92 Range & Straggling ODE Solver**: Coupled ODE integration for projected range $R_p$, longitudinal straggling $\Delta R_p$, and lateral straggling $\Delta R_y$, plus `ESUM.BAS` and `TRANSMIT.BAS` calculators.
- **TRIM 3D Monte Carlo BCA Simulator**:
  - Calculation Modes 1–4 (Quick KP/NRT damage, Full Recoil Cascades, Monolayer Surface Sputtering, `TRIM.DAT` custom input).
  - Real-time 3D trajectory & recoil cascade viewer with PNG snapshot export.
  - **2D Depth–Lateral Concentration Contour Heatmap** (Turbo/Viridis/Plasma colormaps, isoline contours, layer boundaries).
  - **WebGPU Compute Acceleration** (WGSL shader with PCG32 PRNG & atomic histogram binning) with ON/OFF toggle and automatic CPU Web Worker fallback.
- **Publication & Legacy Format Compatibility**:
  - Academic-grade vector **SVG** and raw **CSV** export on all depth profiles.
  - Import/export for `TRIM.IN`, `SR.IN`, `.sim` (`SRIMKorea`), `TRIM.DAT`, and all 13 SRIM `.TXT` ASCII outputs (`TDATA.TXT`, `RANGE.TXT`, `VACANCY.TXT`, etc.).
- **Session Permalink Sharing**: URL hash-encoded (`#session=...`) simulation configurations with one-click clipboard sharing.
- **PTableDB Periodic Table & X-Ray Encyclopedia**: 111 elements, 3,112 isotopes, 1,610 X-ray lines, and 601 ionization potentials.

## Local Development

```bash
npm install
npm test        # Run all 7 Vitest suites (32 tests)
npm run dev     # Start local dev server
npm run build   # Type-check and build production bundle (base: /SRIM/)
```
