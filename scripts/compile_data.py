"""Compile all SRIM 2003, SRModule, SRIMKorea (SrimIn.mdb), and PTableDB (Specon.mdb)
datasets into strongly-typed JSON files in D:\\Code\\HSC\\srim-web\\src\\data\\."""
import os
import re
import csv
import json

SRIM_ROOT = r"D:\Code\HSC\SRIM\SRIM 2003"
MDB_ROOT = r"C:\Users\eljja\.gemini\antigravity\brain\b237ab94-e574-48b6-a217-31203aab7ab9\scratch\mdb"
OUT_DIR = r"D:\Code\HSC\srim-web\src\data"
os.makedirs(OUT_DIR, exist_ok=True)


def parse_float(val, default=0.0):
    if val is None:
        return default
    s = str(val).strip()
    if not s:
        return default
    # Handle Fortran-style '10000.E-02'
    try:
        return float(s)
    except ValueError:
        return default


def compile_scoef03():
    path = os.path.join(SRIM_ROOT, "Data", "SCOEF03.dat")
    with open(path, "r", encoding="latin1") as f:
        lines = [l.strip() for l in f if l.strip()]
    elements = []
    for line in lines:
        # Format: "H " "Hydrogen   " 1 1 1.008 ...
        m = re.match(r'^"([^"]+)"\s+"([^"]+)"\s+(.*)$', line)
        if not m:
            continue
        sym = m.group(1).strip()
        name = m.group(2).strip()
        nums = [float(x) for x in m.group(3).split()]
        assert len(nums) == 93, f"Expected 93 floats for {sym}, got {len(nums)}"
        elements.append({
            "z": int(round(nums[0])),
            "symbol": sym,
            "name": name,
            "maiMass": int(round(nums[1])),
            "maiWeight": nums[2],
            "naturalWeight": nums[3],
            "solidDensity": nums[4],
            "solidAtomDensity": nums[5],
            "fermiVelocity": nums[6],
            "heatSubl": nums[7],
            "gasDensity": nums[8],
            "gasAtomDensity": nums[9],
            "pstop": nums[10:20],       # col 11..20
            "hestop": nums[20:30],      # col 21..30
            "listop": nums[30:40],      # col 31..40
            "hip1": nums[40:53],        # col 41..53
            "hip2": nums[53:66],        # col 54..66
            "i0Solid": nums[66],        # col 67
            "i0Gas": nums[67],          # col 68
            "i0Compound": nums[68],     # col 69
            "shellLow": nums[69:80],    # col 70..80 (11 coeffs)
            "shellHigh": nums[80:88],   # col 81..88 (8 coeffs)
            "hiEffCharge": nums[88:93], # col 89..93 (5 coeffs)
            "raw": nums,
        })
    assert len(elements) == 92, f"Expected 92 elements, got {len(elements)}"
    with open(os.path.join(OUT_DIR, "scoef03.json"), "w", encoding="utf-8") as f:
        json.dump(elements, f, separators=(",", ":"))
    print(f"Compiled scoef03.json: {len(elements)} elements")
    return elements


def compile_snuc03():
    path = os.path.join(SRIM_ROOT, "Data", "SNUC03.dat")
    pairs = []
    with open(path, "r", encoding="latin1") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 6:
                try:
                    z1 = int(parts[0])
                    z2 = int(parts[1])
                    c1, c2, c3, c4 = (float(parts[2]), float(parts[3]), float(parts[4]), float(parts[5]))
                    pairs.append([z1, z2, c1, c2, c3, c4])
                except ValueError:
                    pass
    assert len(pairs) == 4278, f"Expected 4278 SNUC03 pairs, got {len(pairs)}"
    with open(os.path.join(OUT_DIR, "snuc03.json"), "w", encoding="utf-8") as f:
        json.dump(pairs, f, separators=(",", ":"))
    print(f"Compiled snuc03.json: {len(pairs)} pairs")


def compile_compounds():
    # 1. Parse Compound.dat (has category, comments, 18-bond vector)
    comp_dat_path = os.path.join(SRIM_ROOT, "Data", "Compound.dat")
    with open(comp_dat_path, "rb") as f:
        lines = f.read().decode("cp437", errors="replace").splitlines()

    compounds = []
    by_name = {}
    current_category = "General Materials"
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if line.startswith("!"):
            txt = line[1:].strip(" ▀▄█═─")
            if txt and "Common" not in txt and "Density" not in txt and len(txt) > 3:
                current_category = txt
            i += 1
            continue
        if line.startswith("*"):
            display_header = line[1:].strip()
            # Next line is data line: "Name", density, numElem, z1, sto1, ...
            if i + 2 < len(lines):
                data_line = lines[i + 1].strip()
                bond_line = lines[i + 2].strip()
                i += 3
                comments = []
                while i < len(lines) and lines[i].startswith("$"):
                    comments.append(lines[i][1:].rstrip())
                    i += 1
                # Parse data_line
                m = re.match(r'^"([^"]+)"\s*,\s*(.*)$', data_line)
                if m:
                    raw_name = m.group(1).strip()
                    is_mass_pct = raw_name.startswith("%")
                    clean_name = raw_name.lstrip("%").strip()
                    rest = [x.strip() for x in m.group(2).split(",") if x.strip()]
                    if len(rest) >= 2:
                        density = parse_float(rest[0], 1.0)
                        num_elem = int(parse_float(rest[1], 1))
                        elements = []
                        for k in range(num_elem):
                            if 2 + 2 * k + 1 < len(rest):
                                zk = int(parse_float(rest[2 + 2 * k], 1))
                                stok = parse_float(rest[2 + 2 * k + 1], 1.0)
                                if 1 <= zk <= 92:
                                    elements.append({"z": zk, "stoich": stok})
                        bonds = [parse_float(x, 0.0) for x in bond_line.split()][:18]
                        while len(bonds) < 18:
                            bonds.append(0.0)
                        entry = {
                            "name": clean_name,
                            "category": current_category,
                            "state": 1 if density < 0.01 else 0,
                            "density": density,
                            "isMassPercent": is_mass_pct,
                            "elements": elements,
                            "bonds": bonds,
                            "comments": "\n".join(comments).strip(),
                        }
                        compounds.append(entry)
                        by_name[clean_name.lower()] = entry
                continue
        i += 1

    # 2. Merge SrimIn.mdb Compound.tsv (adds State flag and any SRIMKorea-specific entries)
    tsv_path = os.path.join(MDB_ROOT, "SrimIn", "Compound.tsv")
    with open(tsv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            name = (row.get("Name") or "").strip()
            if not name:
                continue
            state = int(parse_float(row.get("State"), 0))
            density = parse_float(row.get("Density"), 1.0)
            num_elem = int(parse_float(row.get("NumElem"), 1))
            elems = []
            for k in range(1, num_elem + 1):
                zk = int(parse_float(row.get(f"Comp{k}"), 0))
                stok = parse_float(row.get(f"Sto{k}"), 0.0)
                if 1 <= zk <= 92 and stok > 0:
                    elems.append({"z": zk, "stoich": stok})
            key = name.lower()
            if key in by_name:
                by_name[key]["state"] = state
            elif elems:
                entry = {
                    "name": name,
                    "category": "SRIMKorea Database",
                    "state": state,
                    "density": density,
                    "isMassPercent": False,
                    "elements": elems,
                    "bonds": [0.0] * 18,
                    "comments": "",
                }
                compounds.append(entry)
                by_name[key] = entry

    with open(os.path.join(OUT_DIR, "compounds.json"), "w", encoding="utf-8") as f:
        json.dump(compounds, f, indent=2)
    print(f"Compiled compounds.json: {len(compounds)} compounds")


def compile_ptable():
    specon_dir = os.path.join(MDB_ROOT, "Specon")

    def read_tsv(fname):
        with open(os.path.join(specon_dir, fname), "r", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f, delimiter="\t"))

    ion_data_rows = read_tsv("Ion_Data.tsv")
    general_rows = {int(r["AtomNum"]): r for r in read_tsv("General.tsv") if r.get("AtomNum")}
    history_rows = {int(r["AtomNum"]): r for r in read_tsv("History.tsv") if r.get("AtomNum")}
    misc_rows = {int(r["AtomNum"]): r for r in read_tsv("Misc.tsv") if r.get("AtomNum")}

    # Also read Displacement, Lattice Binding, Surface Binding from TRIM defaults / SCOEF03
    # In TIN.exe, default Ed = 25 eV (metals/general), 15 eV (semiconductors Si, Ge), 28 eV (C), 5 eV (H, gases)
    # Default Eb = 3 eV, Default Es = HeatSubl (or 2.0 eV if HeatSubl == 0)

    ions_by_z = {}
    for r in read_tsv("Ion.tsv"):
        z = int(parse_float(r.get("AtomNum"), 0))
        if z > 0:
            ions_by_z.setdefault(z, []).append({
                "charge": (r.get("Charge") or "").strip(),
                "potential": parse_float(r.get("Potential"), 0.0),
            })

    isotopes_by_z = {}
    for r in read_tsv("Isotope.tsv"):
        z = int(parse_float(r.get("AtomNum"), 0))
        if z > 0:
            isotopes_by_z.setdefault(z, []).append({
                "isoName": (r.get("IsoName") or "").strip(),
                "weight": parse_float(r.get("Weight"), 0.0),
                "abundance": parse_float(r.get("Abundance"), 0.0),
                "halfLife": (r.get("Half") or "").strip(),
                "decay": (r.get("Decay") or "").strip(),
            })

    xrays_by_z = {}
    all_xrays = []
    symbol_by_z = {}
    name_by_z = {}
    for r in ion_data_rows:
        z = int(parse_float(r.get("AtomNum"), 0))
        symbol_by_z[z] = (r.get("Element") or "").strip()
        name_by_z[z] = (r.get("ElName") or "").strip()

    for r in read_tsv("Xrays.tsv"):
        z = int(parse_float(r.get("AtomNum"), 0))
        if z > 0:
            item = {
                "z": z,
                "symbol": symbol_by_z.get(z, ""),
                "line": (r.get("Line") or "").strip(),
                "energy": parse_float(r.get("Energy"), 0.0),
                "intensity": parse_float(r.get("Intensity"), 0.0),
                "edge": (r.get("Edge") or "").strip(),
                "xKey": int(parse_float(r.get("XKey"), 0)),
            }
            xrays_by_z.setdefault(z, []).append(item)
            all_xrays.append(item)

    elements = []
    for r in sorted(ion_data_rows, key=lambda x: int(parse_float(x.get("AtomNum"), 0))):
        z = int(parse_float(r.get("AtomNum"), 0))
        if z <= 0:
            continue
        g = general_rows.get(z, {})
        h = history_rows.get(z, {})
        m = misc_rows.get(z, {})
        heat_subl = parse_float(r.get("HeatSubl"), 0.0)
        # Standard SRIM default displacement energy Ed:
        if z in (6,):
            default_ed = 28.0
        elif z in (14, 32):
            default_ed = 15.0
        elif z in (1, 2, 7, 8, 9, 10, 17, 18, 35, 36, 53, 54, 85, 86):
            default_ed = 28.0
        else:
            default_ed = 25.0
        default_eb = 3.0
        default_es = heat_subl if heat_subl > 0 else 2.0

        elements.append({
            "z": z,
            "symbol": (r.get("Element") or "").strip(),
            "name": (r.get("ElName") or "").strip(),
            "maiMass": int(parse_float(r.get("MAIMass"), z * 2)),
            "maiWeight": parse_float(r.get("MAIWeight"), z * 2.0),
            "naturalWeight": parse_float(r.get("NaturalMass"), z * 2.0),
            "density": parse_float(r.get("WDensity"), 1.0),
            "atomDensity": parse_float(r.get("AtomDensity"), 1.0) * 1e22,
            "fermiVelocity": parse_float(r.get("FermiVelocity"), 1.0),
            "screenFactor": parse_float(r.get("ScreenFactor"), 1.0),
            "heatSubl": heat_subl,
            "defaultEd": default_ed,
            "defaultEb": default_eb,
            "defaultEs": default_es,
            "general": {
                "meltingPointK": g.get("MeltP", ""),
                "boilingPointK": g.get("BoilP", ""),
                "heatFusion": g.get("HFusion", ""),
                "heatVapor": g.get("HVapor", ""),
                "heatCapacity": g.get("HCapa", ""),
                "entropy": g.get("Entropy", ""),
                "atomicVolume": g.get("AtomVol", ""),
                "thermalCond": g.get("ThermCond", ""),
                "resistivity": g.get("Resist", ""),
                "workFunction": g.get("WorkFunc", ""),
                "thermalExp": g.get("ThermExpCoef", ""),
            },
            "history": {
                "discYear": h.get("DiscYear", ""),
                "discoverer": h.get("Discoverer", ""),
                "nameOrigin": h.get("NameOrigin", ""),
                "earthContent": h.get("EarthCont", ""),
                "chondriteContent": h.get("ChonCont", ""),
                "cosmicContent": h.get("CosmocCont", ""),
                "cost": h.get("Cost", ""),
                "source": h.get("Source", ""),
                "use": h.get("Use", ""),
                "properties": h.get("Proper", ""),
                "toxicity": h.get("Toxicity", ""),
            },
            "misc": {
                "elecConf": m.get("ElecConf", ""),
                "paulingElectroneg": m.get("Paul", ""),
                "neutronCrossSection": m.get("Neutron", ""),
                "atomicRadius": m.get("AtomRad", ""),
                "covalentRadius": m.get("CovRad", ""),
                "crystalStructure": m.get("CryStruc", ""),
            },
            "ionizationPotentials": ions_by_z.get(z, []),
            "isotopes": isotopes_by_z.get(z, []),
            "xrays": xrays_by_z.get(z, []),
        })

    all_xrays.sort(key=lambda x: x["energy"])
    with open(os.path.join(OUT_DIR, "ptable.json"), "w", encoding="utf-8") as f:
        json.dump({"elements": elements, "allXrays": all_xrays}, f, separators=(",", ":"))
    print(f"Compiled ptable.json: {len(elements)} elements, {len(all_xrays)} X-ray lines")


def compile_demos():
    demo_dir = os.path.join(SRIM_ROOT, "Demo")
    demos = []
    for idx in range(12):
        fname = f"Trim.d{idx:02d}"
        fpath = os.path.join(demo_dir, fname)
        if not os.path.exists(fpath):
            continue
        with open(fpath, "rb") as f:
            raw = f.read().decode("cp437", errors="replace")
        lines = [l.strip() for l in raw.splitlines()]
        # Line 3: Z1, M1, Energy(keV), Angle, Number, BraggCorr, AutoSave
        ion_parts = lines[2].split()
        z1 = int(parse_float(ion_parts[0], 14))
        m1 = parse_float(ion_parts[1], 28.0)
        energy_kev = parse_float(ion_parts[2], 100.0)
        angle = parse_float(ion_parts[3], 0.0)
        calc_mode = int(parse_float(lines[4].split()[0], 1))
        # Line 9: "Title" numElem numLayers
        m_title = re.match(r'^"([^"]*)"\s+(\d+)\s+(\d+)', lines[8])
        title = m_title.group(1).strip() if m_title else fname
        num_elem = int(m_title.group(2)) if m_title else 1
        num_layers = int(m_title.group(3)) if m_title else 1
        plot_parts = lines[12].split()
        xmin = parse_float(plot_parts[1], 0.0) if len(plot_parts) > 1 else 0.0
        xmax = parse_float(plot_parts[2], 0.0) if len(plot_parts) > 2 else 0.0

        # Target elements start at line index 14
        target_elems = []
        for k in range(num_elem):
            eparts = lines[14 + k].split("=")
            rhs = eparts[-1].split()
            target_elems.append({
                "z": int(parse_float(rhs[0], 14)),
                "mass": parse_float(rhs[1], 28.0),
            })

        # Layers start at 14 + num_elem + 2
        layer_start = 14 + num_elem + 2
        layers_raw = []
        for lidx in range(num_layers):
            lstr = lines[layer_start + lidx]
            lm = re.match(r'^\d+\s+"([^"]*)"\s+(.*)$', lstr)
            if lm:
                lname = lm.group(1).strip()
                lnums = [parse_float(x) for x in lm.group(2).split()]
            else:
                lparts = lstr.split()
                lname = f"Layer {lidx+1}"
                lnums = [parse_float(x) for x in lparts[1:]]
            width = lnums[0] if len(lnums) > 0 else 1000.0
            density = lnums[1] if len(lnums) > 1 else 2.32
            stoichs = lnums[2:2 + num_elem]
            layers_raw.append({
                "name": lname,
                "width": width,
                "density": density,
                "stoich": stoichs,
            })

        p_idx = layer_start + num_layers
        phases = [int(parse_float(x, 0)) for x in lines[p_idx + 1].split()]
        bragg = [parse_float(x, 1.0) for x in lines[p_idx + 3].split()]
        eds = [parse_float(x, 15.0) for x in lines[p_idx + 5].split()]
        ebs = [parse_float(x, 3.0) for x in lines[p_idx + 7].split()]
        ess = [parse_float(x, 2.0) for x in lines[p_idx + 9].split()]

        for k, te in enumerate(target_elems):
            te["ed"] = eds[k] if k < len(eds) else 15.0
            te["eb"] = ebs[k] if k < len(ebs) else 3.0
            te["es"] = ess[k] if k < len(ess) else 2.0

        for lidx, lr in enumerate(layers_raw):
            lr["phase"] = phases[lidx] if lidx < len(phases) else 0
            lr["compoundCorr"] = bragg[lidx] if lidx < len(bragg) else 1.0

        demos.append({
            "id": fname,
            "title": title,
            "ionZ": z1,
            "ionMass": m1,
            "energyKeV": energy_kev,
            "angleDeg": angle,
            "calcMode": calc_mode,
            "xmin": xmin,
            "xmax": xmax,
            "targetElements": target_elems,
            "layers": layers_raw,
            "rawTrimIn": raw,
        })

    with open(os.path.join(OUT_DIR, "demos.json"), "w", encoding="utf-8") as f:
        json.dump(demos, f, indent=2)
    print(f"Compiled demos.json: {len(demos)} demos")


if __name__ == "__main__":
    compile_scoef03()
    compile_snuc03()
    compile_compounds()
    compile_ptable()
    compile_demos()
