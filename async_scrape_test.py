import asyncio
from playwright.async_api import async_playwright
import time

async def scrape_trip(context, trip_code):
    page = await context.new_page()
    url = f"https://nhanh.ghn.vn/ktc-van-tai/transport/detail?transportationCode={trip_code}&transportationStatus=SEARCH"
    
    session_completed_time = None
    
    async def handle_route(route):
        if 'locationId=' in route.request.url:
            import re
            new_url = re.sub(r'locationId=\d+', 'locationId=1626', route.request.url)
            await route.continue_(url=new_url)
        else:
            await route.continue_()
            
    await page.route("**/*", handle_route)
    
    async def handle_response(response):
        nonlocal session_completed_time
        if 'application/json' in response.headers.get('content-type', ''):
            if 'session' in response.url:
                try:
                    data = await response.json()
                    if data and data.get('data'):
                        for session in data['data']:
                            if session.get('type') == 'DROPOFF' and session.get('status') == 'COMPLETED':
                                end_time = session.get('endTime')
                                if end_time:
                                    session_completed_time = end_time
                except:
                    pass
            elif 'tms-history' in response.url:
                try:
                    data = await response.json()
                    if data and data.get('data'):
                        for item in data['data']:
                            if item.get('actionType') == 'STOP_SCAN_WAITING_FOR_CONFIRMATION':
                                end_time = item.get('actionTime')
                                if end_time and not session_completed_time:
                                    session_completed_time = end_time
                                break
                except:
                    pass
    
    page.on("response", handle_response)
    
    try:
        await page.goto(url, wait_until='networkidle', timeout=30000)
        await asyncio.sleep(2)
        
        try:
            await page.click("text='LỊCH SỬ CHUYẾN ĐI'", timeout=3000)
            await asyncio.sleep(1)
        except:
            pass
            
        body_text = await page.inner_text('body')
        if "mật khẩu" in body_text.lower() and "đăng nhập" in body_text.lower():
            print("Login required")
            await page.close()
            return "EXPIRED"
            
    except Exception as e:
        print(f"Error {trip_code}: {e}")
        
    await page.close()
    return session_completed_time

async def main():
    start = time.time()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(storage_state='state.json')
        
        trips = ['E260614QWJ0ZMM3', 'E2606149Q4U279J', 'E2606151MHF2HLH', 'E260615I1B4XVT9']
        
        tasks = [scrape_trip(context, trip) for trip in trips]
        results = await asyncio.gather(*tasks)
        
        print("Results:", results)
        await browser.close()
    print("Time taken:", time.time() - start)

if __name__ == '__main__':
    asyncio.run(main())
