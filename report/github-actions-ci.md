# Bước 4 — GitHub Actions cho backend

Workflow: `.github/workflows/backend-ci.yml`. Build context và working directory là root repository backend (`server/`).

## Chuỗi kiểm tra bắt buộc

Job có tên cố định **Backend CI**, chạy trên `ubuntu-24.04`, giới hạn 20 phút:

1. Checkout source, không lưu Git credentials; cài Node theo `.nvmrc` (24), cache npm theo lockfile.
2. `npm ci --ignore-scripts --no-audit --no-fund`: cài dependency từ lockfile, gồm dev dependencies phục vụ Jest.
3. `npm run test:ci`: Jest chạy `--ci --runInBand --coverage`.
4. `docker build --progress=plain -t hr-task-api:ci .`: build image production từ Dockerfile bước 3.
5. `npm run test:docker -- hr-task-api:ci`: kiểm tra image và container thực.
6. Luôn thử upload coverage và log, kể cả khi bước trước thất bại; giữ artifacts 14 ngày.

Trigger: push mọi branch, pull request, merge queue (`merge_group`) và chạy thủ công. Không lọc đường dẫn để required check không bị treo vì workflow bị bỏ qua. Lần chạy mới cùng event/PR hoặc branch sẽ hủy lần cũ đang chạy. Push và PR có nhóm concurrency riêng để không hủy check của nhau.

Các action được pin vào commit SHA của release chính thức đã xác minh: checkout v7.0.1, setup-node v7.1.0 và upload-artifact v7.0.2. Khi cập nhật action cần xác minh SHA mới. Quyền workflow chỉ là `contents: read`; không cần GitHub secrets, registry credential hay dữ liệu production.

## Điều kiện thất bại

- Jest có test lỗi hoặc coverage dưới ngưỡng sẽ trả exit code khác 0.
- Giữ nguyên ngưỡng hiện tại trong `jest.config.js`: statements **70%**, branches **50%**, functions **70%**, lines **70%**. Coverage hiện đo các module được test nạp vào, chưa phải mọi file production trong repository.
- Build lỗi thì không chạy smoke. Smoke lỗi hoặc cleanup thất bại thì job thất bại.
- Các bước dùng `shell: bash`; GitHub chạy Bash với `-e -o pipefail`, nên `tee` không che exit code lỗi của npm/Docker. Không có `continue-on-error`, `|| true` hoặc `--forceExit` để làm xanh job.
- Chỉ hai bước upload artifacts có `if: always()`. Thiếu artifact khi job dừng sớm chỉ cảnh báo; không đổi kết quả lỗi của bước trước.

## Phạm vi smoke test

Script `tests/docker-smoke.cjs` tạo network, MongoDB 8 và backend riêng với tên duy nhất, dữ liệu giả và cổng API loopback ngẫu nhiên. Không cần MongoDB service riêng trong workflow.

- Node 24, UID 1000, source không ghi được, thư mục upload ghi được.
- Không đóng gói local env, Git, reports, tests hoặc các dev dependencies được kiểm tra.
- Startup production với PORT khác mặc định; readiness 200 và Docker healthcheck healthy.
- Login thật, upload yêu cầu JWT, chuyển file qua Cloudinary fixture, private download redirect, xóa file tạm cả khi thành công và khi cloud giả lập lỗi.
- Dừng MongoDB: readiness 503 nhưng liveness 200; khởi động lại: readiness phục hồi 200.
- SIGTERM: backend thoát code 0 trong thời hạn.
- Dọn container, anonymous volume và network do script tạo trong `finally`. Nếu runner bị hủy cưỡng bức, runner GitHub dùng một lần sẽ được thu hồi.

Cloudinary dùng fixture mount read-only, không upload lên dịch vụ thật; fixture không nằm trong image production. Atlas/Cloudinary thật và triển khai hosting thuộc bước sau.

## Các sửa đổi để chạy từ checkout sạch

- Thêm `socket.io-client` 4.8.1 vào devDependencies và lockfile. Test Socket.IO dùng `require('socket.io-client')`, không truy cập `../project/node_modules` của frontend.
- Trong suite socket lifecycle, mock audit write như các persistence mock khác. Refresh token không còn tạo thao tác MongoDB bị buffer rồi ghi lỗi sau khi Jest kết thúc. Test audit thực vẫn nằm trong suite riêng.
- Giữ nguyên phiên bản các dependency đã có khi bổ sung dependency test; giữ metadata đa nền tảng đã sửa ở bước Docker.

## Chạy lại tại máy

Dùng Node 24 và Docker Linux engine, tại thư mục backend:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run test:ci
docker build --progress=plain -t hr-task-api:ci .
npm run test:docker -- hr-task-api:ci
```

Chỉ chạy lệnh kế tiếp khi lệnh trước thành công. Bash trong workflow tự xử lý việc này; khi gõ từng lệnh trong PowerShell cần kiểm tra `$LASTEXITCODE`. `npm ci` cài lại node_modules từ lockfile; không yêu cầu cài dependency frontend.

Artifacts trên trang Actions của mỗi run:

- `backend-coverage-<run_id>-<attempt>`: `coverage/lcov.info` và báo cáo HTML trong `coverage/lcov-report/`.
- `backend-ci-logs-<run_id>-<attempt>`: `report/logs/ci-install.log`, `ci-jest.log`, `ci-build.log`, `ci-container.log` (những file đã được tạo).

Lỗi Jest: xem test/threshold trong ci-jest.log. Lỗi build: xem ci-build.log. Lỗi container: xem ci-container.log; script in thêm 50 dòng cuối log API khi container đã được tạo. Không upload `.env` hoặc toàn bộ repository.

## Bật chặn merge trên GitHub

Workflow thất bại làm check **Backend CI** đỏ. Muốn GitHub bắt buộc chặn merge, cần cấu hình ruleset/branch protection riêng; file workflow không tự bật quy tắc này.

1. Commit và push các file triển khai bước 1–4 cùng các test/fixture liên quan. Workflow cần Dockerfile, `.nvmrc`, runtime/health code và smoke script cùng có trong checkout.
2. Mở PR; đợi ít nhất một lần chạy để GitHub nhận check **Backend CI**.
3. Trong Settings → Rules → Rulesets (hoặc Branches → Branch protection), đặt quy tắc cho `master` — default branch quan sát tại thời điểm triển khai.
4. Bật **Require status checks to pass before merging**, chọn check **Backend CI** từ GitHub Actions; bật yêu cầu branch cập nhật nếu dùng quy trình đó. Hạn chế quyền bypass theo chính sách nhóm.
5. Thử một PR có test lỗi: check phải đỏ và merge bị chặn. Sửa lỗi: chuỗi Jest → build → container phải xanh trước khi merge. Nếu bật merge queue, workflow đã hỗ trợ `merge_group`.

Khả năng dùng ruleset/branch protection phụ thuộc quyền và gói GitHub của repository. Workflow chưa publish image hoặc deploy Railway/Render; cơ chế hosting đợi CI cần được cấu hình ở bước deploy.

## Kết quả xác minh local — 12/11/2026

- Cài sạch 508 packages và chạy Jest trong Linux Node 24.22.3, không `.env`, không node_modules Windows hoặc frontend: **54 suite / 818 test đạt**; exit code 0, không còn cảnh báo Jest không thoát.
- Coverage: statements **74.67%**, branches **65.31%**, functions **77.31%**, lines **75.18%**; tất cả vượt ngưỡng.
- actionlint **1.7.12** kiểm tra workflow và shell: exit code 0.
- Build image `hr-task-api:ci`: thành công; ID `sha256:b7deb7dcd1516f009bef9cbb5e544ce1f950ed50e516192814b1be5701e04a50`.
- Smoke script chạy bằng Node 24 trên host với Docker Linux: đạt kiểm tra non-root, health, upload, MongoDB outage/recovery và SIGTERM.
- Kiểm tra chiều lỗi: đặt riêng threshold lines 100% cho suite token để xác minh Jest trả exit 1 (27 test vẫn đạt, lines 81.08%); không sửa threshold thật. Bash với pipefail giữ exit 7 qua tee và bỏ qua lệnh sau. Smoke từ chối image base chạy root với exit 1.

Log xác minh ở `report/logs/ci-*.log`; coverage chính ở `coverage/`. Báo cáo coverage thử ngưỡng lỗi ở `coverage/negative-gate/` chỉ được tạo local, không thuộc workflow.

Chưa push/commit thay đổi, chưa chạy trên runner GitHub, chưa thay đổi branch protection. Cần lần chạy GitHub đầu tiên để xác minh trigger, cache và upload artifacts trên dịch vụ thực.

Tham chiếu: [GitHub Actions cho Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs), [Bash và pipefail trong workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell), [Required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging), [actionlint](https://github.com/rhysd/actionlint/blob/v1.7.12/docs/usage.md).
