# [Tên sản phẩm AI]

**Power User:** [Tên - Phòng ban]  
**Date:** [DD/MM/YYYY]  
**Demo target:** Tuần 6 — [ngày demo]

---

## 1. Executive Summary

**Một câu mô tả bài toán:**
> [VD: "Team tính lương freelancer mất 2-3 ngày OT mỗi kỳ, consolidate từ 6-7 tools khác nhau"]

**Một câu giải pháp AI:**
> [VD: "AI agent tự động consolidate dữ liệu, tính lương, đối soát vendor — query được qua GTalk chat"]

**Tiêu chí thành công (check ✅/❌):**
- [ ] Có người dùng thực tế (real user, không phải personal project)
- [ ] Kết nối / tích hợp nhiều nguồn dữ liệu
- [ ] Có AI xử lý / tư vấn bên trong
- [ ] Tương tác được với người khác
- [ ] Dùng open source + publish được thành MCP

---

## 2. Bài toán & Người dùng

**Pain point cụ thể (có số liệu):**
- Hiện tại: [VD: "Team 5 người, 2 lần/tháng mất 2-3 ngày OT để tính lương thủ công"]
- Thiệt hại: [VD: "10-15 ngày công/tháng, sai sót 5-10% phải đối soát lại"]

**User persona:**
- Ai dùng: [VD: "Freelancer + HR payroll team"]
- Quy mô: [VD: "500 freelancers, 5 HR staff"]
- Scope: [Vùng / Bưu cục / Toàn quốc]

**User stories (viết 2-3 cái):**
1. Là [user], tôi muốn [action], để [outcome].
2. Là [user], tôi muốn [action], để [outcome].

---

## 3. Giải pháp & Kiến trúc

**Sơ đồ luồng (text/ASCII):**
```
[Input: GTalk chat / Web form / API]
        ↓
[Data layer: Super Base / CSV / Vendor API]
        ↓
[AI Agent: ...]
        ↓
[Output: Alert / Report / Action]
        ↓
[User: HR / Manager / Freelancer]
```

**Tech stack (ưu tiên open source):**
- LLM: [model nào]
- Orchestration: [framework]
- Storage: [DB / vector store]
- Interface: GTalk (chính) + Web portal (phụ)
- Open source libs: [Notebook LM, H3, OSM, ...]

**Interactive layer:**
- Primary: GTalk chat
- Secondary: [Web portal / dashboard / notification]

---

## 4. MCP Design (Model Context Protocol)

**MCP name:** `[domain]-[function]`  
**VD:** `payroll-freelancer-query`

**Input schema:**
```json
{
  "user_id": "string",
  "query": "string",
  "scope": "string"
}
```

**Output schema:**
```json
{
  "result": "object",
  "confidence": "float",
  "sources": ["array"]
}
```

**Permission scope:** [ai được consume MCP này]

---

## 5. Data Strategy

| Data source | Format | Volume | Owner | Access |
|-------------|--------|--------|-------|--------|
|             |        |        |       |        |

**Permission model:**
- Public: [...]
- Internal (Power User): [...]
- Restricted (theo role): [...]

**Knowledge organization:**
- Domain: [finance / logistics / hr / accounting / ...]
- Memory: [short-term / long-term / both]
- Refresh frequency: [...]

---

## 6. Plan 6 tuần

| Tuần | Milestone | Deliverable | Status |
|------|-----------|-------------|--------|
| 1    | Validate idea + data prep | Refined doc + data sample | ⬜ |
| 2-4  | Build core                | MVP chạy được trên data thật | ⬜ |
| 5    | Test với real user        | Feedback iteration log    | ⬜ |
| 6    | Demo + Publish MCP        | Live demo + MCP published | ⬜ |

**Caravan week note:** Tuần caravan vẫn coi là build week nhưng capacity giảm.

---

## 7. Agent Spec

- **Agent ID:** `[finance.pnl-simulation]` / `[logistics.route-optimizer]`
- **Profile:** [mô tả 1 dòng]
- **Scope of work:** [input/output rõ ràng]
- **Domain:** [finance | logistics | hr | accounting | marketing]
- **Data access:** [list nguồn được phép đọc]
- **Memory:** [cách agent nhớ qua sessions]
- **Lifecycle:** [khi nào tạo / update / retire]

---

## 8. Rủi ro & Mitigation

| Rủi ro | Impact | Mitigation |
|--------|--------|------------|
| Token cost cao | Budget overrun | Optimize qua Notebook LM, fracture query, cache |
| Data leakage | Security | Audit permission, scope chặt, log truy cập |
| User adoption thấp | ROI thấp | Interactive UI (GTalk), demo trực tiếp, training ngắn |
| API rate limit | Downtime | Fallback offline fetch, batch process |
| Data structure không thống nhất | Output sai | ETL layer, schema validation |

---

## 9. Success Metrics

**Baseline (hiện tại):**
- [VD: "60% precision" / "10-15 ngày OT/tháng" / "5-10% sai sót"]

**Target (sau 6 tuần):**
- [VD: "70-80% precision" / "0 ngày OT" / "<2% sai sót"]

**Adoption metric:**
- Số user active
- Query/ngày
- % task tự động hóa được

**Business impact:**
- Giờ công saved
- % phát hiện sớm (delay, risk)
- Cost reduction cụ thể (VND)

---

## 10. Open Questions / Cần support

- [Câu hỏi 1]
- [Câu hỏi 2]
- [Cần support từ: Data team / IT / Mentor / ...]

---

**Sign-off:**
- Power User: ___________ Ngày: ___
- Mentor review: ___________ Ngày: ___