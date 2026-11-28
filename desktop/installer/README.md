# ساخت و انتشار نسخهٔ ویندوز

از ریشهٔ پروژه در PowerShell 7 اجرا کنید. شمارهٔ نسخه را در `desktop/src-tauri/tauri.conf.json` و `desktop/src-tauri/Cargo.toml` افزایش دهید و `Cargo.lock` را با Cargo هماهنگ کنید.

```powershell
.\desktop\installer\prepare-ffmpeg.ps1
.\desktop\installer\build-release.ps1 -Notes 'توضیحات این نسخه'
.\desktop\installer\publish-github-release.ps1
```

خروجی ساخت در `desktop/dist` قرار می‌گیرد. برای انتشار، اسکریپت از ورود حساب `a-nahvi` در Git Credential Manager یا `GH_TOKEN` محلیِ ناشر استفاده می‌کند. اسکریپت هویت حساب و عمومی بودن مقصد ثبت‌شده در `github-repository.txt` را بررسی می‌کند. سپس نصب‌کننده و `latest.json` را به انتشار پیش‌نویس اضافه می‌کند و پس از تطبیق SHA-256 هر دو فایل، آن را به‌عنوان آخرین نسخهٔ پایدار منتشر می‌کند. متن امضا در `latest.json` قرار می‌گیرد. [مخزن انتشار](https://github.com/a-nahvi/video-converter-releases)

برنامه مانیفست آخرین نسخه را از مسیر `releases/latest/download/latest.json` می‌خواند. نصب‌کننده را از نشانی همان نسخه دریافت می‌کند و پیش از نصب، امضای بسته و شمارهٔ نسخهٔ ثبت‌شده در امضا را بررسی می‌کند. کاربران برای این مراحل به حساب یا توکن GitHub نیاز ندارند. [مانیفست عمومی به‌روزرسانی](https://github.com/a-nahvi/video-converter-releases/releases/latest/download/latest.json)

هر انتشار را با همان کلیدی امضا کنید که کلید عمومی آن در برنامه ثبت شده است. فایل‌های امضا در `%LOCALAPPDATA%\VideoConverter.Publisher` نگه‌داری می‌شوند و ویندوز کلید خصوصی را برای حساب فعلی رمز می‌کند. اسکریپت `initialize-updater.ps1` برای راه‌اندازی اولیهٔ یک شناسهٔ انتشار تازه است. [راهنمای به‌روزرسان Tauri](https://v2.tauri.app/plugin/updater/)

نصب‌کننده برای کاربر فعلی ویندوز است. در نصب تازه، مرحلهٔ **Choose Install Location** یک پوشهٔ قابل‌نوشتن می‌خواهد. برای ارتقا، نصب‌کننده مسیر ثبت‌شدهٔ محصول را به‌کار می‌برد. به‌روزرسان داخل برنامه پس از پایان کارهای صف نصب‌کننده را اجرا می‌کند و هنگام نصب خودکار، نصب‌کننده برای بسته‌شدن فرایند برنامه صبر می‌کند. مجوز MIT قالب در `TAURI-LICENSE-MIT.txt` آمده است. [قالب رسمی NSIS در Tauri CLI 2.11.4](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)

اسکریپت آماده‌سازی، آرشیو FFmpeg 9.1 برای ویندوز ۶۴ بیتی را با SHA-256 منتشرشدهٔ سازنده بررسی می‌کند. نصب‌کننده `ffmpeg.exe`، `ffprobe.exe`، مجوز GPLv3، توضیحات ساخت و نشانی کد منبع را در پوشهٔ `ffmpeg` کنار برنامه قرار می‌دهد. [انتشار Gyan.dev](https://github.com/GyanD/codexffmpeg/releases/tag/9.1)

اولین ساخت برای دریافت ابزار NSIS به اینترنت نیاز دارد. اگر WebView2 روی ویندوز مقصد موجود نباشد، نصب‌کننده هنگام اجرا آن را دریافت می‌کند.

برای ساخت توسعه از مخزن عمومی، ابتدا `prepare-development.ps1` را اجرا کنید تا آیکن‌های سیستمی لازم برای ساخت روی همان دستگاه ایجاد شوند. ساخت توسعه به کلید خصوصی انتشار نیاز ندارد. کلید خصوصی برای ساخت انتشار رسمی در `build-release.ps1` استفاده می‌شود.
