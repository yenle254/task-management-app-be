# Bước 1 — Hợp đồng runtime production

Hoàn tất kiểm chứng: 10/11/2026. Phạm vi: Node, env, PORT, proxy và kiểm tra cấu hình trước startup. Health/readiness, shutdown, Docker và CI thuộc các bước tiếp theo.

Cập nhật 11/11/2026: health/readiness và shutdown đã được triển khai ở [bước 2](health-shutdown.md). Runtime bổ sung HEALTHCHECK_TIMEOUT_MS (mặc định 1000, tối đa 5000) và SHUTDOWN_TIMEOUT_MS (mặc định 15000, tối đa 120000), đều là số nguyên dương.

## Chạy và kiểm tra cấu hình

- Production dùng **Node.js 24 LTS**; development/test chấp nhận thêm Node 22.13.1 trở lên trong nhánh 22.x. `.nvmrc` vẫn chọn 24; package và lockfile khai báo `^22.13.1 || ^24.0.0`. Entry point bắt buộc major 24 khi NODE_ENV=production. Docker/CI sau này dùng Node 24 và pin patch/image đã kiểm thử.
- Máy khảo sát mặc định Node 22.13.1: có thể chạy `npm run dev` và `npm run check:config` với NODE_ENV=development ngay trên runtime hiện có. Chọn Node 24 trước khi chạy production; không tự thay Node hệ thống của người dùng.
- Nếu dùng nvm-windows: `nvm install 24`, `nvm use 24`, rồi kiểm tra `node --version`. Chỉ cần làm khi máy chưa có Node 24 được chọn.
- Copy `.env.example` sang `.env` cho local rồi điền giá trị thực. Trên hosting, inject qua environment settings; biến nền tảng có ưu tiên hơn `.env` vì dotenv không override.
- Chạy `npm run check:config`: validate mà không kết nối MongoDB, Cloudinary, email, AI hoặc mở cổng; thành công in Node/environment/port/host/proxy, lỗi chỉ nêu tên biến/quy tắc và exit code 1.
- `npm start` dùng cùng validator trước khi import middleware/logger, kết nối DB hoặc mở HTTP listener. Điều này cũng sửa thứ tự cũ khiến logger đọc NODE_ENV trước dotenv.
- Xác thực cú pháp không chứng minh credential đúng hoặc dịch vụ reachable. Những kiểm tra online nằm ở bước health/deploy.

Node khuyến nghị production dùng bản LTS được hỗ trợ: [Node releases](https://nodejs.org/en/about/previous-releases).

## Biến môi trường

| Biến | Quy tắc |
| --- | --- |
| `NODE_ENV` | development, test hoặc production; bỏ trống biến thì mặc định development, giá trị rỗng/viết sai bị từ chối |
| `PORT` | Số nguyên 1–65535; development/test mặc định 3000 khi biến chưa đặt; production bắt buộc. Hosting cấp PORT thì giữ giá trị đó |
| Bind address | Cố định `0.0.0.0`, không cần thêm biến HOST |
| `MONGO_URL` | Bắt buộc; MongoDB driver parse URI/options trước startup, hỗ trợ mongodb và mongodb+srv; production không dùng URI mẫu |
| `JWT_SECRET` | Ít nhất 32 byte, tạo ngẫu nhiên; production từ chối placeholder phổ biến |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `REFRESH_GRACE_SECONDS` | Giữ validator token hiện có: access tối đa 15m, refresh tối đa 90d, grace tối đa 300s; mặc định 15m/30d/60s |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Mặc định taskflow-api/taskflow-client; giữ đồng nhất giữa các lần deploy |
| `REFRESH_ENABLED` | true/false nếu khai báo; mặc định bật theo service hiện có |
| `ACCEPT_LEGACY_TOKENS` | Production phải chọn rõ; dùng false cho triển khai mới. Nếu true, bắt buộc cutoff UTC trong quá khứ |
| `LEGACY_TOKEN_ISSUED_BEFORE` | Cutoff thực tế của đợt chuyển đổi token, không tự gia hạn; giới hạn legacy token hiện có vẫn được giữ |
| `ALLOWED_ORIGINS` | Production bắt buộc, danh sách exact http(s) origins cách nhau dấu phẩy; không path/trailing slash hoặc wildcard. Dùng domain HTTPS thực khi deploy |
| `CLIENT_URL` | Fallback cho development; production phải chuyển sang ALLOWED_ORIGINS |
| `TRUST_PROXY` | Mặc định false; hoặc số hop dương 1–255; hoặc IP/CIDR cụ thể. true, wildcard, /0 và giá trị sai bị từ chối |
| `PRIVATE_FILES_ENABLED` | Production không cho false; để true theo mẫu |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Production bắt buộc để file tồn tại qua redeploy; dev/test được bỏ trống; mẫu credential bị từ chối trong production |
| `CLOUDINARY_ENABLED` | Nếu khai báo phải true/false; production không cho false |
| `CLOUDINARY_FOLDER` | Mặc định taskflow_uploads; nên tách folder staging và production |
| `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS` | Tùy chọn nhưng production đã cung cấp một giá trị thì cần đủ cả ba; thiếu email thì luồng gửi OTP không sử dụng được |
| `EMAIL_PORT`, `EMAIL_FROM` | Port nguyên hợp lệ, mặc định 587; from tùy nhà cung cấp. Transporter hiện dùng STARTTLS, không hỗ trợ implicit TLS 465 chỉ bằng cách đổi port |
| `EXPO_ACCESS_TOKEN` | Tùy chọn; bỏ trống khi chưa bật remote push; không dùng placeholder trong production |
| `AI_PROVIDER` | auto, gemini, ollama hoặc local_only; mẫu chọn local_only để dùng logic nội bộ, không gọi model ngoài |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Key bắt buộc khi chọn gemini; model có default trong AI config |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` | URL http(s), timeout nguyên 1–120000 ms nếu khai báo; production chọn ollama phải chỉ rõ URL reachable từ server. localhost trên hosting không phải máy phát triển |
| `LOG_LEVEL` | debug, info, warn, error hoặc silent; default production info |

Mẫu không chứa secrets có thể dùng thật. `EXPO_PUBLIC_*` chỉ thuộc mobile; tuyệt đối không đưa MONGO_URL/JWT/SMTP/Cloudinary secret vào APK.

## Proxy và HTTPS

- Local/direct ingress: `TRUST_PROXY=false`; HTTP bỏ qua forwarded headers cho req.ip/req.protocol.
- Khi biết subnet proxy: ưu tiên danh sách IP/CIDR giới hạn đúng proxy thực tế, ví dụ địa chỉ được nền tảng công bố. Không đoán địa chỉ hoặc cho phép toàn internet.
- Chỉ dùng `TRUST_PROXY=1` khi đã xác minh mọi request đi qua đúng một proxy đáng tin và không có đường vào trực tiếp/ngắn hơn. Tương tự với các hop count khác. Không xem đây là giá trị mặc định chung cho Railway/Render.
- Proxy phải làm sạch/ghi đè X-Forwarded-For, X-Forwarded-Proto và Host/forwarded-host đúng thiết kế. Khi cấu hình đúng, rate limiter dùng client IP và URL upload dựa trên req.protocol sẽ là HTTPS.
- Kiểm tra sau deploy: hai client khác IP không dùng chung budget; URL file trả đúng HTTPS/domain; forwarded headers giả không vượt trust boundary.
- `AUDIT_TRUST_PROXY` cũ chỉ là khai báo phục vụ audit, không điều khiển Express. Biến có hiệu lực đối với HTTP runtime mới là `TRUST_PROXY`.

Các điều kiện cho subnet và hop count được mô tả trong [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/).

## Database và tài khoản khởi tạo

- Bước này không chạy migration/seed hoặc thay đổi dữ liệu.
- Migration indexes hiện có `migrations/001_add_performance_indexes.js`: mặc định command là up, có fallback DB local và đang in toàn bộ URI ra console. Cần xử lý logging URI và xác minh target trước khi dùng trên production; không chạy tự động trong startup/CI.
- Migration leave `migrations/002_leave_workflow.js`: yêu cầu LEAVE_MIGRATION_URI, default dry-run và chỉ ghi khi có --apply. Phải backup và thử staging trước rollout thực tế.
- `npm run seed` hiện trỏ tới seed.js không tồn tại. Demo seed có dữ liệu riêng trong demo_project; không dùng để tạo admin production.
- SYSTEM_ADMIN_EMAIL/PASSWORD không được runtime hiện tại sử dụng nên đã bỏ khỏi mẫu env để tránh hiểu nhầm có bootstrap admin. Quy trình tạo admin production cần được hoàn tất ở bước tài liệu deploy.

## Kiểm chứng

- Test cấu hình gồm Node/PORT/URI/JWT/token/CORS/storage/tích hợp tùy chọn/proxy và quá trình startup lỗi.
- HTTP test kiểm tra forwarded headers từ peer đáng tin/không đáng tin, client IP và HTTPS URL.
- Test legacy token được cố định thời gian trong cửa sổ rollout để không phụ thuộc ngày chạy; logic chấp nhận token production không bị nới lỏng.
- Log kiểm chứng tại `report/logs/runtime-focused-tests.log` và `report/logs/runtime-full-tests.log`; coverage tại `coverage/`.

Kết quả cuối trên Node 24.22.1:

- Toàn bộ Jest: **50/50 suites, 781/781 tests passed**, exit code 0; đạt coverage threshold hiện có. Log cuối: `report/logs/runtime-full-tests.log`. Log focused là lần kiểm tra ban đầu, trước khi sửa fixture thời gian và chạy subprocess ngoài sandbox.
- `node scripts/check-config.js` với `.env` local: thành công, development / port 3000 / host 0.0.0.0 / trustProxy false. Không sửa `.env` hay kết nối dịch vụ thực.
- `git diff --check`: đạt; Git chỉ nhắc chuẩn hóa LF/CRLF trên Windows.
- Suite vẫn có cảnh báo Jest thoát chậm và một tác vụ audit bất đồng bộ ghi `audit_write_failed` sau test. Tiến trình tự kết thúc với exit code 0; chưa sửa phần cleanup audit ngoài phạm vi runtime này.
- Chưa xác minh credentials hoặc kết nối production. Node hệ thống tại thời điểm khảo sát là 22.13.1, được hỗ trợ cho development/test sau bản sửa tương thích local ngày 10/11/2026; production vẫn cần chọn Node 24.

Kiểm chứng bản sửa tương thích local:

- `npm run check:config` trên Node hệ thống 22.13.1 đạt với `.env` development hiện có.
- 71/71 test runtime đạt trên cả Node 22.13.1 và Node 24.22.1. Test xác nhận production vẫn từ chối Node 22, development/test chấp nhận Node 22.13.1+, các nhánh Node không hỗ trợ vẫn bị từ chối.
- Logs: `report/logs/runtime-node22-tests.log`, `report/logs/runtime-node24-tests.log`.
