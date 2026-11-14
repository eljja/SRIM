import React from 'react';
import {
  BookOpen,
  Cpu,
  CheckCircle2,
  Database,
  FileSpreadsheet,
} from 'lucide-react';

export const PhysicsReference: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex items-center gap-4">
        <div className="p-3 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
          <BookOpen className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">
            SRIM-2003 / TRIM / SRModule / PTableDB — Complete Physical & Mathematical Specification
          </h1>
          <p className="text-xs text-slate-400">
            Reverse-engineered and verified directly against SRModule.exe (0x10cd0..0x165d0), TIN.exe (0x86a80..0x8a900), TRIM.exe, STOP.BAS, ESUM.BAS, and TRANSMIT.BAS
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Electronic Stopping Power STOP2003 */}
        <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm border-b border-slate-800 pb-2">
            <Cpu className="w-4 h-4" />
            <span>1. Electronic Stopping Power STOP2003 (SCOEF03.dat)</span>
          </div>
          <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
            <p>
              Extracted from <code className="text-cyan-300">SRModule.exe</code>{' '}
              (<code className="text-slate-400">0x12250..0x165d0</code>). Let{' '}
              <code className="text-emerald-300">e = E_keV / M1</code> (keV/amu)
              and base unit = <code className="text-amber-300">eV / (10¹⁵ atoms/cm²)</code>:
            </p>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] space-y-1.5 text-slate-200">
              <div className="text-cyan-400 font-bold">
                • Light Ions: PSTOP (Z₁=1), HESTOP (Z₁=2), LISTOP (Z₁=3)
              </div>
              <div>S_low(e) = c₁·e^c₂ + c₃·e^c₄ + c₉·e^0.5</div>
              <div>
                S_high(e) = (c₅ / e^c₆) · [ ln(c₇/e + c₈·e) + c₁₀ / e^0.2 ]
              </div>
              <div>S_fit(e) = (S_low · S_high) / (S_low + S_high)</div>
              <div className="text-slate-400">
                For e &lt; 2.0 keV/u: S_e(e) = S_fit(2.0) · (e / 2.0)^0.5
              </div>
              <div className="text-cyan-400 font-bold pt-1">
                • Heavy Ions: HISTOP (Z₁ &gt; 3, 2 ≤ e ≤ 30,000 keV/u)
              </div>
              <div>
                P₁(Z₁, e) = Σ_k=0..12 p_k(Z₁)·(ln e)^k , P₂(Z₂, e) = Σ_k=0..12
                q_k(Z₂)·(ln e)^k
              </div>
              <div>S_e(e) = (Z₁² / 4) · S_He(e) · P₁(Z₁, e) · P₂(Z₂, e)</div>
            </div>
            <p>
              Above <code className="text-cyan-300">1.2 × E_max</code>, SRIM
              transitions to the relativistic <strong>Bethe-Bloch</strong>{' '}
              formula with 11-term/8-term polynomial <strong>Shell</strong>{' '}
              correction <code className="text-slate-300">C/Z₂</code>,{' '}
              <strong>Barkas</strong> <code className="text-slate-300">Z₁L₁</code>{' '}
              polarization correction, and <strong>Bloch</strong>{' '}
              <code className="text-slate-300">Z₁²L₂</code> fourth-order Born
              correction.
            </p>
          </div>
        </div>

        {/* Card 2: Nuclear Stopping SNUC03 vs ZBL Universal */}
        <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-300 font-bold text-sm border-b border-slate-800 pb-2">
            <Cpu className="w-4 h-4" />
            <span>2. Pair-Specific SNUC03 vs ZBL Universal Nuclear Stopping</span>
          </div>
          <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
            <p>
              Reduced energy <code className="text-amber-300">ε</code> and
              nuclear stopping conversion factor (<code className="text-cyan-300">Func_4 0x10cd0</code>{' '}
              &amp; <code className="text-cyan-300">STOP.BAS</code>):
            </p>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] space-y-1.5 text-slate-200">
              <div>
                ε = (32.53 · M₂ · E_keV) / [ Z₁ · Z₂ · (M₁ + M₂) · (Z₁^0.23 +
                Z₂^0.23) ]
              </div>
              <div className="text-amber-300 font-bold pt-1">
                • Pair-Specific SNUC03.dat (4,278 Z₁-Z₂ pairs):
              </div>
              <div>
                s_n(ε) = [ 0.5 · ln(1 + a·ε) ] / [ ε + b·ε^c + d·ε^0.5 ] (ε ≤
                30)
              </div>
              <div>s_n(ε) = ln(ε) / (2·ε) (ε &gt; 30)</div>
              <div className="text-emerald-300 font-bold pt-1">
                • ZBL Universal Screening Constants:
              </div>
              <div>(a, b, c, d) = (1.1383, 0.01321, 0.21226, 0.19593)</div>
              <div>
                S_n [eV/(10¹⁵ atoms/cm²)] = s_n(ε) · [ 8.462 · Z₁ · Z₂ · M₁ /
                ((M₁ + M₂)·(Z₁^0.23 + Z₂^0.23)) ]
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Ziegler-Manoyan Core-and-Bond (CAB) */}
        <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm border-b border-slate-800 pb-2">
            <Database className="w-4 h-4" />
            <span>3. Ziegler-Manoyan Core-and-Bond (CAB) & Phase Decay</span>
          </div>
          <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
            <p>
              Extracted from <code className="text-indigo-300">TIN.exe</code>{' '}
              (<code className="text-slate-400">0x86a80..0x8a900</code>). Sums
              11 closed-shell core stopping powers and 18 chemical bond stopping
              powers at 125 keV/u proton:
            </p>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] space-y-1.5 text-slate-200">
              <div>S_CAB = Σ_i n_i · S_core(Z_i) + Σ_b=1..18 n_b · S_bond(b)</div>
              <div>
                SOLID Binding Corr = (0.92 · F_ion · S_CAB) / S_Bragg,Solid
              </div>
              <div>GAS Binding Corr = (F_ion · S_CAB) / S_Bragg,Gas</div>
              <div className="text-indigo-300">
                Bohr-Velocity Sigmoid Decay (SRModule.exe 0x12d9d):
              </div>
              <div>
                corr(E) = 1 + (corr₀ - 1) / [ 1 + exp(1.48 · (√(e/25) - v_mid)) ]
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: 3D BCA Magic Formula & Kinchin-Pease / Full Cascade */}
        <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm border-b border-slate-800 pb-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              4. Biersack-Haggmark Magic Formula & NRT Kinchin-Pease Damage
            </span>
          </div>
          <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] space-y-1.5 text-slate-200">
              <div>
                Φ_ZBL(x) = 0.18175·e^(-3.1998x) + 0.50986·e^(-0.94229x) +
                0.28022·e^(-0.4029x) + 0.02817·e^(-0.20162x)
              </div>
              <div>
                cos(Θ / 2) = (B + R_c + Δ) / (x₀ + R_c) , T = [4 M₁ M₂ /
                (M₁+M₂)²] · E · sin²(Θ/2)
              </div>
              <div className="text-emerald-300 font-bold pt-1">
                • Quick Kinchin-Pease / NRT Damage Partition:
              </div>
              <div>
                E_D = T_recoil / [ 1 + k_L · (ε_L + 0.40244·ε_L^0.75 +
                3.4008·ε_L^(1/6)) ]
              </div>
              <div>
                ν(T) = 0 (T &lt; E_d) | 1 (E_d ≤ E_D &lt; 2.5 E_d) | 0.4 · E_D /
                E_d (E_D ≥ 2.5 E_d)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Golden Verification Benchmarks */}
      <div className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-white font-bold text-sm border-b border-slate-800 pb-2">
          <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          <span>
            Verified Golden Benchmarks (100% Tested in Vitest Suite)
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="font-bold text-cyan-300">
              Benchmark 1: HELP-SR Module.rtf (H in Liquid Water, Unit 5 MeV/(mg/cm²))
            </div>
            <div className="font-mono text-slate-300">
              • E = 1.02 keV: Sn = 0.03921 (Exact match: 3.921E-02)
              <br />• E = 2.55 keV: Sn = 0.02391 (Exact match: 2.391E-02)
              <br />• E = 3.98 keV: Sn = 0.01681 (Exact match: 1.681E-02)
              <br />• CAB Water Override (Z₁=1): Solid = 0.89, Gas = 0.94
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="font-bold text-emerald-300">
              Benchmark 2: TDATA.sav (3 keV 6-C into Si Wafer, ρ=2.3212 g/cm³, Ed=10 eV)
            </div>
            <div className="font-mono text-slate-300">
              • Longitudinal Range Rp = 130.4 Å (Straggling ΔRp = 68.1 Å)
              <br />• Radial Range = 78.6 Å · Lateral Range = 49.9 Å
              <br />• Vacancies / Ion = 70.8
              <br />• Energy Partition: Ionization + Phonons + Binding = 100.0%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
