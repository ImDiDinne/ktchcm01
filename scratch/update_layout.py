import os

filepath = "/Users/duyhuynh/Desktop/AI dashboard/js/capacity.js"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

start_marker = "      let customHtml = `"
end_marker = "      `;"

start_idx = content.find(start_marker)
if start_idx == -1:
    print("Error: start marker not found")
    exit(1)

# Find the end marker after start marker
end_idx = content.find(end_marker, start_idx)
if end_idx == -1:
    print("Error: end marker not found")
    exit(1)

# Compute the exact text to replace
actual_target = content[start_idx:end_idx + len(end_marker)]
print(f"Target length: {len(actual_target)} chars")

replacement_str = """      let customHtml = `
        <div class="kpi-card dock-advisory-card daily-analysis-card" style="padding: 16px; border-left: 4px solid var(--blue) !important; display: flex; flex-direction: column; gap: 10px; background: rgba(30, 41, 59, 0.45); border-radius: var(--radius-lg); margin-bottom: 8px;">
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; margin-bottom: 4px;">
            <span style="font-weight: 700; font-size: 0.78rem; color: var(--blue-light);">📊 PHÂN TÍCH ĐỊNH MỨC NGÀY ${todayCalc.date}</span>
            <span style="font-size: 0.65rem; font-weight: 600; padding: 2px 6px; border-radius: 12px; background: rgba(96, 165, 250, 0.12); color: var(--blue-light);">Forecast N</span>
          </div>
          
          <!-- Body Grid -->
          <div class="advisory-body-grid">
            <!-- Column 1: Forecast Volume -->
            <div class="advisory-col">
              <div style="font-weight: 600; font-size: 0.74rem; color: var(--text-primary); display: flex; justify-content: space-between;">
                <span>📦 Forecast (FC Tổng):</span>
                <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--text-primary);">${formatNumber(todayCalc.fc.total)} đơn</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                <div style="background: rgba(96, 165, 250, 0.04); border: 1px solid rgba(96, 165, 250, 0.12); padding: 5px 8px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.65rem; color: var(--text-muted);">Normal (&lt;5kg)</span>
                  <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; font-weight: 700; color: #60a5fa;">${formatNumber(todayCalc.fc.normal)}</span>
                </div>
                <div style="background: rgba(251, 146, 60, 0.04); border: 1px solid rgba(251, 146, 60, 0.12); padding: 5px 8px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.65rem; color: var(--text-muted);">Bulky (5-15kg)</span>
                  <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; font-weight: 700; color: #fbbf24;">${formatNumber(todayCalc.fc.bulky)}</span>
                </div>
                <div style="background: rgba(251, 146, 60, 0.04); border: 1px solid rgba(251, 146, 60, 0.12); padding: 5px 8px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.65rem; color: var(--text-muted);">Freight (&gt;15kg)</span>
                  <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; font-weight: 700; color: #fb923c;">${formatNumber(todayCalc.fc.freight)}</span>
                </div>
              </div>
            </div>

            <!-- Column 2: Staffing Needs -->
            <div class="advisory-col">
              <div style="font-weight: 600; font-size: 0.74rem; color: var(--text-primary); display: flex; justify-content: space-between;">
                <span>👥 Phân Bố Nhân Sự:</span>
                <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--text-primary);">${todayCalc.requiredTotal} người</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-secondary);">
                  <span>👔 NVCT (Ngày N-1):</span>
                  <strong style="font-family: 'JetBrains Mono', monospace; color: var(--green);">${todayCalc.nvctTotal} người</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-secondary); align-items: center;">
                  <span>🧡 Freelancer cần:</span>
                  <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: ${todayCalc.flNeeded > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(52, 211, 153, 0.12)'}; color: ${todayCalc.flNeeded > 0 ? 'var(--red)' : 'var(--green)'}; border: 1px solid ${todayCalc.flNeeded > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(52, 211, 153, 0.2)'};">${todayCalc.flNeeded} người</span>
                </div>
                <div style="padding: 4px 8px; color: var(--text-muted); line-height: 1.4; font-size: 0.65rem; display: flex; flex-direction: column; gap: 2px; background: rgba(255, 255, 255, 0.02); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.04);">
                  <span style="display:flex; justify-content:space-between;">• Normal (&lt;5kg): <strong style="color: #60a5fa;">${requiredN} ng</strong> <span style="font-size:0.58rem; color:var(--text-muted);">(~${formatNumber(Math.round(pN_use))}/ng)</span></span>
                  <span style="display:flex; justify-content:space-between;">• Bulky (5-15kg): <strong style="color: #fbbf24;">${requiredB} ng</strong> <span style="font-size:0.58rem; color:var(--text-muted);">(~${formatNumber(Math.round(pB_use))}/ng)</span></span>
                  <span style="display:flex; justify-content:space-between;">• Freight (&gt;15kg): <strong style="color: #fb923c;">${requiredF} ng</strong> <span style="font-size:0.58rem; color:var(--text-muted);">(~${formatNumber(Math.round(pF_use))}/ng)</span></span>
                </div>
              </div>
            </div>

            <!-- Column 3: AI Commentary & Actual Match -->
            <div class="advisory-col">
              <div style="font-weight: 600; font-size: 0.74rem; color: var(--text-primary);">💡 Nhận Xét & Đối Chiếu AI</div>
              <div style="font-size: 0.68rem; color: var(--text-secondary); line-height: 1.45; display: flex; flex-direction: column; gap: 6px;">
                <div>Để đáp ứng forecast ngày <strong>${todayCalc.date}</strong> với <strong>${formatNumber(todayCalc.fc.total)} đơn</strong>, kho cần <strong>${todayCalc.requiredTotal} nhân sự</strong> (gồm <strong>${config.bufferPercent}% buffer</strong>). Cần thêm <strong>${todayCalc.flNeeded} Freelancer</strong> so với NVCT N-1.</div>
                ${todayCalc.closestActual ? `
                <div style="font-size: 0.62rem; color: var(--text-muted); background: rgba(255, 255, 255, 0.02); padding: 5px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); line-height: 1.3;">
                  📌 <strong>So khớp Actual:</strong> Ngày <strong>${todayCalc.closestActual.date}</strong> (Vol: <strong>${formatNumber(todayCalc.closestActual.volTotal)} đơn</strong>, NS: <strong>${todayCalc.closestActual.staffTotal} người</strong>).
                </div>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
      `;"""

new_content = content[:start_idx] + replacement_str + content[end_idx + len(end_marker):]
with open(filepath, "w", encoding="utf-8") as f:
    f.write(new_content)
print("SUCCESS: File js/capacity.js updated successfully!")
