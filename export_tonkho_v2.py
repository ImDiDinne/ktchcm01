#!/usr/bin/env python3
"""
📊 Export Tồn Kho v2 — Tổng hợp dữ liệu thô → format Form Final (PV)

Đọc Datatonkho.xlsx (chi tiết đơn) + Form Final.xlsx (tham số mapping)
→ Tạo Pivot: Loại Kho / Kho đến / Tỉnh giao × Mốc thời gian tồn
→ Inject vào ktc_health.html + xuất JSON/JS/XLSX
"""
import pandas as pd
import json, re, sys, warnings
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
    if not PARAMS_FILE.exists():
        print(f"⚠️ Không tìm thấy {PARAMS_FILE.name}, dùng mapping tự động.")
        return None
    params = pd.read_excel(PARAMS_FILE, sheet_name='Tham Số 1')
    print(f"📋 Đọc tham số: {len(params)} dòng mapping")
    return params

def classify_by_params(df, params):
    """Phân loại đơn theo bảng tham số (Tỉnh giao → Loại kho / Kho đến)."""
    # Tạo mapping: Tỉnh giao → {Loại kho, Kho Đến, Phân vùng}
    mapping = {}
    for _, row in params.iterrows():
        tinh = str(row['Tỉnh giao']).strip()
        if tinh and tinh != 'nan':
            mapping[tinh] = {
                'loai_kho': str(row['Loại kho']).strip() if pd.notna(row['Loại kho']) else 'Khác',
                'kho_den': str(row['Kho Đến']).strip() if pd.notna(row['Kho Đến']) else tinh,
                'phan_vung': str(row['Phân vùng']).strip() if pd.notna(row['Phân vùng']) else '',
            }

    # Áp dụng mapping
    df['_loai_kho'] = df['deliver_province'].map(lambda x: mapping.get(str(x).strip(), {}).get('loai_kho', 'Khác'))
    df['_kho_den'] = df['deliver_province'].map(lambda x: mapping.get(str(x).strip(), {}).get('kho_den', str(x)))
    df['_phan_vung'] = df['deliver_province'].map(lambda x: mapping.get(str(x).strip(), {}).get('phan_vung', ''))

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

def build_hierarchical_data(df, pivot):
    """Xây dựng dữ liệu phân cấp cho dashboard."""
    grand_total = len(df)
    routes = []

    for group_name in GROUP_ORDER:
        # Lọc các kho thuộc nhóm này
        group_mask = df['_loai_kho'] == group_name
        group_df = df[group_mask]
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
                'short_name': child_name.replace(group_name, '').strip().lstrip('-').strip() or child_name,
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
    other_mask = ~df['_loai_kho'].isin(GROUP_ORDER)
    if other_mask.sum() > 0:
        other_df = df[other_mask]
        other_children = other_df['_kho_den'].value_counts().to_dict()
        routes.append({
            'name': 'Khác',
            'total': len(other_df),
            'aging': {},
            'children': [{'name': k, 'short_name': k, 'total': v, 'aging': {}} 
                         for k, v in sorted(other_children.items(), key=lambda x: -x[1])]
        })

    # Destinations summary
    dest_region = df['deliver_region'].value_counts().to_dict()
    dest_province = df['deliver_province'].value_counts().head(30).to_dict()
    dest_vung = df['Vùng'].value_counts().to_dict()

    data = {
        'title': f'BÁO CÁO TỒN KHO KTC HCM 01 — {grand_total:,} đơn',
        'grand_total': grand_total,
        'routes': routes,
        'destinations': {
            'by_region': dest_region,
            'by_province': dest_province,
            'by_vung': dest_vung,
        },
        'updated': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
    }
    return data

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

def print_summary(data):
    """In bảng tổng hợp giống PV."""
    g = data['grand_total']
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

    for route in data['routes']:
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

        # ── Lọc chỉ KTC HCM 01 ──
        KHO_FILTER = 'Kho Trung Chuyển Hồ Chí Minh 01'
        df = df[df['name_kho'] == KHO_FILTER].copy()
        print(f"   {len(df):,} đơn hàng (lọc: {KHO_FILTER})")

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
        data = build_hierarchical_data(df, pivot)
        inject_into_html(data)
        write_aux(data)
        export_pivot_xlsx(df, pivot)

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
