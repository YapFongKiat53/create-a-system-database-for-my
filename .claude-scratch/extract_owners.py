import json, re, datetime, openpyxl

SRC = "/Users/yapfongkiat/Downloads/UNIT copy.xlsx"
wb = openpyxl.load_workbook(SRC, data_only=True)

def clean(v):
    if v is None: return ""
    if isinstance(v, datetime.datetime): return v.date().isoformat()
    s = str(v).replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip()

def unit_codes(raw):
    """Excel writes unit codes the way the paperwork does; the database uses
    one canonical form per property. D1-01-13 -> D1-0113, 'SR 2A' -> SR2A,
    and the shop lot row covers two units at once."""
    raw = clean(raw)
    if not raw: return []
    if "/" in raw:
        return [c for part in raw.split("/") for c in unit_codes(part)]
    code = raw.replace(" ", "").upper()
    m = re.fullmatch(r"(D\d)-(\d{2})-(\d{2})", code)
    if m: return [f"{m.group(1)}-{m.group(2)}{m.group(3)}"]
    return [code]

HEADERS = {"UNIT", "OWNER NAME", "NRIC", "CONTACT", "ADDRESS", "SIGNED"}
def is_data_row(first):
    c = clean(first).upper()
    if not c or c in HEADERS: return False
    if c.startswith("BLOCK ") or "APARTMENT" in c or c in {"SUBANG RESIDENCES", "SHOP LOT"}: return False
    return True

owners = {}   # unit code -> record
notes_by_unit = {}

# --- OWNER DETAILS: the owner register (name, NRIC, contact, address) -------
ws = wb["OWNER DETAILS"]
for r in range(1, ws.max_row + 1):
    row = [ws.cell(r, c).value for c in range(1, 6)]
    if not is_data_row(row[0]): continue
    name, nric, contact, address = (clean(x) for x in row[1:5])
    for code in unit_codes(row[0]):
        owners[code] = {
            "unitCode": code, "excelUnit": clean(row[0]), "ownerName": name,
            "ownerIdentityNo": nric, "contact": contact, "address": address,
            "sources": ["OWNER DETAILS"],
        }

# --- AGREEMENT sheets: the terms -------------------------------------------
for sheet in ["ATRIA & OTHERS AGREEMENT", "DAMAI AGREEMENT"]:
    ws = wb[sheet]
    for r in range(1, ws.max_row + 1):
        row = [ws.cell(r, c).value for c in range(1, 12)]
        if not is_data_row(row[0]): continue
        rental, signed, stamping = row[4], clean(row[5]), clean(row[6])
        start, end, renew, ta = clean(row[7]), clean(row[8]), clean(row[9]), clean(row[10])
        for code in unit_codes(row[0]):
            rec = owners.setdefault(code, {
                "unitCode": code, "excelUnit": clean(row[0]), "ownerName": clean(row[1]),
                "ownerIdentityNo": clean(row[2]), "contact": clean(row[3]),
                "address": "", "sources": [],
            })
            rec["sources"].append(sheet)
            # The name in the agreement sheet is a copy; where the two sheets
            # disagree the owner register wins and the difference is reported.
            other = clean(row[1])
            if other and rec["ownerName"] and other != rec["ownerName"]:
                rec["nameConflict"] = other
            # "RENTAL/%": a monthly ringgit figure, or a fraction (0.18) that
            # means the owner is on a service agreement at 18%.
            if isinstance(rental, (int, float)):
                if rental < 1:
                    rec["agreementType"] = "service"
                    rec["servicePercentage"] = round(rental * 100, 2)
                else:
                    rec["agreementType"] = "rental"
                    rec["monthlyLeaseRental"] = float(rental)
            rec["leaseStartDate"] = start or None
            rec["leaseEndDate"] = end or None
            bits = []
            if signed: bits.append(f"Agreement signed: {signed}")
            if stamping: bits.append(f"Stamping: {stamping}")
            if renew: bits.append(f"Option to renew: {renew}")
            if ta: bits.append(f"TA uploaded: {ta}")
            rec["agreementNotes"] = " · ".join(bits)

out = sorted(owners.values(), key=lambda x: x["unitCode"])
json.dump(out, open(".claude-scratch/owner-details.json", "w"), indent=1, ensure_ascii=False)
print(f"{len(out)} 个 unit code 从 Excel 抽出")
print("有 agreement 条款的:", sum(1 for x in out if x.get("leaseStartDate")))
print("service agreement (%):", [x["unitCode"] for x in out if x.get("agreementType") == "service"])
print("名字冲突:", [(x["unitCode"], x["ownerName"], x["nameConflict"]) for x in out if "nameConflict" in x])
print("NRIC 等于名字:", [x["unitCode"] for x in out if x["ownerIdentityNo"] and x["ownerIdentityNo"] == x["ownerName"]])
