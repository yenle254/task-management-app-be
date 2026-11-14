# Bước 5 — Deploy backend Railway/Render và MongoDB Atlas

Đối chiếu source và tài liệu nhà cung cấp ngày 12/11/2026. Repository: `yenle254/task-management-app-be`, nhánh triển khai `master`. Đây là hướng dẫn vận hành; chưa tạo tài nguyên cloud, chạy migration hoặc deploy production trong bước viết tài liệu.

## 1. Kiến trúc và điều kiện trước khi deploy

Chọn **một** nơi chạy backend: Railway hoặc Render. Mobile/web gọi API HTTPS và Socket.IO trên cùng domain; backend dùng MongoDB Atlas cho dữ liệu và Cloudinary cho file. Không chạy MongoDB trong container API.

- Deploy staging trước, sau đó mới production; tách database, database user, JWT secret, Cloudinary folder và credentials tích hợp giữa hai môi trường. Không dùng bản sao dữ liệu nhân sự thật cho staging nếu chưa có quy trình bảo vệ dữ liệu.
- Chọn commit cụ thể đã có check **Backend CI = success** trên `master`. Ghi SHA, link CI và deployment ID vào hồ sơ release. File workflow không tự cấu hình hosting hoặc branch protection.
- Source root trên GitHub chính là thư mục backend: để Root Directory trống/mặc định, không nhập `server/`. Dockerfile ở `./Dockerfile`, context `.`; dùng Node 24 từ image đã pin. Không dùng nodemon hoặc lệnh build frontend.
- Ban đầu dùng **1 instance/replica**, gói luôn chạy; tắt sleep/serverless nếu nền tảng cho phép cấu hình. Scheduler khởi chạy ngay sau kết nối MongoDB và chạy mỗi phút; app ngủ sẽ bỏ lỡ thời điểm xử lý.
- Socket.IO, rate limit và một phần trạng thái đang nằm trong tiến trình. Chưa có thiết kế vận hành nhiều replica được nghiệm thu. Rolling deploy vẫn có thể chạy hai phiên bản chồng nhau dù replica = 1; kiểm tra reminder trùng/mất và socket reconnect trên staging. Nếu cần bảo đảm không chồng tiến trình, triển khai trong cửa sổ bảo trì với downtime được chấp nhận, hoặc hoàn thiện cơ chế phối hợp scheduler trước.
- Chuẩn bị tài khoản cloud, quyền repository, domain nếu dùng domain riêng, người nhận cảnh báo, nơi lưu secrets và bản backup có thể phục hồi. Kiểm tra hạn mức/chi phí/gói tại thời điểm chọn; tài liệu không cam kết giá hoặc SLA của gói miễn phí.

Tài liệu liên quan: [runtime](production-runtime.md), [Docker](docker-production.md), [health/shutdown](health-shutdown.md), [CI](github-actions-ci.md).

## 2. MongoDB Atlas

1. Tạo project và cluster, chọn region gần backend. Dùng database riêng, ví dụ `taskflow_staging` hoặc `taskflow_prod`; không dùng `tma_demo` cho production.
2. Tạo **database user**, khác tài khoản đăng nhập Atlas. Bắt đầu với `readWrite` trên đúng database ứng dụng, giới hạn cluster khi có thể. Tài khoản backup/migration được cấp riêng theo thao tác cần làm, thu hồi quyền tạm sau sử dụng. Xem [Atlas database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/).
3. Trong Network Access, thêm toàn bộ IP/CIDR **outbound** của dịch vụ backend; IP của domain public là inbound, không dùng thay thế. Thêm IP máy vận hành bằng entry có thời hạn nếu cần migration. Không mặc định mở `0.0.0.0/0`. Atlas chỉ nhận kết nối từ danh sách cho phép: [IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/).
4. Render: Service → Connect → Outbound, sao chép đủ các CIDR của service; các dải có thể dùng chung trong region. Nếu chuyển region, kiểm tra lại. Xem [Render outbound IPs](https://render.com/docs/outbound-ip-addresses).
5. Railway: Settings → Networking → Enable Static IPs khi gói hỗ trợ (tài liệu hiện nêu Pro), lấy mọi IPv4 được cấp, thêm vào Atlas và redeploy. Nếu chưa có outbound ổn định, giải quyết bằng gói/network phù hợp trước production. Xem [Railway static outbound IPs](https://docs.railway.com/networking/static-outbound-ips).
6. Atlas → Connect → Drivers → Node.js, lấy URI SRV. Thay user/password và **tên database**; percent-encode ký tự đặc biệt trong user/password, không encode toàn URI. Giữ TLS và các option do Atlas cung cấp. Dạng minh họa: `mongodb+srv://USER:PASSWORD@CLUSTER/taskflow_prod?retryWrites=true&w=majority` — không dán nguyên placeholder vào hosting.
7. Lưu URI dưới tên `MONGO_URL` trong secrets/environment của hosting. Không commit, chụp ảnh hoặc đưa URI vào log/ticket. Xác minh bằng kết nối thật và readiness; validator chỉ kiểm tra định dạng.

**Backup trước khi đưa dữ liệu thật vào:** chọn chính sách backup phù hợp tier; Cloud Backup trong tài liệu Atlas áp dụng cho M10+, Flex/Free có hướng dẫn riêng. Không mặc định cluster nào cũng có snapshot/PITR. Chốt mục tiêu RPO (mất tối đa bao nhiêu dữ liệu) và RTO (phục hồi trong bao lâu), retention và người chịu trách nhiệm. Restore thử vào cluster/database riêng, so sánh số lượng bản ghi, quan hệ và luồng đăng nhập trước khi coi backup là dùng được. Xem [Atlas backup](https://www.mongodb.com/docs/atlas/backup/cloud-backup/overview/).

## 3. Biến môi trường production

Nhập tại Variables/Environment của service, không thêm `.env` vào image, build args hoặc GitHub Actions. Các giá trị dưới đây là cấu hình đề xuất cho triển khai mới; staging dùng secret và database riêng.

| Biến | Giá trị/cách chọn |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Railway: có thể đặt rõ `3000` và target port domain `3000`. Render: đặt rõ `10000`. Backend dùng giá trị runtime và bind `0.0.0.0`. |
| `MONGO_URL` | URI Atlas đúng database; secret |
| `JWT_SECRET` | Ngẫu nhiên ít nhất 32 byte; secret ổn định qua redeploy |
| `ALLOWED_ORIGINS` | Các origin web thực, phân cách dấu phẩy, ví dụ `https://app.example.com`; không `*`, path hay dấu `/` cuối |
| `TRUST_PROXY` | Chỉ dùng IP/CIDR hoặc số hop đã xác minh; xem phần HTTPS/proxy |
| `PRIVATE_FILES_ENABLED` | `true` |
| `PUBLIC_BASE_URL` | Origin HTTPS public của backend, ví dụ `https://api-production-360b0645.up.railway.app`. Dùng để tạo URL upload chính xác khi ingress kết thúc TLS; không thêm `/api`. |
| `ACCEPT_LEGACY_TOKENS` | `false` cho triển khai mới |
| `REFRESH_ENABLED` | `true` |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | `15m` / `30d` |
| `REFRESH_GRACE_SECONDS` | `60` |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `taskflow-api` / `taskflow-client`; giữ đồng bộ giữa các release |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Bắt buộc cả ba; credentials thật của môi trường |
| `CLOUDINARY_FOLDER` | Ví dụ `taskflow_prod`; staging dùng folder khác |
| `HEALTHCHECK_TIMEOUT_MS` | `1000` (giới hạn cấu hình 1–5000 ms) |
| `SHUTDOWN_TIMEOUT_MS` | `15000`; thời gian nền tảng cho SIGTERM phải lớn hơn giá trị này |
| `LOG_LEVEL` | `info` |
| `AI_PROVIDER` | `local_only` để dùng luật nội bộ; không cần model server |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` | Cấu hình SMTP nếu cần OTP email; đủ HOST/USER/PASS, dùng cổng STARTTLS tương thích transporter hiện tại (`secure=false`, thường 587) |
| `EXPO_ACCESS_TOKEN` | Chỉ cấu hình khi bật Expo push và có token thích hợp |

Không đặt `CLIENT_URL` thay cho `ALLOWED_ORIGINS` trong production. Native app và probe không có Origin được phép; CORS không thay thế JWT. Nếu chỉ có mobile, vẫn đặt origin HTTPS hợp lệ do bạn kiểm soát, chẳng hạn origin API; không dùng `*` để vượt validator.

Không bật legacy token trừ khi thực sự chuyển hệ thống cũ và đã chốt cutoff. Gemini cần `GEMINI_API_KEY`; Ollama cần `OLLAMA_BASE_URL` có thể truy cập từ cloud, không trỏ localhost của máy Windows. Secrets này không đưa vào ứng dụng APK.

Tạo JWT secret trên máy tin cậy, sao chép vào secret manager rồi hosting (không đưa output vào log chung):

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))"
```

Kiểm tra offline nếu đã có file `.env.production` local được Git ignore, sau khi build image theo bước 3:

```powershell
docker run --rm --env-file .env.production hr-task-api:ci node scripts/check-config.js
```

Exit 0 chỉ chứng minh cấu hình hợp lệ; chưa chứng minh MongoDB, Cloudinary hay SMTP hoạt động. Không thay JWT secret ngẫu nhiên mỗi lần restart: việc đó làm token đang dùng mất hiệu lực.

## 4. Railway

1. Tạo project/environment staging, kết nối repository GitHub `yenle254/task-management-app-be`. Chọn branch `master`, source root mặc định. Railway phải build bằng Dockerfile trong root; kiểm tra build log trước khi tiếp tục.
2. Nhập đầy đủ env ở phần 3. Đặt `PORT=3000`, `NODE_ENV=production`; giữ CMD Dockerfile `node server.js`, không override bằng `npm run dev`.
3. Cấu hình outbound IP và Atlas allowlist theo phần 2. Deploy đầu có thể thất bại khi chưa đủ env/allowlist; hoàn thành cấu hình trước khi retry.
4. Settings → Deploy: Healthcheck Path `/health/ready`, timeout khởi động có thể giữ 300 giây. Đây là timeout chờ deploy, khác timeout ping MongoDB 1000 ms của app. Railway dùng healthcheck để chuyển deployment, **không tiếp tục giám sát endpoint sau khi live**; cần monitor bên ngoài. Xem [Railway healthchecks](https://docs.railway.com/deployments/healthchecks).
5. Chọn 1 replica, không sleep. Đối chiếu ngân sách SIGTERM của service với `SHUTDOWN_TIMEOUT_MS`; thực nghiệm shutdown trên staging để bảo đảm không bị SIGKILL trước khi cleanup hoàn tất.
6. Networking → Public Networking → Generate Domain, target port `3000`. Dùng URL HTTPS được cấp; nếu thêm custom domain, làm đúng bản ghi DNS hiển thị và đợi certificate sẵn sàng. Railway cấp/gia hạn SSL tự động: [Public networking](https://docs.railway.com/networking/public-networking).
7. Bật **Wait for CI** trong cài đặt autodeploy và cấp quyền GitHub App cần thiết. Workflow hiện chạy trên push, đáp ứng điều kiện trigger. Khi chưa bật được, tắt autodeploy và deploy thủ công đúng SHA có Backend CI thành công. Lần deploy đầu cũng phải kiểm tra SHA/CI bằng tay.
8. Đọc deploy/runtime log, kiểm tra health qua domain, chạy nghiệm thu phần 9 rồi mới áp dụng cấu hình tương ứng cho production.

Wait for CI của Railway xét kết quả workflow; skipped/neutral không chặn và cancelled có quy tắc riêng khi workflow khác thành công. Vì vậy yêu cầu release vẫn là **Backend CI success trên đúng SHA**, không suy ra từ việc hosting đã tự deploy. Xem [Railway GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys).

## 5. Render

1. New → Web Service → kết nối Git Provider và chọn repository backend. Chọn branch `master`, region gần Atlas, Runtime/Language **Docker**, Root Directory để trống, Dockerfile Path `./Dockerfile`, Docker Build Context `.` nếu giao diện có trường này. Render build từ Dockerfile: [Docker on Render](https://render.com/docs/docker).
2. Nhập env phần 3, đặt rõ `PORT=10000`; để Docker Command mặc định dùng CMD của image. Backend đã bind `0.0.0.0`. Xem [Render web services](https://render.com/docs/web-services).
3. Chọn instance luôn chạy, 1 instance; không gắn persistent disk cho cấu hình Cloudinary hiện tại. Lấy outbound CIDR và thêm đủ vào Atlas trước khi nghiệm thu kết nối.
4. Health Check Path `/health/ready`. Render kiểm tra cả deploy mới và instance đang chạy; DB outage kéo dài có thể dẫn đến restart. Theo dõi nguyên nhân MongoDB, không giải quyết bằng cách chuyển sang `/health/live` để che DB lỗi. Xem [Render health checks](https://render.com/docs/health-checks).
5. Auto-Deploy chọn **After CI Checks Pass**, hoặc **Off** và deploy thủ công đúng commit xanh. Không giữ mặc định On Commit nếu muốn chờ CI. Render cũng coi skipped/neutral là đạt; quy trình release phải kiểm tra Backend CI thực sự success. Giữ pre-deploy command trống: migration hiện không có trong image. Xem [Render deploys](https://render.com/docs/deploys).
6. URL `https://<service>.onrender.com` dùng HTTPS; custom domain thêm ở Settings, cập nhật DNS theo dashboard và đợi xác minh. Render quản lý chứng chỉ và chuyển HTTP sang HTTPS. Xem [Render TLS](https://render.com/docs/tls).
7. Render mặc định cho 30 giây sau SIGTERM trước SIGKILL; phù hợp ngân sách app 15 giây. Nếu tăng ngân sách app phải đối chiếu lại nền tảng. Kiểm tra runtime log khi redeploy; không chỉ dựa vào trạng thái build. Xem [graceful shutdown](https://render.com/docs/deploys#graceful-shutdown).

## 6. HTTPS, proxy và dữ liệu upload

TLS kết thúc ở ingress của nền tảng; Node bên trong vẫn nghe HTTP trên PORT. Frontend dùng `https://<api-domain>` cho cả API và Socket.IO; WebSocket upgrade ra ngoài dùng WSS. Không đưa port nội bộ 3000/10000 vào URL public.

`TRUST_PROXY=false` là điểm xuất phát an toàn nhưng sau ingress có thể khiến app thấy IP proxy, làm rate limit nhiều người dùng chung một IP. Trước nghiệm thu production, xác minh chuỗi proxy, đường truy cập trực tiếp và cách ingress ghi đè forwarded headers; cấu hình hop count cố định hoặc CIDR phù hợp. Không đoán `1` cho mọi topology, không dùng `true`. Test hai client khác IP và header X-Forwarded-For giả trên staging; đối chiếu IP trong audit ngữ cảnh request. Nếu không xác minh được topology, giữ false và ghi rõ hạn chế; chưa coi IP/rate limit production đã nghiệm thu.

Storage hiện tại:

- `/app/uploads` chỉ chứa file tạm Multer; user `node` UID 1000 đã có quyền ghi. Sau chuyển Cloudinary, file tạm được xóa. Không dùng filesystem container làm kho bền vững; redeploy không được làm mất file đã upload thành công.
- Không cần volume/disk với thiết kế này. Mount mới che quyền thư mục sẵn có có thể gây EACCES; nếu buộc phải mount, cấp quyền UID 1000 và kiểm tra upload/cleanup lại.
- Giữ `CLOUDINARY_FOLDER` và cloud name ổn định sau khi có dữ liệu: code suy ra public ID từ folder/filename. Đổi folder mà không chuyển asset sẽ làm file cũ không truy cập được.
- API private download kiểm tra quyền rồi redirect URL Cloudinary. Code upload hiện không đặt asset thành authenticated/private ở Cloudinary; URL được ký không tự chứng minh asset bị chặn truy cập công khai. Trước khi dùng tài liệu nhân sự nhạy cảm, phải nghiệm thu chính sách Cloudinary và truy cập trực tiếp; việc siết delivery cloud là thay đổi riêng nếu yêu cầu bảo mật đòi hỏi.
- Với dữ liệu upload local cũ: backup thư mục gốc, kiểm kê `scripts/audit-uploads.js` trên checkout vận hành. Script chỉ đối chiếu attachments của tasks, không phải toàn bộ message/avatar. Đối chiếu thêm mọi nguồn tham chiếu; chuyển file sang đúng cloud/folder/public ID, test quyền và download trước khi cắt máy cũ. Chưa có script tự chuyển toàn bộ asset; không xóa nguồn sau một lần copy chưa xác minh.

## 7. Migration, index và khởi tạo tài khoản

**Không chạy migration khi build image hoặc mỗi lần server khởi động.** Dockerfile chỉ copy runtime, không chứa `migrations/`, demo seed hoặc hầu hết scripts vận hành. Chạy migration từ checkout riêng đúng SHA trên máy vận hành Node 24, hoặc job vận hành riêng đã chuẩn bị source và dependencies. Không đặt đường dẫn migration vào pre-deploy của image hiện tại.

Trình tự: backup có restore thử → kiểm tra đúng DB/commit → dry-run trên staging/bản phục hồi → xem khác biệt/index → cửa sổ bảo trì nếu thay dữ liệu cũ → apply một lần → kiểm tra kết quả → chạy app/smoke → lưu biên bản. Không chạy hai operator cùng lúc. Log nội bộ dưới `report/logs/`, không commit dữ liệu bản ghi hoặc URI.

| Thành phần | Hành vi thực tế và cách xử lý |
| --- | --- |
| `001_add_performance_indexes.js` | Có `up/down/status`, mặc định `up`; dùng `MONGO_URL`, không tự đọc `.env`, có fallback local và **in nguyên URI**. Không chạy nguyên trạng với production secret. Trước khi sử dụng cần sửa logging/fallback, duyệt index và xử lý conflict; bước tài liệu này chưa sửa script. |
| Index conflict trong `001` | Bỏ qua lỗi 85/86 và so khớp index chưa đầy đủ; exit 0 không chứng minh đúng hướng sort/unique/options. `down` xóa theo tên, có thể xóa index tồn tại trước migration; không dùng như rollback deploy thông thường. |
| Mongoose/model indexes | Kết nối hiện chưa tắt `autoIndex/autoCreate`; có thể tạo index khi nạp model, kể cả khi một CLI chỉ định đọc dữ liệu. Không khẳng định startup hay CLI status là hoàn toàn read-only. Với DB lớn, cần kế hoạch index được duyệt trước rollout. |
| `002_leave_workflow.js` | Dùng riêng `LEAVE_MIGRATION_URI`, mặc định dry-run, `--apply` mới cập nhật leave cũ thiếu revision. Không load `.env`, không tính lại balance, không có down. Dừng ghi leave khi apply và xác minh số lượng/status/balance sau đó. |

Để chạy `002` mà không kích hoạt auto-index/auto-create từ model, có thể dùng wrapper sau từ **root checkout vận hành**. Cung cấp `LEAVE_MIGRATION_URI` qua secret environment trước, không đặt URI trong command history. Wrapper mặc định dry-run; phần apply phải chủ động đổi `apply: false` thành `apply: true` sau khi duyệt kết quả và backup:

```powershell
@'
const mongoose = require('mongoose');
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const { migrate } = require('./migrations/002_leave_workflow');
(async () => {
  if (!process.env.LEAVE_MIGRATION_URI) throw new Error('Missing migration URI');
  try {
    await mongoose.connect(process.env.LEAVE_MIGRATION_URI, { serverSelectionTimeoutMS: 10000 });
    const result = await migrate({ apply: false });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
})().catch(() => { console.error('Migration failed; inspect securely before retry'); process.exitCode = 1; });
'@ | node
```

Kiểm tra `$LASTEXITCODE` sau lệnh. Dry-run có thể trả ID bản ghi nên kết quả chỉ lưu ở nơi operator được phép đọc. Nếu apply lỗi giữa chừng, không tự coi là chưa thay gì: kiểm tra những bản ghi đã sửa trước khi retry. `002` lọc revision thiếu giúp giới hạn xử lý lại, nhưng vẫn phải đối chiếu dữ liệu thực.

Với database mới chưa có dữ liệu legacy, `002` thường không có bản ghi cần đổi; kiểm tra dry-run để xác nhận. Không chạy seed demo vào production. `npm run seed` hiện trỏ `seed.js` không có; `demo_project/seed-admin.js` dùng DB và mật khẩu demo cố định.

Khởi tạo HR đầu tiên: đăng ký tài khoản thật qua API (mặc định employee), operator kiểm tra đúng email/ID rồi nâng riêng tài khoản đó thành `hr_manager` qua công cụ quản trị DB trong cửa sổ bootstrap; đăng xuất/đăng nhập lại và xác minh quyền. Không sửa mật khẩu hash bằng văn bản thuần, không mở API public cho phép chọn role. Sau đó dùng giao diện quản trị để tạo office/team và phân quyền; tạo active office để scheduler/chấm công có cấu hình thực.

## 8. Giám sát và xử lý sự cố

Đề xuất khởi đầu: monitor ngoài nền tảng GET `/health/ready` mỗi 60 giây, yêu cầu **200** trực tiếp, cảnh báo sau 3 lần lỗi liên tiếp; timeout monitor lớn hơn timeout probe nội bộ. Theo dõi thêm `/health/live`, thời gian phản hồi và chứng chỉ HTTPS. Đây là cấu hình cần tạo trong công cụ monitor, chưa có hệ thống cảnh báo được cài bởi tài liệu.

| Tín hiệu | Diễn giải/hành động |
| --- | --- |
| live 200, ready 503 | Tiến trình còn sống nhưng DB chưa sẵn sàng, ping lỗi/timeout hoặc đang shutdown. Kiểm tra Atlas, network, credentials và log lifecycle. |
| Cả hai timeout/5xx từ gateway | Kiểm tra deploy crash, PORT/target port, CPU/RAM, routing, domain. |
| Ready 200 nhưng upload/mail lỗi | Readiness chỉ kiểm tra MongoDB, không kiểm tra Cloudinary/SMTP/Expo; dùng smoke nghiệp vụ và log riêng. |
| 429 cho nhiều người dùng | Kiểm tra TRUST_PROXY và IP thực trước khi tăng limit. |
| Atlas auth/selection timeout | Kiểm tra user, password encoding, DB, DNS SRV, cluster state, outbound CIDR; tham khảo [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/). |
| Upload EACCES/404 sau redeploy | Kiểm tra quyền uploads, cloud name/folder, asset cũ và việc dùng local storage. |
| Reminder trùng/mất | Kiểm tra sleep, active office/timezone, tiến trình chồng nhau khi deploy và lỗi scheduler. |

Theo dõi tỷ lệ 5xx, p95 latency, 401/429 bất thường, memory/restart, Mongo connections/storage/slow queries, Cloudinary quota, lỗi gửi mail/push và reminder. Chốt ngưỡng theo traffic staging rồi production; xác định người trực và đường báo sự cố. App có log JSON và requestId/durationMs cho request; tra log theo requestId/deployment SHA, không bật ghi request body chứa token/OTP. Định kỳ thử restore backup và kiểm tra budget/quota cloud.

## 9. Nghiệm thu staging rồi production

Thay URL minh họa bằng domain thật, chạy trên máy ngoài hosting (PowerShell):

```powershell
$apiBase = 'https://api.example.com'
curl.exe --fail-with-body --max-time 10 -i "$apiBase/health/live"
curl.exe --fail-with-body --max-time 10 -i "$apiBase/health/ready"
```

Cả hai phải trả 200, JSON và `Cache-Control: no-store`; kiểm tra riêng exit code từng lệnh. Không chỉ kiểm tra home page hoặc thông báo “Server started”.

- Đúng SHA có CI xanh, runtime production Node 24, kết nối đúng Atlas DB và đúng folder Cloudinary.
- Đăng nhập/refresh/logout bằng user thử, đối chiếu role HR/team lead/employee và quyền truy cập chéo.
- CRUD task, approve leave và chấm công theo office thật; không dùng dữ liệu demo ở production.
- Upload thành công, tải lại có quyền; request không JWT bị từ chối; file vẫn đọc được sau redeploy. Kiểm tra riêng truy cập Cloudinary trực tiếp theo yêu cầu bảo mật.
- Hai client Socket.IO nhận message và reconnect sau restart; kiểm tra từ mạng ngoài/LTE, không phụ thuộc LAN máy phát triển.
- Trên staging, mô phỏng MongoDB mất kết nối có kiểm soát: ready 503/live 200; phục hồi ready 200. Không cố ý làm gián đoạn Atlas production để kiểm thử.
- Redeploy staging: log shutdown sạch, không timeout cưỡng bức; reminder và audit không bị bỏ dở ngoài giới hạn đã chấp nhận.
- OTP email/push nếu bật phải thử thật; CI trước đó dùng Cloudinary stub nên không thay thế nghiệm thu cloud thật.
- Monitor gửi được cảnh báo thử; backup restore và rollback staging đã thực hành. Chỉ chuyển production khi các mục áp dụng đạt.

Ghi kết quả vào hồ sơ release trong `report/` nếu cần: SHA, CI URL, service/deployment ID, ngày giờ, backup ID, migration đã chạy, kết quả smoke, người thực hiện và deployment tốt để rollback. Không ghi secret hoặc dữ liệu nhân sự.

## 10. Rollback

1. Khi deploy mới gây lỗi, tạm dừng autodeploy và xác định phạm vi: code, config, DB hay storage. Ghi deployment lỗi/đúng trước đó; nếu có nguy cơ ghi hỏng dữ liệu, ngừng ghi trong cửa sổ bảo trì trước khi tiếp tục.
2. **Railway:** chọn deployment thành công trước đó trong lịch sử, menu hành động → Rollback nếu artifact còn trong thời hạn lưu. Đối chiếu lại cấu hình/variables và SHA của deployment phục hồi. Nếu không còn rollback artifact, triển khai lại commit tốt bằng quy trình release đã kiểm tra CI. Xem [Railway deployment actions](https://docs.railway.com/deployments/deployment-actions).
3. **Render:** Deploys → deployment tốt → Rollback → xác nhận. Dashboard rollback tự tắt autodeploy; API rollback không tự tắt. Artifact phải còn được lưu theo gói. Render có thể dùng lại env của deployment đích, environment groups có quy tắc riêng; kiểm tra bí mật đã rotate và URI hiện còn hợp lệ. Xem [Render rollbacks](https://render.com/docs/rollbacks).
4. Rollback app **không hoàn tác dữ liệu Atlas hoặc Cloudinary**. Với migration chỉ thêm index tương thích, thường giữ index; không chạy `001 down` theo thói quen. Với `002`, không có down: cần kế hoạch sửa dữ liệu tiến lên hoặc restore backup đã thử.
5. Nếu phải restore DB, ưu tiên phục hồi sang đích riêng, xác minh rồi mới đổi URI; xác định những write sau snapshot sẽ mất và cách đối soát. Không restore đè ngay lên DB đang nhận ghi. Cloudinary phải có phương án asset backup/version tương ứng, restore DB không khôi phục file đã xóa.
6. Chạy lại health, login/refresh, upload/download, Socket.IO và nghiệp vụ bị ảnh hưởng. Đối chiếu secret/issuer/audience, database, folder storage. Theo dõi ít nhất một chu kỳ scheduler và cửa sổ traffic đã thống nhất.
7. Sửa lỗi ở nhánh mới, CI xanh, staging đạt rồi mới bật lại autodeploy. Nếu `master` vẫn chứa lỗi thì rollback hosting chỉ là biện pháp tạm; cần revert/fix commit bằng quy trình Git bình thường trước release tiếp theo.

## 11. Bàn giao sang bước 6 (EAS APK)

Ghi lại **URL HTTPS ổn định của backend**, Socket.IO origin, trạng thái CI/health và môi trường staging/production. APK chỉ cần cấu hình URL public tương ứng; tuyệt đối không đóng gói MONGO_URL, JWT_SECRET, Cloudinary API secret hoặc SMTP credentials. Build APK và thay đổi frontend thuộc bước 6, chưa thực hiện trong tài liệu này.

## Trạng thái kiểm chứng của bước tài liệu

Đã đối chiếu tên env, đường dẫn health, Docker context, migration, upload và scheduler với source; tham khảo các nguồn chính thức được liên kết tại từng phần. Chưa truy cập tài khoản hosting/Atlas/Cloudinary, chưa thử credentials thật, chưa chạy migration hoặc deploy. Các giới hạn của migration/index và bảo mật asset nêu trên cần được xử lý/kiểm chứng theo yêu cầu production trước khi đưa dữ liệu thật vào.
