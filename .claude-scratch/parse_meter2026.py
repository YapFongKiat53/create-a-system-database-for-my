import json, re, datetime, openpyxl

SRC = "/Users/yapfongkiat/Downloads/Meter Reading 2026 (1).xlsx"
# The year-named sheets are closed-off history; these five are the live
# registers. DAMAI stops at 2025-12 and is superseded by DAMAI 1, but it is
# read too so nothing is silently dropped — later readings win on merge.
SHEETS = ["NADAYU", "DAMAI 1", "ATRIA", "SR, SHOPLOT", "DAMAI"]

wb = openpyxl.load_workbook(SRC, data_only=True)

def parse_date(v):
    if isinstance(v, datetime.datetime): return v.date().isoformat()
    if isinstance(v, str):
        # a few cells were typed by hand: "23.-May-24", "22.-May-25"
        m = re.match(r"(\d{1,2})\.?-([A-Za-z]{3})-(\d{2})$", v.strip())
        if m:
            try:
                return datetime.datetime.strptime(
                    f"{m.group(1)}-{m.group(2)}-20{m.group(3)}", "%d-%b-%Y"
                ).date().isoformat()
            except ValueError:
                return None
    return None

def room_code(raw):
    """Every sheet writes room codes its own way; the database uses
    <unit code>-<room label>."""
    c = str(raw).strip().upper().replace(" ", "")
    # NE-08-11A..D is unit NE-0811A — confirmed by the office. The middle
    # dash is cosmetic and the unit's own trailing "A" was dropped when the
    # block was typed; every other Nadayu block writes <unit>-<room>.
    m = re.fullmatch(r"NE-08-11([A-Z])", c)
    if m: return f"NE-0811A-{m.group(1)}"
    m = re.fullmatch(r"(D\d)-(\d{2})-(\d{2})([A-Z])", c)      # D3-14-09A
    if m: return f"{m.group(1)}-{m.group(2)}{m.group(3)}-{m.group(4)}"
    m = re.fullmatch(r"(\d{4})([A-Z])", c)                     # 1312A  (Atria)
    if m: return f"{m.group(1)}-{m.group(2)}"
    m = re.fullmatch(r"(.+)-([A-Z])", c)                       # NB-0809-A, SR2A-A, 16-2-A
    if m: return f"{m.group(1)}-{m.group(2)}"
    return c

readings = {}      # (code, date) -> {value, sheet, row}
raw_codes = {}     # code -> set of sheets
issues = []

for name in SHEETS:
    ws = wb[name]
    r = 1
    while r <= ws.max_row:
        if str(ws.cell(r, 1).value).strip().lower() != "date":
            r += 1
            continue
        cols = {}
        for c in range(2, ws.max_column + 1):
            d = parse_date(ws.cell(r, c).value)
            if d: cols[c] = d
            elif ws.cell(r, c).value is not None:
                issues.append(("日期读不懂", name, r, str(ws.cell(r, c).value), ""))
        rr = r + 1
        while rr <= ws.max_row:
            label = ws.cell(rr, 1).value
            if label is None or str(label).strip().lower() == "date": break
            text = str(label).strip()
            # Some blocks interleave a computed "USAGE" line between the room
            # rows — a difference, not a meter reading.
            if text.upper() in {"USAGE", "TOTAL", "SUM", "AVERAGE", "AVG"}:
                rr += 1
                continue
            code = room_code(label)
            if not re.fullmatch(r".+-[A-Z]", code):
                issues.append(("认不得的房间代号", name, rr, text, ""))
                rr += 1
                continue
            raw_codes.setdefault(code, set()).add(name)
            for c, d in cols.items():
                v = ws.cell(rr, c).value
                if v is None or not isinstance(v, (int, float)): continue
                key = (code, d)
                prev = readings.get(key)
                if prev and prev["value"] != float(v):
                    issues.append(("同一天两个不同读数", name, rr, code,
                                   f"{d}: {prev['value']} vs {v}（{prev['sheet']} / {name}）"))
                readings[key] = {"value": float(v), "sheet": name, "row": rr, "raw": str(label).strip()}
            rr += 1
        r = rr

out = [{"roomCode": k[0], "date": k[1], "value": v["value"], "sheet": v["sheet"], "raw": v["raw"]}
       for k, v in readings.items()]
out.sort(key=lambda x: (x["roomCode"], x["date"]))
json.dump(out, open(".claude-scratch/meter2026.json", "w"), indent=0)
json.dump(issues, open(".claude-scratch/meter2026-issues.json", "w"), indent=0, ensure_ascii=False)

dates = sorted({x["date"] for x in out})
print(f"读到 {len(out)} 笔读数 / {len(raw_codes)} 个房间代号 / {len(dates)} 个抄表日")
print("最近 6 个抄表日:", dates[-6:])
print("解析问题:", len(issues))
for i in issues[:5]: print("  ", i)
