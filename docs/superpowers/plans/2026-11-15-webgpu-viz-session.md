# WebGPU Acceleration, Advanced Visualization, and Session Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the `srim-web` application with an optional WebGPU compute acceleration engine (with seamless ON/OFF toggle and CPU fallback), advanced scientific visualization (2D depth-lateral concentration contour heatmaps, publication-ready vector SVG/CSV exporters, 3D trajectory screenshot capture), and compressed URL hash-based session sharing.

**Architecture:** 
1. `sessionUrl.ts`: LZ-based / URL-safe compressed serialization of `TrimSetupConfig` for permalink generation and initial URL hydration.
2. `webgpuTrim.ts`: WGSL compute shader and WebGPU runtime pipeline executing parallel BCA Monte Carlo jumps on GPU threads, with automatic browser capability detection and fallback to the existing `trim.worker.ts` CPU worker.
3. `exportUtils.ts`: Pure utilities for generating academic publication-ready vector SVGs, CSV data sheets, and canvas image snapshots.
4. `ContourMap2D.tsx`: High-performance Canvas-based 2D concentration heatmap and isoline contour plotter ($X$ depth vs $Y$ lateral or $R$ radial).
5. Integration into `TrimCockpit.tsx`, `TrajectoryViewer3D.tsx`, `Navbar.tsx`, and `SetupStudio.tsx`.

**Tech Stack:** TypeScript, WebGPU (WGSL), React 18, Vite, Three.js, Vitest, Tailwind CSS.

---

## Global Constraints

- Never modify legacy files in `D:\Code\HSC\SRIM`. All work is confined to `D:\Code\HSC\srim-web`.
- Must pass all existing 23 Vitest tests and all new tests with 100% pass rate.
- `npm run build` must succeed with zero TypeScript or Rollup errors.
- WebGPU must remain strictly optional: if `navigator.gpu` is missing, disabled by the user, or encounters an allocation failure, the simulation must seamlessly fall back to the existing CPU Web Worker without throwing unhandled exceptions.

## Review Focus

1. **URL Hash corruption**: Malformed, truncated, or incompatible hash strings in `#session=...` must not crash the app; they must gracefully fall back to `DEFAULT_TRIM_CONFIG` and display a non-blocking toast warning.
2. **WebGPU feature availability**: In environments without WebGPU (Firefox by default, Safari on older iOS, or disabled hardware flags), the UI toggle must be cleanly disabled with an informative badge ("WebGPU Unavailable - Using CPU Worker").
3. **Data conservation in 2D Contour**: 2D binning grid ($50 \times 50$ or $100 \times 100$) must accurately preserve the total integrated ion count and align depth $X$ with the 1D histograms.
4. **SVG styling in academic papers**: Exported SVGs must support both white publication background (black text, standard fonts) and dark UI mode, with clean tick marks and units.
5. **Memory leaks on rapid toggle**: Toggling WebGPU ON and OFF repeatedly during live simulation must properly terminate compute dispatches and GPU buffers without memory leaks.

---

### Task 1: URL Session Permalinks & Compressed Sharing (`sessionUrl.ts`)

**Files:**
- Create: `src/physics/sessionUrl.ts`
- Test: `src/physics/sessionUrl.test.ts`
- Modify: `src/components/Navbar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write unit tests for session URL serialization**
  - Create `src/physics/sessionUrl.test.ts`.
  - Test encoding `DEFAULT_TRIM_CONFIG` into a URL-safe base64/deflate string.
  - Test decoding back to verify deep equality with the original config.
  - Test handling malformed, empty, or truncated input strings (returns `null` without throwing).
- [ ] **Step 2: Run tests to verify failure (Red)**
  - Run `npx vitest run src/physics/sessionUrl.test.ts`.
- [ ] **Step 3: Implement `sessionUrl.ts`**
  - Implement `encodeConfigToHash(config: TrimSetupConfig): string`.
  - Implement `decodeConfigFromHash(hash: string): TrimSetupConfig | null`.
  - Use lightweight URL-safe compression (e.g. JSON + UTF-8 to Base64URL with URI component encoding or pako/lz-string).
- [ ] **Step 4: Run tests to verify pass (Green)**
  - Run `npx vitest run src/physics/sessionUrl.test.ts`.
- [ ] **Step 5: Integrate session sharing into `Navbar.tsx` and `App.tsx`**
  - In `Navbar.tsx`, add a "Share Session (공유)" button with a copy-to-clipboard action and visual toast notification.
  - In `App.tsx`, read `window.location.hash` on initial load. If `#session=` is present, hydrate `trimConfig` with the decoded state and show a welcome banner ("Shared session loaded").

---

### Task 2: Publication-Ready Vector SVG & CSV Data Exporter (`exportUtils.ts`)

**Files:**
- Create: `src/physics/exportUtils.ts`
- Test: `src/physics/exportUtils.test.ts`
- Modify: `src/components/TrimCockpit.tsx`

- [ ] **Step 1: Write unit tests for vector SVG and CSV generation**
  - Create `src/physics/exportUtils.test.ts`.
  - Test `generateSvgPlot`: verifies valid SVG string with `<svg>`, `<polyline>`, `<text>`, axis labels, and theme settings (`academic` white vs `dark`).
  - Test `generateCsvData`: verifies CSV headers, comma formatting, and numeric precision matching standard OriginLab/Excel conventions.
- [ ] **Step 2: Run tests to verify failure (Red)**
  - Run `npx vitest run src/physics/exportUtils.test.ts`.
- [ ] **Step 3: Implement `exportUtils.ts`**
  - Write `generateSvgPlot({ title, xLabel, yLabel, data, width, height, theme })`.
  - Write `generateCsvData(headers: string[], rows: (string | number)[][]): string`.
  - Write `downloadBlob(content: string, filename: string, mimeType: string): void`.
- [ ] **Step 4: Run tests to verify pass (Green)**
  - Run `npx vitest run src/physics/exportUtils.test.ts`.
- [ ] **Step 5: Add export action buttons to `TrimCockpit.tsx`**
  - Add "Export SVG (Paper)" and "Export CSV" buttons to distribution chart tabs (Ion Range, Vacancies, Ionization, Phonons).

---

### Task 3: 2D Concentration Contour Heatmap Component (`ContourMap2D.tsx`)

**Files:**
- Create: `src/components/ContourMap2D.tsx`
- Modify: `src/components/TrimCockpit.tsx`

- [ ] **Step 1: Design 2D binning and contour calculation**
  - Create `ContourMap2D.tsx` accepting `snapshot: TrimSnapshot` and `config: TrimSetupConfig`.
  - Aggregate 2D density grid $D(X, Y)$ and $D(X, R)$ using stopped ion coordinates `stoppedDepthsA` and `stoppedLatYA` / `stoppedRadialRA`.
  - Implement smooth bicubic/bilinear interpolation and colormaps: `Turbo`, `Viridis`, `Plasma`.
  - Implement contour lines at percentile levels (e.g. 10%, 25%, 50%, 75%, 90% peak concentration).
- [ ] **Step 2: Add interactive controls**
  - Colormap selector (`Turbo` / `Viridis` / `Plasma`).
  - View mode toggle: `Depth vs Lateral Y` or `Depth vs Radial R`.
  - Show/Hide contour isolines checkbox.
  - "Save 2D Contour PNG" export button.
- [ ] **Step 3: Add "2D Contour" tab to `TrimCockpit.tsx`**
  - Add `'contour2d'` to `CockpitTab` union type.
  - Mount `<ContourMap2D snapshot={snapshot} config={config} />` inside the tab content.

---

### Task 4: 3D Trajectory Canvas Capture (`TrajectoryViewer3D.tsx`)

**Files:**
- Modify: `src/components/TrajectoryViewer3D.tsx`

- [ ] **Step 1: Implement high-resolution 3D screenshot capture**
  - Add camera snapshot button to the 3D viewer toolbar with a Camera icon.
  - When clicked: re-render with `preserveDrawingBuffer` or call `renderer.render(scene, camera)` and capture `renderer.domElement.toDataURL('image/png')`.
  - Automatically download as `TRIM_3D_Trajectory_<timestamp>.png`.

---

### Task 5: WebGPU Compute Engine with ON/OFF Toggle (`webgpuTrim.ts`)

**Files:**
- Create: `src/physics/webgpuTrim.ts`
- Test: `src/physics/webgpuTrim.test.ts`
- Modify: `src/components/TrimCockpit.tsx`

- [ ] **Step 1: Write tests for WebGPU capability detection & runner interface**
  - Create `src/physics/webgpuTrim.test.ts`.
  - Test `isWebGpuSupported()` detection utility.
  - Test shader validation and struct alignment.
- [ ] **Step 2: Implement WGSL Compute Shader & Runner in `webgpuTrim.ts`**
  - Write WGSL compute shader for parallel BCA:
    - PCG / Mulberry32 parallel PRNG per thread ID.
    - ZBL Universal screening formula and scattering angle approximation.
    - Uniform buffers for layer parameters ($Z_1, M_1, E_0, Z_2, M_2, \rho, E_d$).
    - Storage buffers for 100-bin range histogram output and stopped $(X, Y, Z)$ positions.
  - Write `WebGpuTrimRunner` class managing `GPUDevice`, `GPUComputePipeline`, buffer allocations, and async result readback.
  - Implement fallback handling: if WebGPU fails at runtime, reject cleanly so caller falls back to CPU worker.
- [ ] **Step 3: Run tests to verify pass**
  - Run `npx vitest run src/physics/webgpuTrim.test.ts`.
- [ ] **Step 4: Integrate WebGPU toggle into `TrimCockpit.tsx`**
  - Add toggle switch in the simulation cockpit control header:
    - If `navigator.gpu` exists: show toggle `[⚡ WebGPU Acceleration: ON / OFF]` with live badge.
    - If `navigator.gpu` is absent: show badge `[CPU Worker (WebGPU Unsupported)]`.
  - When WebGPU is ON and running: dispatch batches to `WebGpuTrimRunner` and update snapshot.
  - When WebGPU is OFF: continue using `trim.worker.ts` seamlessly.

---

### Task 6: Master Verification & Production Build

- [ ] **Step 1: Run all Vitest tests**
  - Run `npx vitest run`. Verify 100% pass across all test suites (`stopping.test.ts`, `pral.test.ts`, `formats.test.ts`, `trim.test.ts`, `sessionUrl.test.ts`, `exportUtils.test.ts`, `webgpuTrim.test.ts`).
- [ ] **Step 2: Run production build**
  - Run `npm run build`. Ensure zero TypeScript and Vite/Rollup errors.
- [ ] **Step 3: Document accomplishments in Walkthrough**
  - Update `walkthrough.md` with WebGPU toggle, 2D contour visualization, paper export, and URL session sharing.
