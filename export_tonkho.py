#!/usr/bin/env python3
"""
Script xuất dữ liệu tồn kho từ Datatonkho.xlsx
→ Inject thẳng vào ktc_health.html với đầy đủ hierarchy (cha + con)
"""
import pandas as pd, json, re, sys, unicodedata
from datetime import datetime
from pathlib import Path

BASE       = Path(__file__).parent
EXCEL_FILE = BASE / 'Datatonkho.xlsx'
HTML_FILE  = BASE / 'ktc_health.html'
JSON_FILE  = BASE / 'tonkho_tuyen.json'
JS_FILE    = BASE / 'tonkho_data.js'

def norm(s):
    """Chuẩn hoá: bỏ dấu, thường — dùng để so sánh không phân biệt dấu."""
    nfd = unicodedata.normalize('NFD', s.lower())
    return ' '.join(''.join(c for c in nfd if unicodedata.category(c) != 'Mn').split())

def short_name(child, parent):
    """Rút gọn tên kho con bằng cách bỏ prefix cha (xử lý cả typo dấu)."""
    pw = norm(parent).split()   # parent words normalized
    cw = norm(child).split()    # child  words normalized

    # Trường hợp 1: child bắt đầu bằng parent words (kể cả có typo dấu)
    if len(cw) > len(pw) and cw[:len(pw)] == pw:
        rest = ' '.join(child.split()[len(pw):]).lstrip('- ').strip()
        return rest if rest else child

    # Trường hợp 2: "Parent - Location - Province" format
    if ' - ' in child:
        before = child.split(' - ')[0].strip()
        if norm(before) == norm(parent):
            return ' - '.join(child.split(' - ')[1:]).strip()

    # Không khớp → giữ nguyên tên gốc
    return child

# Mapping: dòng cha → range dòng con (row index trong Excel, 0-based từ dòng 7)
# Dựa trên cấu trúc file: cha ở idx, con ở các idx tiếp theo cho đến cha tiếp theo
PARENT_ROWS = {
    7:  {'name': 'Kho Chuyển Tiếp',    'children_range': (8,  14)},
    14: {'name': 'Kho Giao Hàng Nặng', 'children_range': (15, 29)},
    29: {'name': 'Kho KHL',             'children_range': (30, 31)},
    31: {'name': 'Kho Trung Chuyển',   'children_range': (32, 44)},
    44: {'name': 'Nội Thành',           'children_range': (45, 46)},
    46: {'name': 'Nội vùng',            'children_range': (47, 52)},
    52: {'name': 'Phú Quốc',            'children_range': (53, 54)},
}

def read_excel():
    print(f"📂 Đọc file: {EXCEL_FILE.name}")
    df = pd.read_excel(EXCEL_FILE, sheet_name='Tồn kho', header=None)
    title = str(df.iloc[0, 0]).strip()

    routes     = []
    grand_total = 0

    for parent_idx, meta in PARENT_ROWS.items():
        parent_row = df.iloc[parent_idx]
        parent_total = int(parent_row[9]) if pd.notna(parent_row[9]) else 0

        children = []
        start, end = meta['children_range']
        parent_word_count = len(meta['name'].split())
        for ci in range(start, end):
            row  = df.iloc[ci]
            name = str(row[0]).strip() if pd.notna(row[0]) else ''
            val  = row[9]
            if name and name != 'nan' and pd.notna(val):
                # Tạo short_name bằng cách bỏ prefix cha
                # Vd: "Kho Trung Chuyển Hà Nội 02" → "Hà Nội 02"
                # Vd: "Kho Giao Hàng Nặng - Thủ Đức - HCM" → "Thủ Đức - HCM"
                words = name.split()
                if len(words) > parent_word_count:
                    short = ' '.join(words[parent_word_count:]).lstrip('- ').strip()
                else:
                    short = name
                # Nếu còn chứa " - " → bỏ phần đầu
                if ' - ' in short:
                    short = short.split(' - ', 1)[1].strip()
                children.append({'name': name, 'short_name': short_name(name, meta['name']), 'total': int(val)})

        routes.append({
            'name':     meta['name'],
            'total':    parent_total,
            'children': children
        })

    # Grand Total
    for idx in range(7, len(df)):
        row  = df.iloc[idx]
        name = str(row[0]).strip() if pd.notna(row[0]) else ''
        val  = row[9]
        if name == 'Grand Total' and pd.notna(val):
            grand_total = int(val)
            break

    return {
        'title':       title,
        'grand_total': grand_total,
        'routes':      routes,
        'updated':     datetime.now().strftime('%d/%m/%Y %H:%M:%S')
    }

def inject_into_html(data):
    html     = HTML_FILE.read_text(encoding='utf-8')
    json_str = json.dumps(data, ensure_ascii=False)
    new_block = (
        f'<!-- TONKHO_DATA_START -->\n'
        f'<script>var TONKHO_DATA={json_str};</script>\n'
        f'<!-- TONKHO_DATA_END -->'
    )
    pattern  = r'<!-- TONKHO_DATA_START -->.*?<!-- TONKHO_DATA_END -->'
    new_html = re.sub(pattern, new_block, html, flags=re.DOTALL)
    HTML_FILE.write_text(new_html, encoding='utf-8')
    print(f"✅ Đã inject vào {HTML_FILE.name}")

def write_aux(data):
    JSON_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    js = f"// Auto-generated — {data['updated']}\nvar TONKHO_DATA={json.dumps(data, ensure_ascii=False)};\n"
    JS_FILE.write_text(js, encoding='utf-8')

def main():
    try:
        data = read_excel()
        inject_into_html(data)
        write_aux(data)
        g = data['grand_total']
        print(f"📊 {len(data['routes'])} tuyến | {g:,} kiện tổng | {data['updated']}")
        for r in data['routes']:
            pct = round(r['total'] / g * 100, 1) if g else 0
            print(f"   • {r['name']:<25} {r['total']:>7,} kiện ({pct}%)  → {len(r['children'])} kho con")
    except Exception as e:
        print(f"❌ Lỗi: {e}", file=sys.stderr)
        import traceback; traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
