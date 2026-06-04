/**
 * 🌐 Vercel Serverless Function — Metabase API Proxy
 * 
 * Đóng vai trò làm proxy trung gian để che giấu Session Token hoặc tài khoản Metabase.
 * Client-side (hoặc các cloud tool) gọi endpoint này để tải file Excel thô 
 * mà không cần biết token/mật khẩu thực tế.
 */

// Sử dụng global fetch có sẵn trong Node.js 18+ trên Vercel
module.exports = async (req, res) => {
  // Cấu hình CORS Header cho phép gọi từ trang Dashboard (GitHub Pages hoặc tên miền khác)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Xử lý preflight request OPTIONS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Đọc credentials từ biến môi trường của Vercel
  const username = process.env.METABASE_USERNAME;
  const password = process.env.METABASE_PASSWORD;
  let sessionToken = process.env.METABASE_SESSION;

  const cardId = 1386; // Question "Tồn chi tiết đơn"
  const metabaseUrl = 'https://data-bi.ghn.vn';

  try {
    // 1. Nếu không có session token nhưng có username/password, thực hiện đăng nhập để lấy token mới
    if (!sessionToken && username && password) {
      console.log('🔑 Đang đăng nhập Metabase bằng tài khoản hệ thống...');
      
      // Thử đăng nhập thường
      let loginResp = await fetch(`${metabaseUrl}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (loginResp.ok) {
        const data = await loginResp.json();
        sessionToken = data.id;
      } else {
        // Thử đăng nhập LDAP
        loginResp = await fetch(`${metabaseUrl}/api/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, ldap: true })
        });
        if (loginResp.ok) {
          const data = await loginResp.json();
          sessionToken = data.id;
        }
      }
    }

    // Nếu vẫn không có token, báo lỗi
    if (!sessionToken) {
      res.status(401).json({ 
        error: 'Chưa cấu hình METABASE_SESSION hoặc METABASE_USERNAME/PASSWORD trên môi trường Vercel.' 
      });
      return;
    }

    // 2. Gọi API Metabase để tải file XLSX qua Dashboard API để có sẵn bộ lọc kho (tránh bị truncate)
    const dashboardId = 152;
    const dashcardId = 1599;
    const parameterId = '6d90f1e2';
    const warehouseName = 'Kho Trung Chuyển Hồ Chí Minh 01';

    const queryUrl = `${metabaseUrl}/api/dashboard/${dashboardId}/dashcard/${dashcardId}/card/${cardId}/query/xlsx`;
    console.log(`📥 Đang gửi yêu cầu tải dữ liệu (có lọc Kho HCM 01) tới Metabase...`);

    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'X-Metabase-Session': sessionToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parameters: [
          {
            type: 'string/=',
            value: [warehouseName],
            id: parameterId
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ 
        error: `Metabase trả về lỗi: ${errorText.substring(0, 500)}` 
      });
      return;
    }

    // 3. Đọc dữ liệu nhị phân và stream ngược về cho Client
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Datatonkho.xlsx"');
    res.status(200).send(buffer);
    
    console.log(`✅ Proxy thành công! Đã gửi ${buffer.length} bytes dữ liệu.`);
  } catch (error) {
    console.error('❌ Lỗi API Proxy:', error);
    res.status(500).json({ error: `Lỗi máy chủ proxy: ${error.message}` });
  }
};
