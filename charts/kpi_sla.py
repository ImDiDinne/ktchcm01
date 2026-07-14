# charts/kpi_sla.py
"""Generate SLA trend chart for the last 7 days.
Outputs PNG file to ../assets/kpi_sla.png.
"""
import json
import matplotlib.pyplot as plt
import sys

def load_stats(stats_path: str):
    with open(stats_path, "r", encoding="utf-8") as f:
        return json.load(f)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python kpi_sla.py <stats_json_path>")
        sys.exit(1)
    stats = load_stats(sys.argv[1])
    dates = list(stats.get("daily_stats", {}).keys())
    sla_vals = [stats["daily_stats"][d]["sla"] for d in dates]
    plt.figure(figsize=(6, 4))
    plt.plot(dates, sla_vals, marker="o", linestyle="-", color="#4A90E2")
    plt.title("SLA Trend (7 ngày)")
    plt.xlabel("Ngày")
    plt.ylabel("SLA (%)")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig("../assets/kpi_sla.png")
    print("Saved assets/kpi_sla.png")
