#!/usr/bin/env python3
"""
📊 Export Tồn Kho v2 — Tổng hợp dữ liệu thô → format Form Final (PV)

Đọc Datatonkho.xlsx (chi tiết đơn) + Form Final.xlsx (tham số mapping)
→ Tạo Pivot: Loại Kho / Kho đến / Tỉnh giao × Mốc thời gian tồn
→ Inject vào ktc_health.html + xuất JSON/JS/XLSX
"""
import pandas as pd
import json, re, sys, warnings, os, requests
from datetime import datetime
from pathlib import Path
from collections import OrderedDict

warnings.filterwarnings('ignore')

BASE       = Path(__file__).parent
EXCEL_FILE = BASE / 'Datatonkho.xlsx'
PARAMS_FILE= BASE / 'Form Final.xlsx'
HTML_FILE  = BASE / 'ktc_health.html'
JSON_FILE  = BASE / 'tonkho_tuyen.json'
JS_FILE    = BASE / 'tonkho_data.js'
PIVOT_FILE = BASE / 'BaoCao_TonKho.xlsx'

# Thứ tự mốc thời gian
AGING_ORDER = [
    '1. 0-6', '2. 6-12', '3. 12-24', '4. 24-36',
    '5. 36-48', '6. 48-72', '7. 72-96', '8. 96-120', '9. 120+'
]

# Thứ tự nhóm kho
GROUP_ORDER = [
    'Kho Chuyển Tiếp', 'Kho Giao Hàng Nặng', 'Kho KHL',
    'Kho Trung Chuyển', 'Nội Thành', 'Nội vùng', 'Phú Quốc'
]

def load_params():
    """Đọc bảng tham số mapping tỉnh → kho → loại kho."""
    csv_file = BASE / 'mapping_params.csv'
    if csv_file.exists():
        try:
            params = pd.read_csv(csv_file)
            print(f"📋 Đọc tham số từ CSV: {len(params)} dòng mapping")
            return params
        except Exception as e:
            print(f"⚠️ Lỗi đọc file CSV: {e}. Thử đọc Excel...")
            
    if not PARAMS_FILE.exists():
        print(f"⚠️ Không tìm thấy {PARAMS_FILE.name} hoặc {csv_file.name}, dùng mapping tự động.")
        return None
    params = pd.read_excel(PARAMS_FILE, sheet_name='Tham Số 1')
    print(f"📋 Đọc tham số từ Excel: {len(params)} dòng mapping")
    
    # Tự động đồng bộ ra CSV cục bộ để sẵn sàng commit lên Git
    try:
        params.to_csv(csv_file, index=False, encoding='utf-8')
        print(f"✨ Đã tự động đồng bộ tham số ra {csv_file.name}")
    except Exception as e:
        print(f"⚠️ Không thể lưu tham số ra CSV: {e}")
        
    return params

def guess_params_for_missing_key(key):
    """
    Tự động đoán tham số cho một tỉnh giao / kho tiếp mới chưa có trong mapping.
    """
    key_str = str(key).strip()
    key_lower = key_str.lower()
    
    # Mặc định
    vung = "Khác"
    lv1 = key_str
    lv2 = key_str
    kho_den = key_str
    loai_kho = "Kho Trung Chuyển"
    phan_vung = "Liên vùng"
    mien = "Trung"
    
    # 1. Đoán Loại kho & Kho Đến dựa vào tên kho
    if "kho trung chuyển" in key_lower or "ktc" in key_lower:
        loai_kho = "Kho Trung Chuyển"
        kho_den = key_str
    elif "kho chuyển tiếp" in key_lower or "kct" in key_lower:
        loai_kho = "Kho Chuyển Tiếp"
        kho_den = key_str
    elif "kho giao hàng nặng" in key_lower or "ghn" in key_lower:
        loai_kho = "Kho Giao Hàng Nặng"
        kho_den = key_str
    elif "kho khl" in key_lower or "key account" in key_lower:
        loai_kho = "Kho KHL"
        kho_den = key_str
    elif "bưu cục" in key_lower or "bc" in key_lower:
        if "hồ chí minh" in key_lower or "hcm" in key_lower:
            loai_kho = "Nội Thành"
            kho_den = "Hồ Chí Minh"
            phan_vung = "Nội Thành"
            mien = "Nam"
        else:
            loai_kho = "Nội vùng"
            kho_den = key_str
            phan_vung = "Nội vùng"
            mien = "Nam"
            
    # 2. Đoán dựa trên tên Tỉnh giao nếu là tỉnh
    south_provinces = ["bình dương", "đồng nai", "long an", "tây ninh", "tiền giang", "bến tre", "bà rịa - vũng tàu", "vũng tàu", "cần thơ", "vĩnh long", "đồng tháp", "an giang", "kiên giang", "cà mau", "bạc liêu", "sóc trăng", "trà vinh", "hậu giang"]
    for p in south_provinces:
        if p in key_lower:
            loai_kho = "Nội vùng"
            kho_den = p.title()
            vung = "Nam"
            phan_vung = "Nội vùng"
            mien = "Nam"
            break
            
    if "hồ chí minh" in key_lower or "hcm" in key_lower:
        loai_kho = "Nội Thành"
        kho_den = "Hồ Chí Minh"
        vung = "Nội thành"
        phan_vung = "Nội Thành"
        mien = "Nam"
    elif "phú quốc" in key_lower:
        loai_kho = "Phú Quốc"
        kho_den = "Phú Quốc"
        vung = "Phú Quốc"
        phan_vung = "Phú Quốc"
        mien = "Nam"
        
    return {
        'Tỉnh giao': key_str,
        'Loại hàng': None,
        'Vùng': vung,
        'LV-1': lv1,
        'LV-2': lv2,
        'Kho Đến': kho_den,
        'Loại kho': loai_kho,
        'Phân vùng': phan_vung,
        'Miền': mien
    }

def append_param_to_excel(param_row):
    """
    Tự động ghi đè/thêm dòng tham số mới vào sheet 'Tham Số 1' của Form Final.xlsx.
    """
    try:
        import openpyxl
        wb = openpyxl.load_workbook(PARAMS_FILE)
        ws = wb['Tham Số 1']
        
        # Lấy header dòng 1 để sắp xếp đúng cột
        headers = [ws.cell(row=1, column=c).value for c in range(1, 10)]
        row_data = []
        for h in headers:
            row_data.append(param_row.get(h, ""))
            
        ws.append(row_data)
        wb.save(PARAMS_FILE)
        print(f"✨ Đã tự động cập nhật tham số mới vào {PARAMS_FILE.name}: {param_row['Tỉnh giao']} -> {param_row['Loại kho']}")
    except Exception as e:
        print(f"⚠️ Không thể tự động ghi tham số vào file Excel: {e}")

def classify_by_params(df, params):
    """Phân loại đơn theo bảng tham số (Kho tiếp & Tỉnh giao → LV-2 → Kho Đến → Loại kho)."""
    # Xây dựng các mapping case-insensitive (không strip() để khớp chính xác như Excel VLOOKUP)
    map_tinh_to_lv2 = {}
    map_tinh_to_phanvung = {}
    has_phanvung = 'Phân vùng' in params.columns
    has_loaikho = 'Loại kho' in params.columns
    for _, r in params.iterrows():
        k = str(r['Tỉnh giao']).lower()
        if k not in map_tinh_to_lv2:
            map_tinh_to_lv2[k] = r['LV-2']
        if k not in map_tinh_to_phanvung:
            val = r['Phân vùng'] if has_phanvung else None
            if pd.isna(val) or val == '' or val is None:
                val = r['Loại kho'] if has_loaikho else 'Liên vùng'
            map_tinh_to_phanvung[k] = val

    map_lv2_to_khoden = {}
    for _, r in params.iterrows():
        k = str(r['LV-2']).lower()
        if k not in map_lv2_to_khoden:
            map_lv2_to_khoden[k] = r['Kho Đến']

    map_khoden_to_loaikho = {}
    for _, r in params.iterrows():
        k = str(r['Kho Đến']).lower()
        if k not in map_khoden_to_loaikho:
            map_khoden_to_loaikho[k] = r['Loại kho']

    # Danh sách kết quả
    loai_kho_list = []
    kho_den_list = []
    phan_vung_list = []

    for _, r in df.iterrows():
        kho_tiep = str(r['next_warehouse_name']).lower() if pd.notna(r['next_warehouse_name']) else ''
        tinh_giao = str(r['deliver_province']).lower() if pd.notna(r['deliver_province']) else ''
        loai_hang = str(r['loaihang']).strip() if pd.notna(r['loaihang']) else ''

        # 1. Điều kiện 1 (S): lookup next_warehouse_name trong Tỉnh giao
        s_val = map_tinh_to_lv2.get(kho_tiep, '')
        if pd.isna(s_val): s_val = ''

        # 2. Điều kiện 2 (T)
        if s_val != '':
            t_val = s_val
        else:
            # Nếu tỉnh giao chưa có trong tham số, tự động tạo & cập nhật
            tinh_giao_raw = str(r['deliver_province']).strip() if pd.notna(r['deliver_province']) else ''
            if tinh_giao_raw and tinh_giao_raw.lower() not in map_tinh_to_lv2:
                guessed = guess_params_for_missing_key(tinh_giao_raw)
                append_param_to_excel(guessed)
                
                # Cập nhật vào dictionary nhớ tạm thời để các dòng tiếp theo dùng
                map_tinh_to_lv2[tinh_giao_raw.lower()] = guessed['LV-2']
                map_tinh_to_phanvung[tinh_giao_raw.lower()] = guessed['Phân vùng']
                
                glv2_lower = str(guessed['LV-2']).lower()
                if glv2_lower not in map_lv2_to_khoden:
                    map_lv2_to_khoden[glv2_lower] = guessed['Kho Đến']
                
                gkhoden_lower = str(guessed['Kho Đến']).lower()
                if gkhoden_lower not in map_khoden_to_loaikho:
                    map_khoden_to_loaikho[gkhoden_lower] = guessed['Loại kho']
            
            t_val = map_tinh_to_lv2.get(tinh_giao, '')
            if pd.isna(t_val): t_val = ''

        t_val_str = str(t_val)
        t_val_lower = t_val_str.lower()

        # 3. KHO ĐẾN (U)
        if t_val_lower == 'kho trung chuyển hà nội 02' and loai_hang == 'Freight':
            my_kho_den = 'Kho Trung Chuyển Dương Xá'
        else:
            if t_val_lower and t_val_lower not in map_lv2_to_khoden:
                guessed = guess_params_for_missing_key(t_val_str)
                append_param_to_excel(guessed)
                map_lv2_to_khoden[t_val_lower] = guessed['Kho Đến']
                
                gkhoden_lower = str(guessed['Kho Đến']).lower()
                if gkhoden_lower not in map_khoden_to_loaikho:
                    map_khoden_to_loaikho[gkhoden_lower] = guessed['Loại kho']
            
            my_kho_den = map_lv2_to_khoden.get(t_val_lower, '')
            if pd.isna(my_kho_den): my_kho_den = ''

        my_kho_den_str = str(my_kho_den)
        my_kho_den_lower = my_kho_den_str.lower()

        # 4. LOẠI KHO (V)
        if my_kho_den_lower and my_kho_den_lower not in map_khoden_to_loaikho:
            guessed = guess_params_for_missing_key(my_kho_den_str)
            append_param_to_excel(guessed)
            map_khoden_to_loaikho[my_kho_den_lower] = guessed['Loại kho']

        my_loai_kho = map_khoden_to_loaikho.get(my_kho_den_lower, '')
        if pd.isna(my_loai_kho): my_loai_kho = ''
        my_loai_kho_str = str(my_loai_kho)

        # 5. Phân vùng (dựa vào tinh_giao để lấy Phân vùng trong mapping)
        my_phan_vung = map_tinh_to_phanvung.get(tinh_giao, '')
        if pd.isna(my_phan_vung): my_phan_vung = ''

        loai_kho_list.append(my_loai_kho_str)
        kho_den_list.append(my_kho_den_str)
        phan_vung_list.append(my_phan_vung)

    df['_loai_kho'] = loai_kho_list
    df['_kho_den'] = kho_den_list
    df['_phan_vung'] = phan_vung_list

    return df

def classify_auto(df):
    """Phân loại tự động dựa trên cột có sẵn."""
    # Dùng Vùng column để xác định phân vùng
    vung_map = {
        'Nội thành': 'Nội Thành',
        'Nội vùng': 'Nội vùng',
        'Liên Vùng': 'Liên Vùng',
    }

    def guess_loai_kho(row):
        vung = str(row.get('Vùng', ''))
        if vung == 'Nội thành':
            return 'Nội Thành'
        elif vung == 'Nội vùng':
            return 'Nội vùng'
        else:
            # Dùng next_warehouse_name để phân loại
            nxt = str(row.get('next_warehouse_name', ''))
            if nxt.startswith('Kho Trung Chuyển'):
                return 'Kho Trung Chuyển'
            elif nxt.startswith('Kho Chuyển Tiếp'):
                return 'Kho Chuyển Tiếp'
            elif nxt.startswith('Kho Giao Hàng Nặng'):
                return 'Kho Giao Hàng Nặng'
            elif nxt.startswith('Kho KHL') or nxt.startswith('Key Account'):
                return 'Kho KHL'
            return 'Khác'

    df['_loai_kho'] = df.apply(guess_loai_kho, axis=1)
    df['_kho_den'] = df.apply(
        lambda r: r['deliver_province'] if r['_loai_kho'] in ('Nội Thành', 'Nội vùng')
        else r['next_warehouse_name'], axis=1
    )
    df['_phan_vung'] = df['Vùng']
    return df

def build_pivot(df):
    """Tạo bảng pivot giống sheet PV trong Form Final."""
    print("📊 Tạo bảng Pivot...")

    # Chuẩn hóa diff_hours_bucket
    df['_aging'] = df['diff_hours_bucket'].astype(str)

    # Pivot: đếm đơn theo (loại kho, kho đến) × aging
    pivot = pd.pivot_table(
        df,
        values='order_code',
        index=['_loai_kho', '_kho_den'],
        columns='_aging',
        aggfunc='count',
        fill_value=0,
        margins=False
    )

    # Sắp xếp cột theo thứ tự aging
    ordered_cols = [c for c in AGING_ORDER if c in pivot.columns]
    extra_cols = [c for c in pivot.columns if c not in AGING_ORDER]
    pivot = pivot[ordered_cols + extra_cols]

    # Thêm cột Grand Total
    pivot['Grand Total'] = pivot.sum(axis=1)

    return pivot

def generate_subset_data(df_subset, map_tinh_to_lv2=None, map_lv2_to_khoden=None):
    grand_total = len(df_subset)
    routes = []

    for group_name in GROUP_ORDER:
        # Lọc các kho thuộc nhóm này
        group_mask = df_subset['_loai_kho'] == group_name
        group_df = df_subset[group_mask]
        group_total = len(group_df)

        if group_total == 0:
            continue

        # Children: theo kho đến hoặc tỉnh
        children_counts = group_df['_kho_den'].value_counts().to_dict()
        children = []
        for child_name, child_count in sorted(children_counts.items(), key=lambda x: -x[1]):
            # Aging breakdown cho từng child
            child_df = group_df[group_df['_kho_den'] == child_name]
            aging = child_df['diff_hours_bucket'].value_counts().to_dict()
            # Sắp xếp aging
            aging_ordered = OrderedDict()
            for bucket in AGING_ORDER:
                aging_ordered[bucket] = aging.get(bucket, 0)

            children.append({
                'name': child_name,
                'short_name': child_name, # Giữ nguyên tên gốc chính xác như yêu cầu
                'total': child_count,
                'aging': aging_ordered,
            })

        # Aging tổng cho group
        group_aging = group_df['diff_hours_bucket'].value_counts().to_dict()
        aging_ordered = OrderedDict()
        for bucket in AGING_ORDER:
            aging_ordered[bucket] = group_aging.get(bucket, 0)

        routes.append({
            'name': group_name,
            'total': group_total,
            'aging': aging_ordered,
            'children': children,
        })

    # Xử lý nhóm "Khác" nếu có
    other_mask = ~df_subset['_loai_kho'].isin(GROUP_ORDER)
    if other_mask.sum() > 0:
        other_df = df_subset[other_mask]
        other_children = other_df['_kho_den'].value_counts().to_dict()
        
        # Tính aging cho từng child của Khác
        children = []
        for child_name, child_count in sorted(other_children.items(), key=lambda x: -x[1]):
            child_df = other_df[other_df['_kho_den'] == child_name]
            aging = child_df['diff_hours_bucket'].value_counts().to_dict()
            aging_ordered = OrderedDict()
            for bucket in AGING_ORDER:
                aging_ordered[bucket] = aging.get(bucket, 0)
            children.append({
                'name': child_name,
                'short_name': child_name,
                'total': child_count,
                'aging': aging_ordered,
            })
            
        # Tính aging tổng cho nhóm Khác
        group_aging = other_df['diff_hours_bucket'].value_counts().to_dict()
        aging_ordered = OrderedDict()
        for bucket in AGING_ORDER:
            aging_ordered[bucket] = group_aging.get(bucket, 0)
            
        routes.append({
            'name': 'Khác',
            'total': len(other_df),
            'aging': aging_ordered,
            'children': children
        })

    # Destinations summary
    dest_region = df_subset['deliver_region'].value_counts().to_dict()
    dest_province = df_subset['deliver_province'].value_counts().head(30).to_dict()
    dest_vung = df_subset['Vùng'].value_counts().to_dict()

    # Phân tích hàng mốc dưới 3 giờ nhập từ đâu về (Tỉnh lấy được map theo tham số)
    df_under3 = df_subset[df_subset['diff_hours'] < 3].copy()
    
    mapped_origins = []
    for prov in df_under3['pick_province']:
        prov_str = str(prov).strip()
        prov_lower = prov_str.lower()
        
        # Mapping logic:
        # Step 1: Look up pick_province in Tỉnh giao to get LV-2
        lv2 = map_tinh_to_lv2.get(prov_lower, '') if map_tinh_to_lv2 else ''
        
        # Step 2: Translate LV-2 to Kho Đến
        kho_den = map_lv2_to_khoden.get(lv2.lower(), '') if lv2 and map_lv2_to_khoden else ''
        
        # Fallback to raw pick_province if empty or not found
        final_origin = kho_den if kho_den else prov_str
        mapped_origins.append(final_origin)
        
    df_under3['_mapped_origin'] = mapped_origins
    under3_counts = df_under3['_mapped_origin'].value_counts()
    total_under3 = len(df_under3)
    
    under_3h_origins = []
    for prov, count in under3_counts.items():
        under_3h_origins.append({
            'province': str(prov).strip(),
            'count': int(count),
            'pct': float(count / total_under3 * 100) if total_under3 > 0 else 0.0
        })

    return {
        'grand_total': grand_total,
        'routes': routes,
        'destinations': {
            'by_region': dest_region,
            'by_province': dest_province,
            'by_vung': dest_vung,
        },
        'under_3h_origins': under_3h_origins,
        'total_under_3h': total_under3
    }

def build_hierarchical_data(df, pivot, params=None):
    """Xây dựng dữ liệu phân cấp cho dashboard theo từng loại hàng và tất cả."""
    map_tinh_to_lv2 = {}
    map_lv2_to_khoden = {}
    
    if params is not None:
        for _, r in params.iterrows():
            k = str(r['Tỉnh giao']).lower().strip()
            if k not in map_tinh_to_lv2:
                map_tinh_to_lv2[k] = str(r['LV-2']).strip()
        for _, r in params.iterrows():
            k = str(r['LV-2']).lower().strip()
            if k not in map_lv2_to_khoden:
                map_lv2_to_khoden[k] = str(r['Kho Đến']).strip()

    # 1. Toàn bộ
    data_all = generate_subset_data(df, map_tinh_to_lv2, map_lv2_to_khoden)
    
    # 2. Normal (loaihang == 'Normal')
    df_normal = df[df['loaihang'].fillna('').str.lower() == 'normal']
    data_normal = generate_subset_data(df_normal, map_tinh_to_lv2, map_lv2_to_khoden)
    
    # 3. Bulky (loaihang == 'Bulky')
    df_bulky = df[df['loaihang'].fillna('').str.lower() == 'bulky']
    data_bulky = generate_subset_data(df_bulky, map_tinh_to_lv2, map_lv2_to_khoden)
    
    # 4. Freight (loaihang == 'Freight')
    df_freight = df[df['loaihang'].fillna('').str.lower() == 'freight']
    data_freight = generate_subset_data(df_freight, map_tinh_to_lv2, map_lv2_to_khoden)
    
    # Gộp tất cả vào cấu trúc chung
    full_data = {
        'all': data_all,
        'normal': data_normal,
        'bulky': data_bulky,
        'freight': data_freight,
        'title': f'BÁO CÁO TỒN KHO KTC HCM 01',
        'grand_total': len(df),
        'updated': datetime.now(__import__('datetime').timezone(__import__('datetime').timedelta(hours=7))).strftime('%d/%m/%Y %H:%M:%S'),
        'session_expired': False,
    }
    if params is not None:
        try:
            cols = ['Tỉnh giao', 'LV-2', 'Kho Đến', 'Loại kho']
            full_data['mapping_params'] = params[cols].fillna('').to_dict(orient='records')
        except Exception as e:
            print(f"⚠️ Không thể trích xuất tham số ra JSON: {e}")
            
    return full_data

def export_pivot_xlsx(df, pivot):
    """Xuất file XLSX giống Form Final sheet PV."""
    print(f"📄 Xuất {PIVOT_FILE.name}...")

    with pd.ExcelWriter(PIVOT_FILE, engine='openpyxl') as writer:
        # Sheet 1: Pivot giống PV
        # Tạo bảng có header đẹp
        rows = []
        rows.append(['BÁO CÁO TỒN KHO KTC HCM 01', '', '', '', '', '', '', '', '', '', ''])
        rows.append(['Cập nhật:', datetime.now().strftime('%d/%m/%Y %H:%M:%S')])
        rows.append([])
        rows.append(['Loại hàng', '(All)'])
        rows.append([])

        # Header row
        header = ['Mốc thời gian'] + AGING_ORDER + ['Grand Total']
        rows.append(header)

        # Data rows — grouped
        for group_name in GROUP_ORDER:
            if group_name not in pivot.index.get_level_values(0):
                continue

            # Group total row
            group_data = pivot.loc[group_name] if group_name in pivot.index.get_level_values(0) else None
            if group_data is not None:
                group_totals = group_data.sum()
                row = [group_name]
                for col in AGING_ORDER:
                    row.append(int(group_totals.get(col, 0)))
                row.append(int(group_totals.get('Grand Total', 0)))
                rows.append(row)

                # Children rows
                if isinstance(group_data, pd.DataFrame):
                    for child_name in group_data.index:
                        child_row = [f'  {child_name}']
                        for col in AGING_ORDER:
                            val = group_data.loc[child_name].get(col, 0)
                            child_row.append(int(val) if val > 0 else '')
                        child_row.append(int(group_data.loc[child_name].get('Grand Total', 0)))
                        rows.append(child_row)
                elif isinstance(group_data, pd.Series):
                    child_row = [f'  {group_name}']
                    for col in AGING_ORDER:
                        val = group_data.get(col, 0)
                        child_row.append(int(val) if val > 0 else '')
                    child_row.append(int(group_data.get('Grand Total', 0)))
                    rows.append(child_row)

        # Grand Total row
        total_row = ['Grand Total']
        for col in AGING_ORDER:
            total_row.append(int(pivot[col].sum()) if col in pivot.columns else 0)
        total_row.append(int(pivot['Grand Total'].sum()))
        rows.append(total_row)

        result_df = pd.DataFrame(rows)
        result_df.to_excel(writer, sheet_name='PV', index=False, header=False)

        # Sheet 2: Chi tiết đích đến theo tỉnh
        dest = pd.pivot_table(
            df, values='order_code',
            index='deliver_province', columns='_aging',
            aggfunc='count', fill_value=0, margins=True
        )
        ordered = [c for c in AGING_ORDER if c in dest.columns]
        if 'All' in dest.columns:
            ordered.append('All')
        dest = dest[ordered]
        dest.to_excel(writer, sheet_name='Đích đến theo Tỉnh')

        # Sheet 3: Chi tiết theo kho đến
        by_kho = pd.pivot_table(
            df, values='order_code',
            index='_kho_den', columns='_aging',
            aggfunc='count', fill_value=0, margins=True
        )
        ordered2 = [c for c in AGING_ORDER if c in by_kho.columns]
        if 'All' in by_kho.columns:
            ordered2.append('All')
        by_kho = by_kho[ordered2]
        by_kho.to_excel(writer, sheet_name='Theo Kho Đến')

    print(f"✅ Đã xuất {PIVOT_FILE.name}")

def inject_into_html(data):
    """Inject dữ liệu vào ktc_health.html."""
    if not HTML_FILE.exists():
        print(f"⚠️ Không tìm thấy {HTML_FILE.name}, bỏ qua.")
        return
    html = HTML_FILE.read_text(encoding='utf-8')
    json_str = json.dumps(data, ensure_ascii=False).replace('</script>', '<\\/script>')
    new_block = (
        f'<!-- TONKHO_DATA_START -->\n'
        f'<script>var TONKHO_DATA={json_str};</script>\n'
        f'<!-- TONKHO_DATA_END -->'
    )
    pattern = r'<!-- TONKHO_DATA_START -->.*?<!-- TONKHO_DATA_END -->'
    if re.search(pattern, html, flags=re.DOTALL):
        new_html = re.sub(pattern, new_block, html, flags=re.DOTALL)
    else:
        new_html = html.replace('</head>', f'{new_block}\n</head>')
    HTML_FILE.write_text(new_html, encoding='utf-8')
    print(f"✅ Đã inject vào {HTML_FILE.name}")

def write_aux(data):
    """Xuất JSON và JS."""
    JSON_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"✅ Đã xuất {JSON_FILE.name}")
    js = f"// Auto-generated — {data['updated']}\nvar TONKHO_DATA={json.dumps(data, ensure_ascii=False).replace('</script>', '<' + '/script>')};\n"
    JS_FILE.write_text(js, encoding='utf-8')
    print(f"✅ Đã xuất {JS_FILE.name}")

def load_env():
    """Đọc credentials từ file .env"""
    env_vars = {}
    env_file = BASE / '.env'
    if env_file.exists():
        try:
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        env_vars[key.strip()] = val.strip().strip('"').strip("'")
        except Exception as e:
            print(f"⚠️ Không thể đọc file .env: {e}")
    return env_vars

def upload_to_supabase(data, excel_path, df=None):
    """Tải dữ liệu JSON và báo cáo excel lên Supabase REST API & Storage.
    
    Raises Exception nếu JSON upload thất bại (vì dashboard đọc từ Supabase).
    """
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    # Ưu tiên service role key bảo mật, fallback về anon key
    supabase_key = (
        env.get('SUPABASE_SERVICE_ROLE_KEY') or 
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or 
        env.get('SUPABASE_KEY') or 
        os.environ.get('SUPABASE_KEY')
    )
    
    if not supabase_url or not supabase_key:
        raise RuntimeError("Không tìm thấy cấu hình Supabase URL/Key. Dashboard sẽ KHÔNG được cập nhật!")
        
    supabase_url = supabase_url.rstrip('/')
    
    # 1. Tải JSON dữ liệu lên bảng inventory_data (id=1) — CRITICAL
    table_url = f"{supabase_url}/rest/v1/inventory_data"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    payload = {
        "id": 1,
        "data": data,
        "updated_at": datetime.now().isoformat()
    }
    
    print("🚀 Đang tải JSON dữ liệu lên Supabase...")
    try:
        resp = requests.post(table_url, headers=headers, json=payload, timeout=30)
        if resp.status_code in [200, 201]:
            print("✅ Đã cập nhật dữ liệu tồn kho lên Supabase (bảng: inventory_data) thành công!")
        else:
            raise RuntimeError(f"Cập nhật JSON lên Supabase thất bại (HTTP {resp.status_code}): {resp.text[:300]}")
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Lỗi kết nối khi tải dữ liệu lên Supabase: {e}")
        
    # 2. Tải BaoCao_TonKho.xlsx lên Storage bucket 'reports' — non-critical
    if excel_path and Path(excel_path).exists():
        print("🚀 Đang tải file BaoCao_TonKho.xlsx lên Supabase Storage...")
        storage_url = f"{supabase_url}/storage/v1/object/reports/BaoCao_TonKho.xlsx"
        storage_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "x-upsert": "true"
        }
        try:
            with open(excel_path, 'rb') as f:
                file_data = f.read()
            # Thử POST trước
            resp = requests.post(storage_url, headers=storage_headers, data=file_data, timeout=60)
            if resp.status_code in [200, 201]:
                print("✅ Đã cập nhật file BaoCao_TonKho.xlsx lên Supabase Storage (bucket: reports) thành công!")
            else:
                # Nếu POST lỗi, thử PUT (đè đè)
                resp_put = requests.put(storage_url, headers=storage_headers, data=file_data, timeout=60)
                if resp_put.status_code in [200, 201]:
                    print("✅ Đã cập nhật file BaoCao_TonKho.xlsx lên Supabase Storage (PUT) thành công!")
                else:
                    print(f"⚠️ Cập nhật Excel lên Supabase Storage thất bại (HTTP {resp.status_code} / {resp_put.status_code}): {resp_put.text}")
        except Exception as e:
            print(f"⚠️ Lỗi khi tải Excel lên Supabase Storage: {e}")

    # 3. Tải raw_orders.json lên Supabase Storage cho tính năng Drill-down
    if df is not None:
        try:
            print("🚀 Đang tải raw_orders.json lên Supabase Storage...")
            cols = ['order_code', 'loaihang', 'deliver_province', 'next_warehouse_name', '_aging', '_loai_kho', '_kho_den', 'diff_hours']
            df_min = df[cols].copy()
            df_min.fillna('', inplace=True)
            
            # Rename columns to be user-friendly in Excel export later
            df_min.columns = ['Mã Đơn', 'Loại Hàng', 'Tỉnh Giao', 'Kho Tiếp', 'Nhóm Thời Gian', 'Loại Kho', 'Kho Đến', 'Giờ Tồn']
            
            raw_data_list = df_min.values.tolist()
            raw_payload = {
                "columns": df_min.columns.tolist(),
                "data": raw_data_list,
                "updated": data.get('updated', '')
            }
            raw_json_str = json.dumps(raw_payload, ensure_ascii=False)
            
            RAW_FILE = BASE / 'raw_orders.json'
            RAW_FILE.write_text(raw_json_str, encoding='utf-8')
            
            storage_url_raw = f"{supabase_url}/storage/v1/object/reports/raw_orders.json"
            storage_headers_raw = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
                "x-upsert": "true"
            }
            
            resp = requests.post(storage_url_raw, headers=storage_headers_raw, data=raw_json_str.encode('utf-8'), timeout=60)
            if resp.status_code in [200, 201]:
                print("✅ Đã cập nhật file raw_orders.json lên Supabase Storage thành công!")
            else:
                resp_put = requests.put(storage_url_raw, headers=storage_headers_raw, data=raw_json_str.encode('utf-8'), timeout=60)
                if resp_put.status_code in [200, 201]:
                    print("✅ Đã cập nhật file raw_orders.json lên Supabase Storage (PUT) thành công!")
                else:
                    print(f"⚠️ Cập nhật raw_orders lên Supabase Storage thất bại (HTTP {resp_put.status_code}): {resp_put.text}")
        except Exception as e:
            print(f"⚠️ Lỗi khi tải raw_orders lên Supabase Storage: {e}")


def print_summary(data):
    """In bảng tổng hợp giống PV."""
    # Hỗ trợ cấu trúc phân nhóm mới
    source = data['all'] if 'all' in data else data
    g = source['grand_total']
    print(f"\n{'='*80}")
    print(f"📊 BÁO CÁO TỒN KHO — {g:,} đơn | {data['updated']}")
    print(f"{'='*80}")

    # Header
    aging_short = ['0-6', '6-12', '12-24', '24-36', '36-48', '48-72', '72-96', '96-120', '120+']
    header = f"{'Loại Kho / Đích đến':<35}"
    for a in aging_short:
        header += f"{a:>8}"
    header += f"{'Total':>10}"
    print(f"\n{header}")
    print(f"{'─'*len(header)}")

    for route in source['routes']:
        # Parent row
        line = f"📦 {route['name']:<32}"
        aging = route.get('aging', {})
        for bucket in AGING_ORDER:
            val = aging.get(bucket, 0)
            line += f"{val:>8,}" if val else f"{'':>8}"
        line += f"{route['total']:>10,}"
        print(line)

        # Children rows (top 5)
        for c in route['children'][:8]:
            cline = f"   {c['short_name'][:32]:<32}"
            caging = c.get('aging', {})
            for bucket in AGING_ORDER:
                val = caging.get(bucket, 0)
                cline += f"{val:>8,}" if val else f"{'':>8}"
            cline += f"{c['total']:>10,}"
            print(cline)
        if len(route['children']) > 8:
            print(f"   ... +{len(route['children'])-8} đích đến khác")

    # Grand Total
    print(f"{'─'*len(header)}")
    gt_line = f"{'Grand Total':<35}"
    gt_line += f"{'':>72}"
    gt_line += f"{g:>10,}"
    print(gt_line)

def main():
    try:
        # Đọc dữ liệu thô
        print(f"📂 Đọc file: {EXCEL_FILE.name}")
        df = pd.read_excel(EXCEL_FILE)
        print(f"   {len(df):,} đơn hàng (toàn bộ)")

        # Đồng bộ tên cột nếu dữ liệu được tải bằng API Dashboard (có tên hiển thị tiếng Việt)
        rename_map = {
            'Ngày': 'dt',
            'Order_code': 'order_code',
            'Task_status': 'task_status',
            'Kho hiện tại': 'current_warehouse_name',
            'Kho tiếp': 'next_warehouse_name',
            'Loại hàng': 'loaihang',
            'Grams': 'weight',
            'Tỉnh giao': 'deliver_province',
            'Tỉnh lấy': 'pick_province',
            'Miện kho hiện tại': 'current_mien',
            'Miền giao': 'deliver_mien',
            'Khu vực hiện tại': 'current_region',
            'Khu vực giao': 'deliver_region',
            'Phân vùng': 'Vùng',
            'Thời gian tồn': 'diff_hours',
            'Khung thời gian tồn': 'diff_hours_bucket',
            'Tên kho xét': 'name_kho',
            'deliver_warehouse_id': 'deliver_warehouse_id'
        }
        df.rename(columns=rename_map, inplace=True)

        # 🛡️ KIỂM TRA CHẤT LƯỢNG DỮ LIỆU ĐẦU VÀO (Data Sanitization Check)
        if len(df) < 1000:
            raise ValueError(f"Dữ liệu thô quá ít ({len(df)} dòng). Có khả năng file excel tải từ Metabase bị lỗi hoặc rỗng. Huỷ bỏ ghi đè để bảo vệ số liệu cũ.")

        # ── Lọc chỉ KTC HCM 01 ──
        KHO_FILTER = 'Kho Trung Chuyển Hồ Chí Minh 01'
        df = df[df['current_warehouse_name'] == KHO_FILTER].copy()
        # Loại các đơn đang luân chuyển đến KTC
        df = df[df['task_status'].fillna('').str.strip() != 'Đang luân chuyển đến KTC'].copy()
        print(f"   {len(df):,} đơn hàng (lọc: {KHO_FILTER} và loại bỏ Đang luân chuyển đến KTC)")

        if len(df) == 0:
            print(f"❌ Không có dữ liệu cho kho '{KHO_FILTER}'")
            sys.exit(1)

        # Đọc tham số mapping
        params = load_params()

        # Phân loại
        if params is not None:
            df = classify_by_params(df, params)
        else:
            df = classify_auto(df)

        # Tạo pivot
        pivot = build_pivot(df)

        # Xuất các file
        data = build_hierarchical_data(df, pivot, params)
        inject_into_html(data)
        write_aux(data)
        export_pivot_xlsx(df, pivot)
        
        # Tải dữ liệu lên Supabase bảo mật
        upload_to_supabase(data, PIVOT_FILE, df)

        # In tổng hợp
        print_summary(data)

    except FileNotFoundError as e:
        print(f"❌ Không tìm thấy file: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        import traceback; traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
