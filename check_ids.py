import urllib.request
import json
url = "https://script.google.com/macros/s/AKfycbxpLqnIOLSV6MkEhss1vPVh7AxBZqVUv6F0xGmMGNtv1A55XVElUgBkoJuvJXgv2cHP/exec?action=getTrips"
resp = urllib.request.urlopen(url)
data = json.loads(resp.read())
trips = data.get("data", [])
for t in trips[-5:]:
    print(t.get("date"), t.get("id"), t.get("code"))
