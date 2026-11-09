# Hải Chiến Bo trên Render

Thư mục này gồm trang game và một máy chủ nhỏ. Máy chủ lo ba việc: tài khoản nick (đăng nhập bằng nick + mật khẩu), bảng xếp hạng, và chuyển dữ liệu phòng chơi qua WebSocket để máy khách ít giật.

## Đưa lên Render lần đầu (khoảng 10 phút)

1. Tạo repository trên GitHub, ví dụ `hai-chien-bo`.
2. Bấm **Add file → Upload files**, kéo vào `package.json`, `server.js` và thư mục `public`. Bấm **Commit changes**.
3. Trên https://render.com bấm **New → Web Service**, chọn repository đó. Chọn Region **Singapore**, Runtime **Node**, Build Command `npm install`, Start Command `npm start`.
4. Ở mục **Environment**, thêm các biến ở phần dưới, rồi bấm **Create Web Service**.

## Cập nhật bản mới (từ v47)

Dữ liệu model, âm thanh đã tách khỏi `index.html` sang thư mục `public/assets/` (mỗi file dưới 5 MB). Mỗi lần cập nhật, thầy tải lên **cả thư mục `public`** (gồm `index.html` và `assets/`), cùng `server.js` nếu có thay đổi. Trình duyệt sẽ giữ sẵn các file model đã tải, lần sau mở game nhanh hơn; file nào đổi thì tự tải lại.

## Các biến trong mục Environment của Render

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Địa chỉ cơ sở dữ liệu để lưu nick (xem phần dưới). **Bắt buộc nếu muốn giữ nick lâu dài.** |
| `ADMIN_NICK` | Nick của thầy. Nick này đăng nhập là thấy ô chế độ admin. |
| `ADMIN_KEY` | Khóa admin cũ (từ 6 ký tự), vẫn dùng được qua dòng 🔑 Nhập khóa admin. |

## Tạo cơ sở dữ liệu miễn phí (Neon, khoảng 5 phút)

Gói Free của Render xóa sạch ổ đĩa mỗi lần máy chủ ngủ dậy hoặc cập nhật. Vì vậy nick phải lưu ở một cơ sở dữ liệu bên ngoài. Neon có gói miễn phí không hết hạn.

1. Vào https://neon.tech, bấm **Sign up** và đăng nhập bằng GitHub.
2. Tạo project: đặt tên `hai-chien-bo`, chọn region **AWS Asia Pacific (Singapore)**, bấm **Create project**.
3. Ở trang project, bấm **Connect**. Chép dòng **Connection string**, dạng `postgresql://...@...neon.tech/neondb?sslmode=require`.
4. Trên Render, mở service game, vào **Environment → Add Environment Variable**. Key là `DATABASE_URL`, Value là dòng vừa chép. Bấm **Save, rebuild, and deploy**.

Máy chủ tự tạo bảng khi chạy lần đầu, thầy không cần chạy lệnh SQL nào. Trong **Logs** của Render sẽ có dòng `accounts stored in postgres`. Nếu thấy `accounts stored in file` là chưa có `DATABASE_URL`: nick vẫn tạo được nhưng sẽ mất khi máy chủ khởi động lại.

## Chơi

- Mỗi người mở link game, bấm **Tạo nick mới** (nick 3–16 ký tự, mật khẩu từ 6 ký tự). Lần sau chỉ cần **Đăng nhập**, máy sẽ nhớ.
- Phải đăng nhập mới tạo phòng hoặc vào phòng được. Không đăng nhập vẫn chơi một mình được.
- Mỗi trận xong, số trận, số trận thắng, số hạ gục được lưu vào nick. Nút **Bảng xếp hạng** hiện top 20.
- Nick không phân biệt dấu và chữ hoa: đã có "Thủy" thì không ai tạo được "thuy".

## Lưu ý

- Gói Free cho máy chủ ngủ sau 15 phút không ai vào. Lần mở đầu tiên sau đó mất khoảng 1 phút để thức dậy.
- Khi có bản game mới, chỉ cần thay `public/index.html` trên GitHub.
