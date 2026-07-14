# charts/kpi_peak_hour.py
"""Generate peak hour chart for the last 7 days.
Outputs PNG file to ../assets/kpi_peak_hour.png.
"""
import json
import matplotlib.pyplot as plt
import sys

def load_stats(stats_path: str):
    with open(stats_path, "r", encoding="utf-8") as f:
        return json.load(f)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python kpi_peak_hour.py <stats_json_path>")
        sys.exit(1)
    stats = load_stats(sys.argv[1])
    dates = list(stats.get("daily_stats", {}).keys())
    peaks = [stats["daily_stats"][d].get("peak_hour", "N/A") for d in dates]
    # Convert hour string "HH:00" to int for sorting/display
    hours = [int(p.split(':')[0]) if p != "N/A" else None for p in peaks]
    plt.figure(figsize=(6, 4))
    plt.plot(dates, hours, marker="o", linestyle="-", color="#E94A4A")
    plt.title("Peak Hour Trend (7 ngày)")
    plt.xlabel("Ngày")
    plt.ylabel("Giờ cao điểm")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig("../assets/kpi_peak_hour.png")
    print("Saved assets/kpi_peak_hour.png")
