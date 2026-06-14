import os

filepath = "/Users/duyhuynh/Desktop/AI dashboard/index.html"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update versions
content = content.replace("style.css?v=1.0.4", "style.css?v=1.0.5")
content = content.replace("js/capacity.js?v=1.0.4", "js/capacity.js?v=1.0.5")

# 2. Re-layout capacity tab
start_marker = "      <!-- Configuration Panel -->"
# The end of the grid section is the end of side-panel (which contains cap-advisory-list)
end_marker = """            <div style="display: flex; flex-direction: column; gap: 8px;" id="cap-advisory-list"></div>
          </div>
        </div>
      </div>"""

start_idx = content.find(start_marker)
if start_idx == -1:
    print("Error: start_marker not found in index.html")
    exit(1)

end_idx = content.find(end_marker, start_idx)
if end_idx == -1:
    print("Error: end_marker not found in index.html")
    exit(1)

target_block = content[start_idx:end_idx + len(end_marker)]
print(f"HTML target block length: {len(target_block)} chars")

replacement_block = """      <!-- Chart Section & Side Controls -->
      <div class="content-grid">
        <!-- Left Column: Chart & AI Advisory -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Left: FC vs Capacity Chart -->
          <div class="table-card animate-in delay-2">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; padding: 16px 20px;">
              <div class="card-title">Biểu Đồ FC vs Khả Năng Xử Lý Theo Ngày</div>
              <div style="font-size: 0.72rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; display: flex; align-items: center; gap: 12px;">
                <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background: var(--blue); display: inline-block; border-radius: 2px;"></span> &lt;5kg</span>
                <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background: var(--yellow); display: inline-block; border-radius: 2px;"></span> 5-15kg</span>
                <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background: var(--accent); display: inline-block; border-radius: 2px;"></span> &gt;15kg</span>
                <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 2px; background: var(--green); display: inline-block;"></span> Capacity Max</span>
              </div>
            </div>
            <div style="padding: 8px 20px;">
              <div class="cap-chart-nav">
                <button id="cap-chart-prev">◀</button>
                <span class="cap-date-range-text" id="cap-date-range-display">—</span>
                <button id="cap-chart-next">▶</button>
              </div>
            </div>
            <div style="padding: 0 20px 20px;">
              <div class="flow-chart-container" id="cap-chart-container" style="height: 280px; align-items: flex-end; padding-bottom: 45px; position: relative;"></div>
            </div>
          </div>
          
          <!-- AI Advisory -->
          <div class="chart-card animate-in delay-3" style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 8px; margin-bottom: 4px;">
              <div class="card-title" style="margin: 0; padding: 0; border: none;">Khuyến Nghị Nhân Sự & Phân Tích Định Mức (AI Advisory)</div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 0.65rem; color: var(--text-muted);">Xem ngày:</span>
                <select id="cap-advisory-date-select" style="background: rgba(30, 41, 59, 0.8); color: var(--text-primary); border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; cursor: pointer; outline: none; font-family: 'JetBrains Mono', monospace; font-weight: 600;"></select>
              </div>
            </div>
            <div class="advisory-grid-container" id="cap-advisory-list"></div>
          </div>
        </div>

        <!-- Right: Configurations & Derived Productivity -->
        <div class="side-panel">
          <!-- Card A: Nhân Sự Hiện Có -->
          <div class="chart-card">
            <div class="card-title">Nhân Sự Hiện Có</div>
            <div style="display:flex; gap:12px; align-items:center; margin-bottom:8px;">
              <div style="flex:1;">
                <div style="font-size:0.62rem;color:var(--text-muted);margin-bottom:4px;text-align:center;font-weight:600;">NVCT (Chính thức)</div>
                <input type="number" id="cap-nvct-total" value="235" style="width:100%;background:#1e293b;color:var(--text-primary);border:1px solid var(--border);padding:10px 12px;border-radius:var(--radius-sm);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:1.1rem;text-align:center;">
              </div>
              <div style="font-size:1.2rem;color:var(--text-muted);font-weight:700;padding-top:16px;">+</div>
              <div style="flex:1;">
                <div style="font-size:0.62rem;color:var(--yellow);margin-bottom:4px;text-align:center;font-weight:600;">Freelancer</div>
                <input type="number" id="cap-fl-total" value="95" style="width:100%;background:#1e293b;color:var(--yellow);border:1px solid rgba(251,191,36,0.3);padding:10px 12px;border-radius:var(--radius-sm);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:1.1rem;text-align:center;">
              </div>
            </div>
            <div style="font-size:0.68rem;color:var(--text-muted);text-align:center;font-family:'JetBrains Mono',monospace;">
              Kho vận hành chung — không chia theo nhóm hàng
            </div>
          </div>

          <!-- Card B: Buffer & Data Controls -->
          <div class="chart-card">
            <div class="card-title">Buffer &amp; Data Controls</div>
            <div class="cap-config-row">
              <label>Buffer (%)</label>
              <input type="range" id="cap-buffer" min="0" max="30" step="1" value="10">
              <span class="cap-config-val" id="cap-buffer-val">10%</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
              <button class="filter-btn" id="cap-btn-paste-actual" style="border-color: var(--yellow); color: var(--yellow); font-weight: 600; cursor: pointer; width: 100%; text-align: center;">📊 Dán Actual Data</button>
              <button class="filter-btn" id="cap-btn-paste" style="border-color: var(--green); color: var(--green); font-weight: 600; cursor: pointer; width: 100%; text-align: center;">📋 Dán Dữ Liệu FC</button>
              <button class="filter-btn" id="cap-btn-refresh" style="border-color: var(--accent); color: var(--accent-light); font-weight: 600; cursor: pointer; width: 100%; text-align: center;">🔄 Tải FC Từ Sheet</button>
            </div>
          </div>

          <!-- Derived Productivity Panel -->
          <div class="chart-card animate-in delay-2" style="display: flex; flex-direction: column; gap: 8px;">
            <div class="card-title">🧮 Năng Suất Tự Tính (Từ Actual)</div>
            <div id="cap-derived-panel"></div>
          </div>
        </div>
      </div>

      <!-- Staffing Detail Table -->
      <div class="table-card animate-in delay-4" style="margin-top: 16px;">
        <div class="card-header">
          <div class="card-title">Bảng Chi Tiết Nhân Sự Cần Thiết Theo Ngày</div>
        </div>
        <div class="table-wrapper" style="max-height: 420px; overflow-y: auto;">
          <table class="pivot-table" id="cap-staffing-table" style="width: 100%; font-size: 0.76rem;">
            <thead>
              <tr>
                <th style="text-align: left; padding-left: 10px;">Ngày</th>
                <th style="text-align: center;">Thứ</th>
                <th style="text-align: center; color: var(--blue);">FC &lt;5kg</th>
                <th style="text-align: center; color: var(--yellow);">FC 5-15kg</th>
                <th style="text-align: center; color: var(--accent);">FC &gt;15kg</th>
                <th style="text-align: center; font-weight: 700;">FC Tổng</th>
                <th style="text-align: center;">Cap Max</th>
                <th style="text-align: center; color: var(--blue-light);">NS Cần</th>
                <th style="text-align: center; color: var(--text-muted);">NVCT</th>
                <th style="text-align: center; color: var(--yellow);">FL Hiện</th>
                <th style="text-align: center; color: var(--blue-light);">FL Cần</th>
                <th style="text-align: center; color: var(--accent-light);">FL ±</th>
              </tr>
            </thead>
            <tbody id="cap-table-body">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>"""

new_content = content[:start_idx] + replacement_block + content[end_idx + len(end_marker):]

with open(filepath, "w", encoding="utf-8") as f:
    f.write(new_content)

print("SUCCESS: index.html restructured and version updated successfully!")
