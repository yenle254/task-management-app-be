# Kế hoạch Docker, CI và triển khai production

Ngày khảo sát: 09/11/2026. Trạng thái: chỉ lập kế hoạch; chưa sửa mã nguồn, chạy test/build, tạo hạ tầng hoặc deploy.

Cập nhật 10/11/2026: đã thực hiện bước 1 và kiểm chứng 781 tests đạt trên Node 24.22.1; xem [hợp đồng runtime và kết quả kiểm chứng](production-runtime.md). Các bước 2–6 vẫn là kế hoạch chưa thực hiện. Phần hiện trạng bên dưới ghi nhận thời điểm khảo sát ban đầu.

Cập nhật 11/11/2026: đã triển khai bước 2, gồm `/health/live`, `/health/ready` và shutdown có deadline; xem [chi tiết và kiểm chứng](health-shutdown.md). Các bước 3–6 chưa thực hiện.

Cập nhật 12/11/2026: bước 3 đã build và kiểm chứng Docker image Linux thành công, chạy non-root, health/shutdown và upload pipeline đạt smoke test. Xem [hướng dẫn Docker và giới hạn kiểm chứng cloud](docker-production.md). Các bước 4–6 chưa thực hiện.

## 1. Hiện trạng đã kiểm tra

- Backend là repository riêng tại `server/`, chạy CommonJS trực tiếp bằng `node server.js`; có `package-lock.json`, chưa có script build/lint hoặc khai báo Node engines.
- Chưa thấy Dockerfile, .dockerignore, GitHub Actions workflow hoặc health-check endpoint. Route `/` hiện chỉ trả thông tin API.
- Jest đã có cấu hình coverage: branches 50%, functions/lines/statements 70%. Chưa xác nhận suite hiện tại pass; chưa thấy test trong `tests/integration/` qua khảo sát file.
- `server.js` mở HTTP server trong khi MongoDB còn đang kết nối. SIGTERM mới dừng reminder scheduler; chưa có một luồng shutdown chung cho HTTP, Socket.IO và MongoDB. `config/database.js` có xử lý SIGINT riêng.
- CORS production yêu cầu `ALLOWED_ORIGINS` cụ thể. Chưa thấy cấu hình Express trust proxy trong entry point; upload URL sử dụng `req.protocol`.
- Upload ghi file tạm vào `uploads/`, sau đó chuyển lên Cloudinary khi được cấu hình. Cần thư mục ghi được trong container và lưu trữ bền vững khi deploy lại.
- Socket online state nằm trong bộ nhớ tiến trình; reminder scheduler chạy cùng backend. Chọn một instance cho giai đoạn đầu; scale nhiều instance cần thiết kế riêng.
- Mobile Expo SDK 54 nằm tại `../project`. `project/eas.json` mới có development profile. Backend cũng có `app.json`/`eas.json` nhưng liên kết EAS project khác; không dùng các file này để build mobile.
- Mobile hiện dùng URL Android emulator trong `src/config/api.config.js`. AGENTS.md frontend ghi rõ không sửa file này. Kế hoạch dùng lớp cấu hình production riêng và điều chỉnh các nơi tiêu thụ URL, giữ file local hiện có.
- `.gitignore` backend đang ignore toàn bộ `*.md`: cần ngoại lệ có chọn lọc cho tài liệu deploy để tài liệu thực sự vào Git.

## 2. Phương án mục tiêu

- Một Docker image backend dùng được trên Railway hoặc Render; tài liệu bao phủ cả hai, triển khai thực tế ban đầu trên một nền tảng.
- MongoDB Atlas cho database, Cloudinary cho file upload, HTTPS cho API và kết nối Socket.IO an toàn.
- Docker và CI dùng cùng một Node LTS đã kiểm tra tương thích. Đề xuất Node 24 LTS làm baseline; pin phiên bản image khi triển khai. Node khuyến nghị production dùng Active/Maintenance LTS: [Node.js releases](https://nodejs.org/en/about/previous-releases).
- GitHub Actions kiểm thử và build image trên pull request/push; chỉ commit đã qua checks được đưa lên production. Thiết lập branch protection/required checks trong repository khi triển khai.
- APK phát hành nội bộ là release build chạy độc lập, không cần Metro. AAB dành cho Google Play là tùy chọn sau này.
- Không đưa Kubernetes, Redis hay tự động phát hành lên store vào phạm vi đợt đầu.

## 3. Thứ tự thực hiện

### Bước 1 — Chuẩn hóa runtime và hợp đồng cấu hình

1. Chốt Node version, nhánh production và build context tại root repository backend.
2. Rà soát biến môi trường thực sự được đọc từ source; đồng bộ `.env.example` và bảng biến trong tài liệu.
3. Phân loại bắt buộc: MongoDB, JWT/token settings, CORS, storage; email/Expo push/AI theo tính năng được bật. Không sử dụng placeholder như credential hợp lệ.
4. Đặt `NODE_ENV=production`, đọc `PORT` của nền tảng, bind `0.0.0.0`; kiểm tra PORT và cấu hình bắt buộc ngay khi khởi động.
5. Cấu hình trust proxy theo topology được nền tảng bảo đảm, xác minh IP cho rate limiter và HTTPS cho URL file; tránh bật tin cậy mọi proxy không giới hạn.
6. Rà soát legacy token cutoff và private-file mode cho production. Với triển khai mới không có token cũ, ưu tiên tắt chấp nhận legacy token.
7. Rà soát migration/index và quy trình tạo admin ban đầu; không tự chạy seed/reset dữ liệu mỗi lần khởi động.
8. AI hiện có lựa chọn Ollama localhost: ghi rõ phải chọn provider truy cập được từ production hoặc cấu hình tính năng không khả dụng phù hợp.

Đầu ra: hợp đồng env rõ ràng, Node version thống nhất, danh sách kiểm tra startup và các thay đổi tối thiểu cần thiết.

### Bước 2 — Health check và vòng đời server

| Endpoint dự kiến | Mục đích | Hành vi |
| --- | --- | --- |
| `GET /health/live` | Tiến trình HTTP còn phản hồi | 200 khi process phục vụ được request, không phụ thuộc MongoDB |
| `GET /health/ready` | Sẵn sàng nhận nghiệp vụ | 200 khi startup hoàn tất và MongoDB ping thành công; 503 khi chưa sẵn sàng, mất DB hoặc đang shutdown |

- Response theo cấu trúc success/data hoặc success/error hiện có; không trả connection string, lỗi nội bộ hay secrets.
- Endpoint công khai, không yêu cầu JWT, không đi qua business rate limiter; không phụ thuộc email, AI hoặc Cloudinary cho mỗi probe.
- DB probe có timeout ngắn và giới hạn tổng thời gian; kiểm tra connection state trước khi ping. Không chỉ dùng trạng thái connected để kết luận DB thực sự phản hồi.
- Health routes phải đặt trước 404 handler. Nếu cần tách app construction khỏi bootstrap để kiểm thử, chỉ refactor tối thiểu và giữ HTTP/Socket.IO dùng cùng server.
- Tập trung SIGTERM/SIGINT về một handler idempotent: chuyển readiness sang 503, dừng scheduler, ngừng nhận kết nối mới, đóng Socket.IO/HTTP và MongoDB, có thời hạn thoát hữu hạn. Hợp nhất handler cũ để tránh exit sớm.
- Docker healthcheck dùng liveness; nền tảng dùng readiness và grace period phù hợp. Kiểm tra khác biệt hành vi giữa hai nền tảng khi viết cấu hình: [Railway healthchecks](https://docs.railway.com/deployments/healthchecks), [Render health checks](https://render.com/docs/health-checks).

Nghiệm thu: kiểm thử các trạng thái chưa kết nối/connected/ping lỗi/ping timeout/shutdown; healthy trả 200, not-ready trả 503; SIGTERM thoát trong thời hạn và không bỏ timer/socket đang mở.

### Bước 3 — Docker production

- Tạo `Dockerfile` và `.dockerignore`; dùng Node LTS image gọn, cài dependencies từ lockfile bằng `npm ci --omit=dev`.
- Backend không có bước biên dịch; không thêm stage build hoặc script build giả. Tách bước cài dependencies để tận dụng cache.
- Runtime chạy bằng user không phải root; chạy `node server.js` bằng exec form để nhận tín hiệu dừng đúng.
- Tạo và cấp quyền ghi thư mục upload tạm cho runtime user. Cloudinary là lựa chọn storage mặc định của kế hoạch production; kiểm tra không âm thầm lưu local khi cấu hình thiếu.
- Loại `.env*` chứa secrets, `.git`, node_modules, uploads, coverage, report và dữ liệu cục bộ khỏi build context; xác nhận mọi module runtime cần thiết vẫn được copy.
- HEALTHCHECK dùng Node sẵn có, không bắt buộc cài curl; timeout/start period/retry được đặt rõ ràng.
- Không chạy migrations, seed hoặc nhúng secrets trong quá trình build image.

Nghiệm thu: build từ checkout sạch; container chạy với env được inject lúc start; user non-root; health chuyển healthy; upload không lỗi quyền; dừng bằng SIGTERM thành công; không có secrets hoặc dữ liệu upload trong image.

### Bước 4 — GitHub Actions CI

Workflow dự kiến: `.github/workflows/ci.yml` tại root repository backend.

1. Trigger pull request, push nhánh chính và chạy thủ công; đặt permissions tối thiểu, timeout và concurrency.
2. Checkout → setup Node cùng phiên bản Docker → cache npm theo lockfile → `npm ci`.
3. Chạy toàn bộ Jest bằng chế độ CI và coverage; giữ các threshold hiện tại, xử lý lỗi baseline thay vì hạ threshold để xanh.
4. Bổ sung test health và lifecycle. Suite dùng mock không cần database production; container smoke test dùng MongoDB service/container tạm, chỉ dữ liệu thử nghiệm.
5. Build Docker image, khởi động với test env, chờ readiness có timeout và kiểm tra đường đi HTTP cơ bản; dọn container sau job.
6. Lưu coverage và log làm artifacts kể cả khi job lỗi. Coverage vẫn ở `coverage/`; file `.log` nằm trong `report/logs/`.
7. Pin GitHub Actions vào commit SHA đã xác minh tại thời điểm triển khai. PR từ fork không được đọc production secrets.
8. Không thêm bước `npm run lint` hoặc `npm run build` khi chưa có script tương ứng. Cấu hình lint toàn repository là phạm vi riêng nếu cần.

Nghiệm thu: một PR hợp lệ chạy xanh trên Linux, test lỗi làm job đỏ, build image lỗi làm job đỏ, health lỗi làm smoke job đỏ; pipeline không cần credential production.

Tham chiếu: [GitHub Actions cho Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).

### Bước 5 — Tài liệu Railway / Render / Atlas

Tạo `report/production-deployment.md`, gồm các phần:

1. Điều kiện chuẩn bị: tài khoản GitHub, một hosting provider, Atlas, Cloudinary, SMTP và Expo khi sử dụng; người sở hữu secret và môi trường staging/production.
2. Atlas: cluster/region gần backend, database user giới hạn quyền theo database, URI SRV đặt trong `MONGO_URL`, network access theo outbound IP/CIDR thực tế của hosting. Không mặc định mở tất cả IP. Thực hiện theo [Atlas IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/).
3. Backup/restore và migrations: kiểm tra migration hiện có trước khi chạy, thử trên staging, backup trước thay đổi dữ liệu, chạy có kiểm soát một lần; không đưa dữ liệu demo vào production.
4. Railway: kết nối đúng repository/branch, chọn Dockerfile/context, inject env, public domain/HTTPS, PORT, readiness path, logs và rollback.
5. Render: tạo Docker web service, đúng context/Dockerfile, env, port, readiness path, domain/HTTPS, logs và rollback.
6. Chọn gói đáp ứng uptime, WebSocket và scheduler; xác minh chính sách sleep/scale-to-zero tại thời điểm deploy. Không cam kết vận hành scheduler ổn định trên dịch vụ tự ngủ.
7. Cloudinary/private files: kiểm tra upload/download theo quyền và file còn đọc được sau redeploy; thống kê file local cũ cần chuyển nếu có.
8. Deploy chỉ sau CI pass: ghi rõ cách nền tảng chờ CI hoặc quy trình deploy thủ công commit đã kiểm chứng. Không bật auto-deploy không kiểm soát chỉ vì có workflow CI.
9. Smoke test từ bên ngoài: readiness, login/refresh, task, attendance, upload/download, Socket.IO giữa hai client, reminder và email/push nếu bật.
10. Vận hành: giám sát uptime từ bên ngoài, log lỗi, cảnh báo, kiểm tra DB/storage, restart, rollback commit/image. Rollback code không tự hoàn tác migration dữ liệu.

Nghiệm thu: người khác làm theo tài liệu có thể deploy staging từ đầu, kiểm chứng các luồng chính và rollback về phiên bản tốt trước đó.

### Bước 6 — Tài liệu và cấu hình build APK bằng EAS

Tạo `report/eas-apk-build.md` để ghi hướng dẫn liên quan tới bản backend này; mọi thay đổi mã mobile tương lai thuộc repository `project/`.

1. Dùng Expo project và Android package hiện có của `project/`; kiểm tra owner/projectId/FCM package khớp nhau, không lấy ID từ `server/app.json` và không tạo project mới tùy ý.
2. Giữ development profile; thêm profile release APK độc lập (ví dụ `production-apk`) với `android.buildType=apk`, internal distribution và không bật development client. Profile AAB cho store là tùy chọn. Expo mặc định tạo AAB, còn APK cần cấu hình tương ứng: [Expo APK builds](https://docs.expo.dev/build-reference/apk/).
3. Thêm đường cấu hình API production riêng, ưu tiên `EXPO_PUBLIC_API_URL` và chuẩn hóa Socket.IO origin từ cùng nguồn; rà soát mọi nơi hardcode localhost/emulator/LAN. Production phải báo lỗi rõ khi URL thiếu, không fallback về `10.0.2.2`.
4. Tuân thủ `project/AGENTS.md`: giữ nguyên `src/config/api.config.js`; thiết kế module cấu hình khác và sửa các consumer cần thiết. Nếu muốn sửa trực tiếp file được bảo vệ này, đó là quyết định phạm vi cần chốt ở bước thực hiện.
5. Cấu hình EAS environment production/preview phù hợp; URL public được đóng gói trong app, không chứa JWT secret, Atlas URI, SMTP credential hay Cloudinary secret. [Expo environment variables](https://docs.expo.dev/eas/environment-variables/).
6. Kiểm tra `.easignore`: source mới phải được upload, local env/keystore/admin credential phải bị loại; kiểm tra cấu hình Firebase client và credentials FCM phục vụ push đúng dự án.
7. Kiểm tra Expo dependencies/native plugins, signing keystore, versionCode và quyền GPS/files/notifications. Không nâng Expo SDK chỉ để hoàn thành nhiệm vụ deploy này.
8. Tài liệu hóa lệnh chạy từ thư mục `project`: `eas build -p android --profile production-apk`, cách lấy artifact, cài APK và kiểm tra bản release không cần Metro. Lệnh chỉ được chạy ở giai đoạn triển khai/build, không chạy trong bước lập kế hoạch.
9. Test APK trên thiết bị thật, qua mạng di động: login/refresh/logout, CRUD task, GPS attendance, upload/download, Socket.IO reconnect và push khi đã cấu hình FCM.

Nghiệm thu: APK cài được, mở độc lập, gọi HTTPS production đúng host, không phụ thuộc máy phát triển, giữ dữ liệu sau backend redeploy và không đóng gói backend secrets.

## 4. Danh sách đầu ra dự kiến

| Phạm vi | File/đầu ra |
| --- | --- |
| Backend runtime | `server.js`, `config/database.js`, cấu hình env/proxy và health routes/controller phù hợp cấu trúc hiện có |
| Container | `Dockerfile`, `.dockerignore` |
| CI | `.github/workflows/ci.yml`, test health/lifecycle, smoke-check script nếu cần |
| Cấu hình | `package.json` engines, `.env.example`, ngoại lệ tài liệu trong `.gitignore` |
| Tài liệu | `report/production-deployment.md`, `report/eas-apk-build.md` |
| Mobile | `project/eas.json`, module cấu hình production và các consumer; app config chỉ sửa khi cần |
| Bằng chứng nghiệm thu | `report/deployment-verification.md`, `report/logs/*.log`, `coverage/` |

## 5. Mốc hoàn thành và điểm cần chốt khi thực hiện

Thứ tự phụ thuộc: runtime/env → health/shutdown → Docker → CI → Atlas/hosting staging → kiểm chứng backend → APK → nghiệm thu production.

- Mốc A: Docker chạy local, test/lifecycle/health đạt yêu cầu.
- Mốc B: GitHub Actions xanh trên checkout sạch, required checks được cấu hình.
- Mốc C: một hosting provider kết nối Atlas/Cloudinary, HTTPS và các luồng nghiệp vụ hoạt động; có rollback.
- Mốc D: APK release được cài trên máy thật và dùng backend production; tài liệu đủ để tái thực hiện.

Cần chốt trước provisioning/build thực tế: Railway hay Render, gói/region và ngân sách; repository/nhánh production; domain/origins; môi trường dữ liệu mới hay migration dữ liệu hiện có; quyền truy cập tài khoản Expo/signing/FCM; phạm vi sửa mobile. Các mục này không cản trở việc lập kế hoạch hoặc chuẩn bị backend.

Ước lượng sơ bộ: 3–5 ngày làm việc cho một người nếu suite hiện có ổn định và tài khoản/credentials sẵn sàng; chưa bao gồm thời gian xử lý lỗi nền có sẵn, chuyển dữ liệu lớn hoặc chờ build của nhà cung cấp.
