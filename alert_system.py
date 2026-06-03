import pandas as pd
import datetime
import json
import os

# --- Configuration ---
base_dir = os.path.dirname(os.path.abspath(__file__))
input_file = os.path.join(base_dir, 'Datatonkho.xlsx')
output_file = os.path.join(base_dir, 'Datatonkho_CanhBao.xlsx')
# Sử dụng thời gian thực tế để tính toán cảnh báo
CURRENT_TIME_SIMULATION = datetime.datetime.now().time()

# Tải cấu hình định mức sức chứa từ file zoneCfg.js (đồng bộ từ giao diện)
def load_route_type_capacities():
    default_caps = {
        'heavy': 400,
        'city': 250,
        'regional': 2000,
        'inter': 8000
    }
    cfg_file = os.path.join(base_dir, 'zoneCfg.js')
    if os.path.exists(cfg_file):
        try:
            with open(cfg_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            # Trích xuất JSON từ "var GLOBAL_ZONE_CFG = {...};"
            if 'GLOBAL_ZONE_CFG =' in content:
                json_str = content.split('GLOBAL_ZONE_CFG =', 1)[1].strip()
                if json_str.endswith(';'):
                    json_str = json_str[:-1].strip()
                cfg = json.loads(json_str)
                if 'routeTypeCap' in cfg:
                    rtc = cfg['routeTypeCap']
                    return {
                        'heavy': int(rtc.get('heavy', 400)),
                        'city': int(rtc.get('city', 250)),
                        'regional': int(rtc.get('regional', 2000)),
                        'inter': int(rtc.get('inter', 8000))
                    }
        except Exception as e:
            print(f"⚠️ Không thể đọc zoneCfg.js ({e}). Sử dụng định mức mặc định.")
    return default_caps

# Đọc định mức sức chứa hiện tại
ROUTE_TYPE_CAPACITIES = load_route_type_capacities()
print(f"Loaded Route capacities from zoneCfg.js: {ROUTE_TYPE_CAPACITIES}")

# Quy đổi tải trọng → sức chứa đơn hàng dựa trên phân loại tuyến
def get_order_capacity(route_name, dests):
    name_lower = route_name.lower()
    
    # 1. Tuyến giao hàng nặng: 400 đơn đầy xe.
    if 'ghn' in name_lower or 'gxt' in name_lower or any('giao hàng nặng' in d['name'].lower() or 'ghn' in d['name'].lower() for d in dests):
        return ROUTE_TYPE_CAPACITIES['heavy']
        
    # 2. Tuyến nội thành: 250 đơn
    if 'nội thành' in name_lower or 'noi thanh' in name_lower or any('nội thành' in d['name'].lower() or 'noi thanh' in d['name'].lower() for d in dests):
        return ROUTE_TYPE_CAPACITIES['city']
    if name_lower.startswith('sg'):
        return ROUTE_TYPE_CAPACITIES['city']
        
    # 3. Tuyến nội vùng: 2000 đơn
    noi_vung_keywords = ['nội vùng', 'noi vung', 'long an', 'bình dương', 'binh duong', 'tây ninh', 'tay ninh', 
                         'tiền giang', 'tien giang', 'bến tre', 'ben tre', 'đồng nai', 'dong nai', 
                         'bình phước', 'binh phuoc', 'phú quốc', 'phu quoc', 'vũng tàu', 'vung tau']
    if name_lower.startswith('xa') or 'nội vùng' in name_lower or 'noi vung' in name_lower:
        return ROUTE_TYPE_CAPACITIES['regional']
    if any(p in name_lower for p in ['dongnai', 'đnai', 'pq', 'binhphuoc']):
        return ROUTE_TYPE_CAPACITIES['regional']
    if any(any(kw in d['name'].lower() for kw in noi_vung_keywords) for d in dests):
        return ROUTE_TYPE_CAPACITIES['regional']
        
    # 4. Tuyến liên vùng: 8000 đơn
    return ROUTE_TYPE_CAPACITIES['inter']

# --- 1. Load Data ---
print("Reading data...")
df_pv = pd.read_excel(input_file, sheet_name='Tồn kho', header=5)
df_pv = df_pv.rename(columns={df_pv.columns[0]: 'Loại Kho', df_pv.columns[-1]: 'Grand Total'})

df_lich = pd.read_excel(input_file, sheet_name='Lịch tải')

df_raw = pd.read_excel(input_file, sheet_name='Kết quả truy vấn')
print(f"Loaded {len(df_raw)} orders from 'Kết quả truy vấn'")

# --- 2. Build Inventory Lookups ---
# Lookup 1: Tồn kho sheet (for Kho TC/CT/GHN)
inventory_tonkho = {}
for _, row in df_pv.iterrows():
    name = str(row['Loại Kho']).strip()
    if pd.isna(row['Loại Kho']) or name in ('', 'Loại Kho', 'Kho Chuyển Tiếp', 'Kho Giao Hàng Nặng', 'Kho Trung Chuyển', 'Kho KHL', 'Bưu Cục'):
        continue
    total = int(row['Grand Total']) if not pd.isna(row['Grand Total']) else 0
    inventory_tonkho[name] = total

# Lookup 2: Kho tiếp from raw data (for Bưu cục)
inventory_kho_tiep = df_raw['Kho tiếp'].value_counts().to_dict()

# --- 3. Matching Functions ---
def find_inventory(dest_name):
    """Find inventory for a destination. Returns (inventory, matched_name)"""
    dest = str(dest_name).strip()
    if 'Hồ Chí Minh 01' in dest:
        return 0, 'Kho xuất (HCM01)'
    
    # 1. Exact match in Kho tiếp
    if dest in inventory_kho_tiep:
        return inventory_kho_tiep[dest], dest
        
    # 2. Exact match in Tồn kho sheet
    if dest in inventory_tonkho:
        return inventory_tonkho[dest], dest

    # 3. Fuzzy match Kho tiếp
    for kt, count in inventory_kho_tiep.items():
        if pd.isna(kt): continue
        if dest in str(kt) or str(kt) in dest:
            return count, str(kt)
            
    # 4. Fuzzy match by removing prefixes
    clean = dest.replace('Bưu Cục ', '').replace('Bưu cục ', '').replace('Kho Trung Chuyển ', '').strip()
    if clean:
        for kt, count in inventory_kho_tiep.items():
            if pd.isna(kt): continue
            if clean in str(kt):
                return count, str(kt)

    # 5. Fuzzy match Tồn kho (ONLY for KTC/KCT to avoid matching a province to a specific BC)
    if 'Kho' in dest or dest == 'Hồ Chí Minh' or dest == 'Hà Nội':
        for kho_name, total in inventory_tonkho.items():
            if kho_name in dest or dest in kho_name:
                return total, kho_name

    return 0, dest

# --- 4. Process Alerts ---
print("\nProcessing alerts...")
current_dt = datetime.datetime.combine(datetime.date.today(), CURRENT_TIME_SIMULATION)

# Group by tuyến and collect origin departure time
route_groups = {}
for _, row in df_lich.iterrows():
    route = row['Tên tuyến']
    if pd.isna(route): continue
    route = str(route).strip()
    if route not in route_groups:
        route_groups[route] = {'capacity_kg': int(row['Tải trọng']) if not pd.isna(row['Tải trọng']) else 0, 'dests': [], 'origin_dep_time': None}
    
    dest = row['Tên kho']
    if pd.isna(dest): continue
    
    if 'Hồ Chí Minh 01' in str(dest):
        # Chỉ lấy dòng ĐẦU TIÊN của mỗi COT (lần xuất hiện HCM01 đầu tiên)
        if route_groups[route]['origin_dep_time'] is None:
            route_groups[route]['origin_dep_time'] = row['Rời điểm']
    else:
        route_groups[route]['dests'].append({
            'name': str(dest).strip(),
            'loai': str(row['Loại hình']) if not pd.isna(row['Loại hình']) else ''
        })

# Pre-calculate hours_left for each route based on origin_dep_time
for route, info in route_groups.items():
    dep = info['origin_dep_time']
    hours_left = 999
    if dep is not None and not pd.isna(dep):
        try:
            if isinstance(dep, datetime.time):
                dep_dt = datetime.datetime.combine(datetime.date.today(), dep)
            else:
                dep_dt = datetime.datetime.combine(datetime.date.today(), datetime.datetime.strptime(str(dep), '%H:%M:%S').time())
            if dep_dt < current_dt:
                dep_dt += datetime.timedelta(days=1)
            hours_left = (dep_dt - current_dt).total_seconds() / 3600
        except Exception:
            pass
    info['hours_left'] = hours_left

# Determine the NEXT closest route for each destination
next_route_for_dest = {}
dest_routes = {}
for route, info in route_groups.items():
    if info['capacity_kg'] <= 0: continue
    for d in info['dests']:
        dname = d['name']
        
        # Rule 1: XA routes only calculate fill rate for BC. Ignore KTC/KCT and other points.
        if route.startswith('XA') and not dname.lower().startswith('bưu cục'):
            continue
            
        if dname not in dest_routes:
            dest_routes[dname] = []
        dest_routes[dname].append((route, info['hours_left']))

for dname, rlist in dest_routes.items():
    valid = [r for r in rlist if r[1] >= 0]
    if valid:
        valid.sort(key=lambda x: x[1])
        next_route_for_dest[dname] = valid[0][0]

results = []
for route_name, info in route_groups.items():
    capacity_kg = info['capacity_kg']
    if capacity_kg <= 0: continue
    order_cap = get_order_capacity(route_name, info['dests'])
    
    total_inv = 0
    matched = []
    
    for d in info['dests']:
        dname = d['name']
        
        # Rule 1: XA routes only calculate fill rate for BC. Ignore KTC/KCT and other points.
        if route_name.startswith('XA') and not dname.lower().startswith('bưu cục'):
            continue
            
        # Only assign inventory if this route is the NEXT COT for this destination
        if next_route_for_dest.get(dname) == route_name:
            inv, mname = find_inventory(dname)
            total_inv += inv
            if inv > 0:
                matched.append(f"{mname}({inv:,})")
    
    fill_rate = total_inv / order_cap if order_cap > 0 else 0
    hours_left = info['hours_left']
    
    # Check aging (>24h orders)
    aging_sum = 0
    for d in info['dests']:
        for kho_name in inventory_tonkho:
            if kho_name in d['name'] or d['name'] in kho_name:
                wh_match = df_pv[df_pv['Loại Kho'].astype(str).str.strip() == kho_name]
                if not wh_match.empty:
                    r = wh_match.iloc[0]
                    for col_idx in range(4, 10):
                        try:
                            v = float(r.iloc[col_idx])
                            if not pd.isna(v):
                                aging_sum += v
                        except Exception:
                            pass
    has_aging = aging_sum > 0
    
    # Evaluation
    danh_gia = "🟢 An Toàn"
    phuong_an = "Duy trì bình thường"
    
    if fill_rate >= 0.8 and hours_left < 2:
        danh_gia = "🔴 Báo Động Đỏ"
        phuong_an = "Tồn cao + Giờ gấp: Điều phối gấp toàn lực lượng, gọi xe tăng cường."
    elif has_aging and fill_rate >= 0.5:
        danh_gia = "🔴 Báo Động Đỏ"
        phuong_an = f"Có {int(aging_sum)} đơn tồn > 24h: Ưu tiên xử lý lô hàng cũ (FIFO)."
    elif fill_rate >= 1.0:
        danh_gia = "🟡 Cảnh Báo Vàng"
        phuong_an = f"Hàng tồn vượt sức chứa ({fill_rate*100:.0f}%): Cân nhắc tăng chuyến."
    elif fill_rate >= 0.8 and hours_left <= 4:
        danh_gia = "🟡 Cảnh Báo Vàng"
        phuong_an = "Tồn đang tăng: Báo trước để team kho chuẩn bị đẩy nhanh."
    elif fill_rate >= 0.5 and hours_left < 2:
        danh_gia = "🟡 Cảnh Báo Vàng"
        phuong_an = "Giờ gấp: Xả hàng CBS, hoàn tất đóng bao."
    
    origin_dep = info.get('origin_dep_time')
    dep_str = origin_dep.strftime('%H:%M') if isinstance(origin_dep, datetime.time) else (str(origin_dep) if origin_dep else '')
    
    results.append({
        'Tên tuyến': route_name,
        'Kho đích': ', '.join(matched) if matched else 'Không match',
        'Tải trọng': capacity_kg,
        'Sức chứa (đơn)': order_cap,
        'Tồn hiện tại': total_inv,
        'Tỷ lệ lấp đầy': f"{fill_rate*100:.1f}%",
        'Giờ xuất': dep_str,
        'Giờ còn lại': f"{hours_left:.1f}h",
        'Hàng tồn > 24h': f"Có ({int(aging_sum)})" if has_aging else "Không",
        'Đánh giá': danh_gia,
        'Phương án': phuong_an
    })

df_results = pd.DataFrame(results)
print("\n--- BÁO CÁO CẢNH BÁO TỒN KHO ---")
print(df_results[['Tên tuyến', 'Sức chứa (đơn)', 'Tồn hiện tại', 'Tỷ lệ lấp đầy', 'Đánh giá']].to_string())

print(f"\nWriting results to {output_file}...")
df_results.to_excel(output_file, index=False, sheet_name='Cảnh Báo')
print("Xong!")

# --- 5. Export Inventory Data to JSON ---
print("\nExporting inventory data to JSON...")
inventory_data = []
def safe_int(val):
    if pd.isna(val): return 0
    try: return int(val)
    except Exception: return 0

for _, row in df_pv.iterrows():
    kho_name = str(row['Loại Kho']).strip()
    if pd.isna(row['Loại Kho']) or kho_name in ('', 'Loại Kho', 'Grand Total', 'Nội vùng', 'Kho Trung Chuyển', 'Kho Chuyển Tiếp', 'Nội thành', 'Bình Dương', 'Hồ Chí Minh', 'Long An', 'Phú Quốc', 'Đồng Nai', 'Tây Ninh', 'Bến Tre', 'Bà Rịa - Vũng Tàu', 'Tiền Giang', 'Khác', 'Đông Nam Bộ', 'Tây Nam Bộ', 'Miền Bắc', 'Miền Trung', 'Kho Giao Hàng Nặng', 'Kho KHL', 'Bưu Cục', 'Kho Chuyển Tiếp Đồng Nai', 'Kho Chuyển Tiếp Bình Phước', 'Kho Chuyển Tiếp Bình Thuận', 'Kho Chuyển Tiếp Đắk Nông', 'Kho Chuyển Tiếp Quảng Ngãi', 'Kho Chuyến Tiếp Thanh Hoá', 'Kho Trung Chuyển Bình Định', 'Kho Trung Chuyển Cần Thơ', 'Kho Trung Chuyển Đà Nẵng', 'Kho Trung Chuyển Đắk Lắk'):
        continue
    inventory_data.append({
        'kho': str(kho_name), 'h_0_6': safe_int(row.iloc[1]), 'h_6_12': safe_int(row.iloc[2]),
        'h_12_24': safe_int(row.iloc[3]), 'h_24_36': safe_int(row.iloc[4]), 'h_36_48': safe_int(row.iloc[5]),
        'h_48_72': safe_int(row.iloc[6]), 'h_72_96': safe_int(row.iloc[7]), 'h_96_120': safe_int(row.iloc[8]),
        'h_120_plus': safe_int(row.iloc[9]), 'total': safe_int(row['Grand Total'])
    })

with open(os.path.join(base_dir, 'inventory_data.json'), 'w', encoding='utf-8') as f:
    json.dump(inventory_data, f, ensure_ascii=False, indent=2)
print(f"Exported {len(inventory_data)} inventory rows.")

# --- 6. Export Route Inventory to JSON ---
print("\nExporting route inventory to JSON...")
with open(os.path.join(base_dir, 'route_inventory.json'), 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print(f"Exported {len(results)} route summaries.")

# --- 6. Export Fleet Data to JSON ---
print("\nExporting fleet data to JSON...")
fleet_data = {}
def format_time(t):
    if pd.isna(t): return ""
    if isinstance(t, datetime.time): return t.strftime('%H:%M')
    return str(t)

for _, row in df_lich.iterrows():
    rn = str(row['Tên tuyến']).strip()
    if pd.isna(row['Tên tuyến']) or rn == 'nan':
        continue
    group = rn.split('_')[0] if '_' in rn else "Khác"
    if group not in fleet_data:
        fleet_data[group] = []
    fleet_data[group].append({
        'tuyen': rn,
        'tai_trong': int(row['Tải trọng']) if not pd.isna(row['Tải trọng']) else 0,
        'diem_dung': str(row['Tên kho']) if not pd.isna(row['Tên kho']) else '',
        'loai_hinh': str(row['Loại hình']) if not pd.isna(row['Loại hình']) else '',
        'gio_den': format_time(row['Tới điểm']),
        'gio_roi': format_time(row['Rời điểm'])
    })

with open(os.path.join(base_dir, 'fleet.json'), 'w', encoding='utf-8') as f:
    json.dump(fleet_data, f, ensure_ascii=False, indent=2)
print(f"Exported {sum(len(v) for v in fleet_data.values())} fleet routes into {len(fleet_data)} groups.")

# --- 7. Export Alerts to JSON ---
print("\nExporting alerts to JSON...")
alerts = []
for row in results:
    dg = str(row['Đánh giá'])
    level = 'critical' if '🔴' in dg else ('warning' if '🟡' in dg else 'info')
    if level in ('critical', 'warning'):
        alerts.append({
            'level': level,
            'title': f"{dg.replace('🔴','').replace('🟡','').strip()}: {row['Tên tuyến']}",
            'desc': f"{row['Kho đích']}. {row['Phương án']}",
            'category': 'Inventory & Fleet',
            'am': 'Hệ Thống',
            'ton_hien_tai': int(row['Tồn hiện tại']),
            'suc_chua': int(row['Sức chứa (đơn)']),
            'ty_le': row['Tỷ lệ lấp đầy'],
            'gio_con_lai': row['Giờ còn lại'],
            'gio_xuat': row['Giờ xuất']
        })

with open(os.path.join(base_dir, 'inventory_alerts.json'), 'w', encoding='utf-8') as f:
    json.dump(alerts, f, ensure_ascii=False, indent=2)
print(f"Generated {len(alerts)} alerts.")
# --- 8. Export Hierarchical Inventory to JSON ---
print("\nExporting hierarchical inventory to JSON...")
PARENT_CATEGORIES = ['Kho Chuyển Tiếp', 'Kho Giao Hàng Nặng', 'Kho Trung Chuyển', 'Kho KHL', 'Nội Thành', 'Nội vùng', 'Phú Quốc', 'Miền Bắc', 'Miền Trung', 'Đông Nam Bộ', 'Tây Nam Bộ']

# Build lookup: kho_tiep → {Normal, Bulky, Freight} counts from raw data (EXACT keys only)
loai_hang_lookup = {}
if 'Loại hàng' in df_raw.columns and 'Kho tiếp' in df_raw.columns:
    for _, r in df_raw.iterrows():
        ktiep = str(r['Kho tiếp']).strip() if not pd.isna(r['Kho tiếp']) else ''
        loai  = str(r['Loại hàng']).strip() if not pd.isna(r['Loại hàng']) else ''
        if not ktiep or ktiep == 'nan': continue
        if ktiep not in loai_hang_lookup:
            loai_hang_lookup[ktiep] = {'Normal': 0, 'Bulky': 0, 'Freight': 0}
        if loai in ('Normal', 'Bulky', 'Freight'):
            loai_hang_lookup[ktiep][loai] += 1

def get_loai_hang_child(kho_name):
    """
    Safe matching for CHILD rows only.
    Rule: exact match → then kho_name is substring of key (safe direction only).
    Never match: key is substring of kho_name (too broad, causes false positives).
    Requires kho_name >= 15 chars to avoid matching short province names.
    """
    # 1. Exact match
    if kho_name in loai_hang_lookup:
        return dict(loai_hang_lookup[kho_name])

    # 2. Safe fuzzy: kho_name must be contained in the lookup key
    #    AND kho_name must be specific enough (>= 15 chars)
    if len(kho_name) >= 15:
        kho_lower = kho_name.lower()
        best = None
        best_len = 0
        for k, v in loai_hang_lookup.items():
            if kho_lower in k.lower() and len(k) > best_len:
                best = v
                best_len = len(k)
        if best:
            return dict(best)

    return {'Normal': 0, 'Bulky': 0, 'Freight': 0}

hierarchy_data = []
current_parent = None

for _, row in df_pv.iterrows():
    kho_name = str(row['Loại Kho']).strip()
    if pd.isna(row['Loại Kho']) or kho_name in ('', 'Loại Kho', 'Grand Total', 'Khác', 'Bưu Cục'):
        continue

    total = safe_int(row['Grand Total'])
    is_parent = kho_name in PARENT_CATEGORIES

    if is_parent and (current_parent is None or current_parent['name'] != kho_name):
        # Parent rows: initialize Normal/Bulky/Freight = 0 → will be rolled up from children
        current_parent = {
            'name': kho_name, 'total': total,
            'normal': 0, 'bulky': 0, 'freight': 0,
            'children': []
        }
        hierarchy_data.append(current_parent)
    else:
        # Child rows: use safe matching
        loai_counts = get_loai_hang_child(kho_name)
        child = {
            'name': kho_name, 'total': total,
            'normal': loai_counts['Normal'], 'bulky': loai_counts['Bulky'], 'freight': loai_counts['Freight']
        }
        if current_parent is not None:
            current_parent['children'].append(child)
        else:
            hierarchy_data.append({
                'name': kho_name, 'total': total,
                'normal': loai_counts['Normal'], 'bulky': loai_counts['Bulky'], 'freight': loai_counts['Freight'],
                'children': []
            })

# Roll up Normal/Bulky/Freight from children to parent (always sum, never fallback)
for group in hierarchy_data:
    if group.get('children'):
        group['normal']  = sum(c.get('normal', 0)  for c in group['children'])
        group['bulky']   = sum(c.get('bulky', 0)   for c in group['children'])
        group['freight'] = sum(c.get('freight', 0) for c in group['children'])

# --- Business Rule: Force Normal=0 for GHN and Nội Thành groups ---
# Kho Giao Hàng Nặng only handles Bulky/Freight; Normal items are data noise.
# Nội Thành routes similarly do not carry Normal classified parcels.
NO_NORMAL_GROUPS = {'Kho Giao Hàng Nặng', 'Nội Thành', 'Nội thành'}

for group in hierarchy_data:
    if group['name'] in NO_NORMAL_GROUPS:
        group['normal'] = 0
        for child in group.get('children', []):
            child['normal'] = 0

with open(os.path.join(base_dir, 'hierarchy_inventory.json'), 'w', encoding='utf-8') as f:
    json.dump(hierarchy_data, f, ensure_ascii=False, indent=2)
print(f"Exported hierarchical inventory with Normal/Bulky/Freight breakdown.")


# --- 9. Export COT Departure Alerts (within 30 minutes) to JSON ---
print("\nExporting COT departure alerts (within 30 minutes)...")
ALERT_WINDOW_MINUTES = 30
cot_alerts = []

for route_name, info in route_groups.items():
    capacity_kg = info['capacity_kg']
    if capacity_kg <= 0:
        continue

    hours_left = info.get('hours_left', 999)
    minutes_left = hours_left * 60

    # Only include COTs departing within the next 30 minutes (and not already departed)
    if minutes_left < 0 or minutes_left > ALERT_WINDOW_MINUTES:
        continue

    order_cap = get_order_capacity(route_name, info['dests'])
    origin_dep = info.get('origin_dep_time')
    dep_str = origin_dep.strftime('%H:%M') if isinstance(origin_dep, datetime.time) else (str(origin_dep)[:5] if origin_dep else '—')

    # Build per-stop inventory breakdown
    stops_detail = []
    total_inv = 0

    for d in info['dests']:
        dname = d['name']
        loai = d.get('loai', '')

        # For XA routes, only count Bưu Cục
        if route_name.startswith('XA') and not dname.lower().startswith('bưu cục'):
            inv = 0
            matched_name = dname
        else:
            inv, matched_name = find_inventory(dname)

        total_inv += inv

        # Arrival/departure time at each stop from fleet data
        stop_gio_den = ''
        stop_gio_roi = ''
        if route_name in fleet_data:
            for stop in fleet_data[route_name]:
                if stop.get('diem_dung', '').strip() == dname:
                    stop_gio_den = stop.get('gio_den', '')
                    stop_gio_roi = stop.get('gio_roi', '')
                    break

        stops_detail.append({
            'name': dname,
            'loai': loai,
            'inventory': inv,
            'gio_den': stop_gio_den,
            'gio_roi': stop_gio_roi,
        })

    fill_rate = total_inv / order_cap if order_cap > 0 else 0

    # Risk of drop assessment
    if fill_rate >= 1.0:
        drop_risk = '🔴 RẤT CAO - Hàng chắc chắn rớt'
        drop_level = 'critical'
    elif fill_rate >= 0.85:
        drop_risk = '🟠 CAO - Nguy cơ rớt hàng cao'
        drop_level = 'high'
    elif fill_rate >= 0.65:
        drop_risk = '🟡 TRUNG BÌNH - Cần theo dõi'
        drop_level = 'medium'
    else:
        drop_risk = '🟢 THẤP - Đủ sức chứa'
        drop_level = 'low'

    # Determine COT prefix for category
    cot_type = route_name.split('_')[0] if '_' in route_name else route_name

    cot_alerts.append({
        'tuyen': route_name,
        'cot_type': cot_type,
        'gio_xuat_hcm01': dep_str,
        'minutes_left': round(minutes_left, 1),
        'tai_trong_kg': capacity_kg,
        'suc_chua_don': order_cap,
        'tong_ton': total_inv,
        'ty_le_lay_day': f"{fill_rate * 100:.1f}%",
        'drop_risk': drop_risk,
        'drop_level': drop_level,
        'stops': stops_detail,
    })

# Sort by nearest departure first
cot_alerts.sort(key=lambda x: x['minutes_left'])

with open(os.path.join(base_dir, 'cot_alerts.json'), 'w', encoding='utf-8') as f:
    json.dump(cot_alerts, f, ensure_ascii=False, indent=2)
print(f"Exported {len(cot_alerts)} COT departure alerts (within {ALERT_WINDOW_MINUTES} minutes).")

