# Bước 3 — Docker image production

Ngày kiểm chứng: 12/11/2026. Build context là root repository `server/`.

## Thiết kế image

- Base: Node 24 Debian Bookworm slim, pin OCI index digest `sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`. Image Linux/amd64 đã kiểm chứng chứa Node **24.22.3**. Cập nhật digest có chủ đích khi lấy bản vá, rồi build/smoke lại.
- `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` cài từ lockfile; cache npm được xóa trong cùng layer. Runtime dependencies hiện không cần lifecycle scripts; script Scarf telemetry được bỏ qua. Nếu thêm dependency native cần build, phải đánh giá lại tùy chọn này.
- Backend chạy JavaScript trực tiếp nên không thêm stage biên dịch giả. COPY manifests trước để dependency layer được cache độc lập với source.
- `.dockerignore` mặc định loại mọi thứ, chỉ cho dependency manifests và runtime JavaScript vào context; chặn thêm `.env*`, file ẩn, credentials, private keys, tests, uploads, logs và các dữ liệu local.
- Dockerfile COPY rõ từng cây runtime. Không chứa `.env`, `.git`, report, coverage, demo seed, EAS/app config, Swagger checkout hoặc dependency dev. `docs/swagger.json` local cũng không đóng gói; Swagger giữ fallback spec hiện có của repository.
- `USER node` (UID/GID 1000). Source và dependencies thuộc root; chỉ `/app/uploads` thuộc node và có mode 0750. Không copy dữ liệu upload cũ từ máy vào image.
- Mặc định `NODE_ENV=production`, `PORT=3000`; không có secret trong Dockerfile/ENV/build args. Cung cấp secret khi chạy container hoặc qua hosting environment settings.
- CMD exec form `node server.js` nhận SIGTERM trực tiếp. Healthcheck dùng Node sẵn có để gọi `/health/live` trên `127.0.0.1:${PORT}`, không cài curl.
- Docker healthcheck: interval 30s, timeout 3s, start period 30s, retries 3. Platform readiness tiếp tục dùng `/health/ready` khi cấu hình deploy.

## Build

Chạy trong thư mục backend:

```powershell
docker build --progress=plain -t hr-task-api:step3 .
```

Không cần npm install trên máy trước khi build; image không dùng node_modules local. Node hệ thống có thể vẫn là Node 22 development, còn runtime container luôn là Node 24 theo base image.

Lần build đầu phát hiện lockfile thiếu 20 package metadata TypeScript đa nền tảng. Đã bổ sung bằng npm của base image trên bản sao manifests sạch. Không thay phiên bản dependency có sẵn hoặc cài lại node_modules trên host; `npm ci` Linux sau đó thành công.

## Cấu hình và chạy

Tạo file local từ mẫu, rồi điền giá trị thực:

```powershell
Copy-Item .env.example .env.production
```

Trong `.env.production`:

- Đặt NODE_ENV=production, PORT=3000; JWT_SECRET ngẫu nhiên đủ mạnh; ACCEPT_LEGACY_TOKENS=false cho triển khai mới.
- MONGO_URL trỏ Atlas hoặc hostname MongoDB truy cập được từ container. `127.0.0.1` trong container là chính container đó; không phải MongoDB trên Windows. Với Docker Desktop và MongoDB host, dùng host.docker.internal nếu dịch vụ/network cho phép, hoặc dùng container MongoDB cùng Docker network.
- Điền ALLOWED_ORIGINS đúng domain, PRIVATE_FILES_ENABLED=true và đủ ba credentials Cloudinary.
- Chọn TRUST_PROXY theo topology thực tế; local publish trực tiếp giữ false. Email, Expo push và AI theo tài liệu runtime.
- Không commit file này. `.gitignore` và `.dockerignore` đều loại `.env.production`.

Kiểm tra cấu hình trước khi khởi chạy server:

```powershell
docker run --rm --env-file .env.production --env NODE_ENV=production hr-task-api:step3 node scripts/check-config.js
```

Chạy backend, publish cổng host 3001 để không đụng `npm run dev` đang dùng 3000:

```powershell
docker run -d --name hr-task-api --env-file .env.production --env NODE_ENV=production -p 127.0.0.1:3001:3000 hr-task-api:step3
docker logs --tail 50 hr-task-api
curl.exe -i http://localhost:3001/health/live
curl.exe -i http://localhost:3001/health/ready
docker inspect --format '{{.State.Health.Status}}' hr-task-api
```

Nếu thay PORT trong env, thay container port phía phải của `-p` tương ứng. EXPOSE 3000 chỉ là metadata, không khóa PORT. Hosting public domain/HTTPS và proxy được cấu hình ở bước deploy sau.

Dừng với ngân sách lớn hơn SHUTDOWN_TIMEOUT_MS mặc định 15 giây:

```powershell
docker stop --time 20 hr-task-api
```

## Upload

- Multer ghi tạm vào `/app/uploads` bằng user node, kiểm tra nội dung file, rồi chuyển lên Cloudinary và xóa file tạm.
- Production bắt buộc Cloudinary theo bước 1; không dùng filesystem container làm kho lưu bền vững. Credentials thật được inject lúc chạy, không đóng gói vào image.
- Không cần bind mount thư mục uploads của Windows cho production. Nếu chủ động mount volume, phải bảo đảm UID 1000 ghi được; mount sẽ thay quyền/nội dung thư mục đã tạo trong image.
- Không bind mount toàn repository lên `/app` khi kiểm chứng image production vì sẽ thay source, dependencies và quyền truy cập đã build.

## Smoke test tái sử dụng

```powershell
node tests/docker-smoke.cjs hr-task-api:step3
```

Script tạo network riêng, MongoDB 8 và backend với tên duy nhất; API chỉ publish loopback cổng ngẫu nhiên, MongoDB không publish cổng ra host. Toàn bộ dữ liệu/credentials là dữ liệu thử nghiệm. Script dọn đúng container, anonymous volume và network do nó tạo sau khi xong; không prune tài nguyên Docker khác.

Cloudinary được stub bằng một fixture mount read-only tại runtime, không có trong production image. Test vẫn dùng HTTP API, đăng nhập, MongoDB, Multer, kiểm tra file, filesystem permissions và cleanup thật; không upload lên Cloudinary thật hoặc sử dụng tài khoản người dùng.

## Kết quả kiểm chứng

- Build Linux/amd64 thành công: image local `hr-task-api:step3`, ID `sha256:2c4bcf9096844cc561dd0d7010fc99d1f4d703865af4dc4999f5ab616704d6e6`.
- UID 1000; ghi vào `/app` bị EACCES; ghi/đọc/xóa trong `/app/uploads` thành công.
- Không có local env, Git, report, dữ liệu upload cũ, tests hoặc dev dependencies trong image. Các cây runtime chỉ chứa JavaScript được phép.
- Startup NODE_ENV=production, PORT=3107 thành công; readiness 200 và Docker health status healthy, chứng minh healthcheck đọc PORT động.
- Đăng nhập thật với user trong DB thử nghiệm, upload có JWT trả 200; không có JWT trả 401; private download trả redirect Cloudinary sau kiểm tra quyền.
- File tạm được xóa sau cloud handoff thành công và sau lỗi Cloudinary giả lập; thư mục uploads rỗng sau test.
- Dừng MongoDB: readiness 503, liveness vẫn 200. Khởi động lại MongoDB: readiness hồi phục 200.
- Docker stop gửi SIGTERM: backend thoát code 0 trong ngân sách 20 giây.
- Các tài nguyên smoke tạm đã được dọn. Base image, Mongo image và image backend được giữ local để tái sử dụng.

Logs: `report/logs/docker-build.log`, `report/logs/docker-lockfile.log`, `report/logs/docker-smoke.log`.

Giới hạn: chưa kiểm chứng Cloudinary/Atlas với credentials production thật; kết quả upload cloud là kiểm chứng pipeline bằng stub. Chưa publish image hay deploy hosting. CI thuộc bước 4.

Tham chiếu: [Docker build best practices](https://docs.docker.com/build/building/best-practices/), [Docker build context và dockerignore](https://docs.docker.com/build/concepts/context/#dockerignore-files).
