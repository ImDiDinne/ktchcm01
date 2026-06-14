import urllib.request
import json

url = 'https://script.google.com/macros/s/AKfycbxpLqnIOLSV6MkEhss1vPVh7AxBZqVUv6F0xGmMGNtv1A55XVElUgBkoJuvJXgv2cHP/exec?action=getTrips'

try:
    print("Fetching data from API...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        data = json.loads(html)
        print("Status:", data.get("status"))
        trips = data.get("data", [])
        print("Number of trips:", len(trips))
        if trips:
            print("First trip keys:", trips[0].keys())
            print("First trip sample:", json.dumps(trips[0], ensure_ascii=False, indent=2))
            
            # Print unique dates
            dates = set(t.get("date") for t in trips if t.get("date"))
            print("Unique dates:", sorted(list(dates)))
            
            # Print unique statuses
            statuses = set(t.get("status") for t in trips if t.get("status"))
            print("Unique statuses:", statuses)
except Exception as e:
    print("Error:", e)
