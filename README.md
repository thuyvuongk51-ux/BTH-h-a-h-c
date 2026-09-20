# Trợ lý Hóa học AI — Bản Netlify Functions

Bộ code này gồm:
- `netlify/functions/chat.js` — backend (Netlify Function) gọi Gemini API, giữ API key an toàn
- `public/index.html` — giao diện demo: tab Hỏi đáp + tab Tạo bài tập (y hệt bản Vercel, không cần sửa gì)
- `netlify.toml` — cấu hình để `/api/chat` tự động trỏ sang function thật

---

## Bước 1: Lấy API key Gemini (miễn phí)

1. Vào https://aistudio.google.com/apikey
2. Đăng nhập Google, bấm "Create API key"
3. Copy key này lại (dùng ở Bước 3)

## Bước 2: Đưa code lên GitHub

```bash
cd ai-chemistry-app-netlify
git init
git add .
git commit -m "AI chemistry assistant - Netlify version"
git remote add origin <link-repo-github-cua-ban>
git push -u origin main
```

## Bước 3: Deploy lên Netlify (miễn phí)

1. Vào https://app.netlify.com → đăng nhập bằng GitHub
2. Bấm "Add new site" → "Import an existing project" → chọn repo vừa push
3. Netlify tự đọc `netlify.toml` nên không cần cấu hình build command hay publish directory
4. Trước khi deploy (hoặc sau, vào **Site configuration → Environment variables**), thêm:
   - Key: `GEMINI_API_KEY`
   - Value: (dán API key từ Bước 1)
5. Bấm Deploy

Sau khi xong, Netlify cho bạn 1 link dạng `https://ten-app.netlify.app` — mở link đó là dùng được ngay.

### Test nhanh bằng CLI (tùy chọn)

```bash
npm install -g netlify-cli
netlify dev
```

Lệnh này chạy cả frontend lẫn function ở local (`http://localhost:8888`), tự đọc biến môi trường từ file `.env` nếu bạn tạo:

```
GEMINI_API_KEY=your_key_here
```

---

## Tích hợp vào app HTML hiện có của bạn

1. Copy `netlify/functions/chat.js` và `netlify.toml` vào project của bạn (giữ nguyên cấu trúc thư mục)
2. Trong file JS của app, gọi y như trước — không đổi gì cả nhờ redirect trong `netlify.toml`:

```javascript
// Hỏi đáp
const res = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "qa", message: "Phản ứng oxi hóa khử là gì?" }),
});
const data = await res.json();
console.log(data.reply);

// Tạo bài tập
const res2 = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "exercise", topic: "Axit - Bazơ", level: "trung bình", count: 5 }),
});
const data2 = await res2.json();
console.log(data2.exercises);
```

---

## Khác biệt so với bản Vercel

| | Vercel | Netlify |
|---|---|---|
| Thư mục function | `api/` | `netlify/functions/` |
| Format hàm | `export default function handler(req, res)` | `exports.handler = async (event) => {...}` |
| Đường dẫn gọi thật | `/api/chat` (tự động) | `/.netlify/functions/chat` (có redirect về `/api/chat` trong `netlify.toml`) |
| Biến môi trường | Project Settings → Environment Variables | Site configuration → Environment variables |

Logic gọi Gemini, xử lý JSON bài tập, giới hạn độ dài câu hỏi... giữ nguyên 100% giữa 2 bản.

---

## Lưu ý quan trọng

- **Không bao giờ** đặt API key trực tiếp trong file HTML/JS chạy ở trình duyệt.
- Free tier Gemini có giới hạn request/phút — nếu lớp học đông cùng lúc, cân nhắc thêm hàng đợi hoặc giới hạn số lần hỏi/học sinh/ngày.
- Model đang dùng: `gemini-2.0-flash`. Có thể đổi trong `netlify/functions/chat.js`.
