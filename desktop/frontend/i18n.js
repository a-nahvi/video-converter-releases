"use strict";

const translations = {
  appName: ["مبدل ویدیو", "Video Converter"],
  windowControls: ["کنترل‌های پنجره", "Window controls"],
  minimizeWindow: ["کمینه کردن پنجره", "Minimize window"],
  maximizeWindow: ["بزرگ کردن پنجره", "Maximize window"],
  restoreWindow: ["بازگرداندن اندازهٔ پنجره", "Restore window size"],
  closeWindow: ["بستن پنجره", "Close window"],
  navigation: ["بخش‌های برنامه", "App navigation"],
  conversion: ["تبدیل ویدیو", "Convert videos"],
  history: ["تاریخچه", "History"],
  settings: ["تنظیمات", "Settings"],
  updates: ["به‌روزرسانی", "Updates"],
  localProcessing: ["پردازش روی دستگاه", "Processed on your device"],
  collapseSidebar: ["جمع کردن منو", "Collapse sidebar"],
  expandSidebar: ["باز کردن منو", "Expand sidebar"],
  dismissMessage: ["بستن پیام", "Dismiss message"],
  settingsDescription: ["زبان برنامه و گزینه‌های خروجی را تنظیم کنید.", "Set the app language and output options."],
  preferences: ["ترجیحات برنامه", "Preferences"],
  language: ["زبان برنامه", "App language"],
  languageHelp: ["جهت چیدمان با زبان انتخابی عوض می‌شود.", "The layout direction follows the selected language."],
  format: ["قالب فایل", "File format"],
  hlsNote: ["پخش آنلاین چندبخشی", "Segmented streaming"],
  mp4Note: ["سازگار با بیشتر دستگاه‌ها", "Works on most devices"],
  webmNote: ["مناسب انتشار در وب", "Designed for web playback"],
  format_hls: ["یک ZIP شامل فهرست پخش و قطعه‌های HLS", "A ZIP with an HLS playlist and segments"],
  format_mp4: ["فایل MP4 با ویدیوی H.264 و صدای AAC، داخل ZIP", "An MP4 with H.264 video and AAC audio in a ZIP"],
  format_webm: ["فایل WebM با ویدیوی VP9 و صدای Opus، داخل ZIP", "A WebM with VP9 video and Opus audio in a ZIP"],
  quality: ["کیفیت", "Quality"],
  quality_high: ["بالا", "High"],
  quality_balanced: ["متعادل", "Balanced"],
  quality_compact: ["کم‌حجم", "Compact"],
  maxResolution: ["حداکثر وضوح", "Maximum resolution"],
  aspectRatio: ["با حفظ نسبت تصویر", "Keeps the aspect ratio"],
  width1024: ["عرض ۱۰۲۴ پیکسل", "1,024 px wide"],
  originalResolution: ["وضوح اصلی", "Original resolution"],
  outputLocation: ["محل ذخیره", "Output location"],
  besideInputs: ["کنار فایل‌های ورودی", "Next to the input files"],
  chooseOutputFolder: ["انتخاب پوشهٔ خروجی", "Choose output folder"],
  resetOutputFolder: ["بازنشانی محل ذخیره", "Reset output location"],
  customDestination: ["همهٔ خروجی‌ها در این پوشه ذخیره می‌شوند.", "All outputs are saved in this folder."],
  defaultDestination: ["در پوشهٔ ⁦{folder}⁩ کنار هر ویدیو", "In {folder} next to each video"],
  finglish: ["نام خروجی به فینگلیش", "Use Finglish output names"],
  example: ["مثال", "Example"],
  hlsSettings: ["تنظیمات HLS", "HLS settings"],
  segmentLength: ["مدت هر بخش (ثانیه)", "Segment length (seconds)"],
  decreaseSegment: ["کاهش مدت قطعه", "Decrease segment length"],
  increaseSegment: ["افزایش مدت قطعه", "Increase segment length"],
  encrypt: ["رمزگذاری AES-128", "AES-128 encryption"],
  encryptHelp: ["کلید هم‌نام خروجی با پسوند .key کنار playlist.m3u8 در ZIP ذخیره می‌شود.", "The ZIP includes a matching .key file next to playlist.m3u8."],
  conversionDescription: ["برای هر ویدیو یک فایل ZIP ساخته می‌شود.", "Each video is saved as a separate ZIP file."],
  addFiles: ["افزودن فایل", "Add files"],
  dropVideos: ["ویدیوها را اینجا رها کنید", "Drop videos here"],
  dropNote: ["می‌توانید چند فایل را هم‌زمان اضافه کنید.", "You can add multiple files at once."],
  chooseVideos: ["انتخاب ویدیو", "Choose videos"],
  queue: ["صف تبدیل", "Conversion queue"],
  clearQueue: ["پاک‌کردن صف", "Clear queue"],
  emptyQueue: ["صف تبدیل خالی است", "The conversion queue is empty"],
  emptyQueueHelp: ["ویدیوها را اضافه کنید تا نام و حجم تقریبی خروجی را ببینید.", "Add videos to preview their output names and sizes."],
  inputFile: ["فایل ورودی", "Input file"],
  outputName: ["نام خروجی", "Output name"],
  estimateTooltip: ["بازهٔ تخمینی با تنظیمات فعلی", "Estimated range with the current settings"],
  estimatedSize: ["حجم تقریبی", "Estimated size"],
  status: ["وضعیت", "Status"],
  actions: ["عملیات", "Actions"],
  conversionHistory: ["تاریخچهٔ تبدیل", "Conversion history"],
  historyDescription: ["نتیجهٔ تبدیل‌ها و مسیر فایل‌های خروجی را اینجا پیدا کنید.", "Find previous conversions and their output files."],
  clearHistory: ["پاک کردن کل تاریخچه", "Clear all history"],
  emptyHistory: ["هنوز تبدیلی ثبت نشده است", "No conversions yet"],
  emptyHistoryHelp: ["پس از تبدیل اولین ویدیو، نتیجه در اینجا نمایش داده می‌شود.", "Your first conversion will appear here when it finishes."],
  goToConversion: ["رفتن به تبدیل ویدیو", "Go to conversion"],
  appUpdates: ["به‌روزرسانی برنامه", "App updates"],
  installedVersion: ["نسخهٔ نصب‌شده", "Installed version"],
  checkForUpdates: ["بررسی نسخهٔ جدید", "Check for updates"],
  downloadProgress: ["پیشرفت دانلود نسخهٔ جدید", "Update download progress"],
  updateSource: ["منبع به‌روزرسانی", "Update source"],
  readyForVideos: ["آماده برای افزودن ویدیو", "Ready to add videos"],
  startHint: ["برای شروع، یک ویدیو به صف اضافه کنید.", "Add a video to get started."],
  batchProgress: ["پیشرفت صف تبدیل", "Conversion queue progress"],
  openOutputFolder: ["باز کردن پوشهٔ خروجی", "Open output folder"],
  stopConversion: ["توقف تبدیل", "Stop conversion"],
  startConversion: ["شروع تبدیل", "Start conversion"],
  editOutputName: ["ویرایش نام خروجی", "Edit output name"],
  originalFile: ["فایل اصلی", "Original file"],
  newName: ["نام جدید", "New name"],
  renameHelp: ["نام را بدون پسوند وارد کنید. کادر خالی، نام خودکار را برمی‌گرداند.", "Enter a name without the extension. Leave it blank to use the automatic name."],
  saveName: ["ذخیرهٔ نام", "Save name"],
  restoreName: ["بازگشت به نام خودکار", "Use automatic name"],
  historyDeleteNote: ["فقط رکوردهای تاریخچه پاک می‌شوند. فایل‌های خروجی در پوشهٔ ذخیره باقی می‌مانند.", "This removes the history entries. Output files stay in their saved folders."],
  confirmDelete: ["تأیید حذف", "Confirm deletion"],
  cancel: ["انصراف", "Cancel"],
  errorDetails: ["جزئیات خطا", "Error details"],
  output: ["خروجی", "Output"],
  conversionProgress: ["پیشرفت تبدیل", "Conversion progress"],
  playOutput: ["پخش خروجی", "Play output"],
  showFile: ["نمایش فایل در پوشه", "Show file in folder"],
  removeQueueItem: ["حذف فایل از صف", "Remove from queue"],
  showOutputFile: ["نمایش فایل خروجی", "Show output file"],
  removeHistoryItem: ["حذف از تاریخچه", "Remove from history"],
  status_ready: ["در انتظار", "Waiting"],
  status_queued: ["در صف", "Queued"],
  status_running: ["در حال تبدیل", "Converting"],
  status_done: ["تبدیل شد", "Converted"],
  status_error: ["خطا", "Failed"],
  status_cancelled: ["متوقف شد", "Stopped"],
  gb: ["گیگابایت", "GB"],
  mb: ["مگابایت", "MB"],
  kb: ["کیلوبایت", "KB"],
  bytes: ["بایت", "B"],
  estimating: ["در حال برآورد", "Estimating"],
  unknown: ["نامشخص", "Unknown"],
  sizeRange: ["{lower} تا {upper}", "{lower}–{upper}"],
  approximateSize: ["حدود {size} {unit}", "About {size} {unit}"],
  calculating: ["در حال محاسبه…", "Calculating…"],
  noOutputName: ["نام خروجی در دسترس نیست", "Output name unavailable"],
  runningProgress: ["در حال تبدیل، {percent}", "Converting {percent}"],
  inputResolution: ["وضوح ورودی {width} در {height} پیکسل", "Input resolution {width} × {height} px"],
  itemProgress: ["پیشرفت تبدیل {name}", "Conversion progress for {name}"],
  retry: ["تلاش دوباره", "Retry"],
  stopping: ["در حال توقف…", "Stopping…"],
  stoppingQueue: ["در حال توقف صف", "Stopping the queue"],
  batchCount: ["{done} از {total} فایل تبدیل شد.", "Converted {done} of {total}."],
  inspectingFiles: ["در حال بررسی فایل‌ها", "Checking files"],
  inspectingHint: ["مشخصات ویدیوها در حال خواندن است.", "Reading video information."],
  queueStopped: ["صف متوقف شد", "Queue stopped"],
  batchFinished: ["تبدیل به پایان رسید", "Conversion finished"],
  outputsReady: ["{count} خروجی آماده", "Outputs ready: {count}"],
  errorsCount: ["{count} خطا", "Failed: {count}"],
  stoppedCount: ["{count} متوقف", "Stopped: {count}"],
  listSeparator: ["، ", ", "],
  videoReady: ["{count} ویدیو آمادهٔ تبدیل", "{count} video ready to convert"],
  videosReady: ["{count} ویدیو آمادهٔ تبدیل", "{count} videos ready to convert"],
  reviewOutputs: ["تنظیمات و نام خروجی‌ها را بررسی کنید.", "Review your settings and output names."],
  savePreferencesError: ["ذخیرهٔ تنظیمات انجام نشد.", "Could not save settings."],
  previewError: ["پیش‌نمایش نام خروجی آماده نشد.", "Could not preview the output names."],
  someFilesError: ["برخی فایل‌ها به صف اضافه نشدند.", "Some files could not be added to the queue."],
  inspectError: ["بررسی فایل‌ها انجام نشد.", "Could not check the files."],
  fileDialogError: ["پنجرهٔ انتخاب فایل باز نشد.", "Could not open the file picker."],
  folderDialogError: ["پنجرهٔ انتخاب پوشه باز نشد.", "Could not open the folder picker."],
  explorerError: ["پوشه در فایل اکسپلورر باز نشد.", "Could not open the folder in File Explorer."],
  playOutputError: ["خروجی پخش نشد.", "Could not play the output."],
  unknownHistoryTime: ["زمان ثبت نامشخص", "Unknown date"],
  historyCount: ["{count} نتیجهٔ ثبت‌شده", "Recorded results: {count}"],
  historyLoadFailed: ["تاریخچه بارگذاری نشد", "History could not be loaded"],
  historyTryAgain: ["برای بازخوانی، دوباره تاریخچه را باز کنید.", "Open History again to retry."],
  readHistoryError: ["خواندن تاریخچه انجام نشد.", "Could not read history."],
  writeHistoryError: ["ذخیرهٔ نتیجه در تاریخچه انجام نشد.", "Could not save the result in history."],
  confirmClearHistory: ["کل تاریخچه پاک شود؟", "Clear the entire history?"],
  confirmRemoveHistory: ["این تبدیل از تاریخچه حذف شود؟", "Remove this conversion from history?"],
  deleteHistoryError: ["حذف تاریخچه انجام نشد.", "Could not delete the history entry."],
  startError: ["تبدیل شروع نشد.", "Could not start conversion."],
  stopError: ["توقف تبدیل انجام نشد.", "Could not stop conversion."],
  missingFinalStatus: ["وضعیت نهایی این فایل از موتور تبدیل دریافت نشد.", "The converter did not report a final status for this file."],
  engineConnectionError: ["ارتباط با موتور تبدیل برقرار نشد. برنامه را دوباره باز کنید.", "Could not connect to the converter. Reopen the app and try again."],
  closePlayer: ["بستن پخش‌کننده", "Close player"],
  outputVideo: ["ویدیوی خروجی", "Output video"],
  playbackPosition: ["موقعیت پخش", "Playback position"],
  playVideo: ["پخش ویدیو", "Play video"],
  pauseVideo: ["مکث ویدیو", "Pause video"],
  mute: ["قطع صدا", "Mute"],
  unmute: ["وصل صدا", "Unmute"],
  volume: ["بلندی صدا", "Volume"],
  playbackSpeed: ["سرعت پخش", "Playback speed"],
  fullscreen: ["تمام‌صفحه", "Full screen"],
  exitFullscreen: ["خروج از تمام‌صفحه", "Exit full screen"],
  cannotStartPlayback: ["پخش این خروجی شروع نشد.", "Could not start playback."],
  noFullscreen: ["حالت تمام‌صفحه در دسترس نیست.", "Full screen is unavailable."],
  cannotPlay: ["پخش این خروجی ممکن نبود. فایل را از پوشهٔ خروجی باز کنید.", "Could not play this output. Open the file from its output folder."],
  cannotPlayHls: ["پخش HLS ممکن نبود. فهرست پخش و قطعه‌های خروجی را بررسی کنید.", "Could not play HLS. Check the output playlist and segments."],
  hlsNotSupported: ["پخش HLS در این نسخه از WebView2 در دسترس نیست.", "This WebView2 version does not support HLS playback."],
  update_idle: ["برنامه نسخه‌های جدید را به‌صورت خودکار بررسی می‌کند.", "The app checks for new versions automatically."],
  update_checking: ["در حال بررسی انتشارهای GitHub…", "Checking GitHub releases…"],
  update_current: ["آخرین نسخه روی دستگاه نصب است.", "The latest version is installed."],
  update_downloading: ["نسخهٔ {version} در حال دانلود است.", "Downloading version {version}…"],
  update_ready: ["نسخهٔ {version} آماده است و پس از پایان کار در صف نصب می‌شود.", "Version {version} will install when the queue is idle."],
  update_installing: ["در حال نصب نسخهٔ {version}…", "Installing version {version}…"],
  update_error: ["به‌روزرسانی انجام نشد. می‌توانید دوباره بررسی کنید.", "The update failed. Check again to retry."],
};

const i18n = (() => {
  const attributes = {
    "data-i18n-label": "aria-label",
    "data-i18n-title": "title",
    "data-i18n-note": "data-note",
  };
  const selector = ["data-i18n", ...Object.keys(attributes)].map((name) => `[${name}]`).join(", ");

  function formatters(language) {
    const locale = language === "en" ? "en-US" : "fa-IR";
    return {
      integer: new Intl.NumberFormat(locale),
      decimal: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
      percent: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
      day: new Intl.DateTimeFormat(locale, { dateStyle: "full" }),
      time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    };
  }

  let language = "fa";
  let formats = formatters(language);

  function t(key, values = {}) {
    const text = translations[key]?.[language === "en" ? 1 : 0] ?? key;
    return text.replace(/\{(\w+)\}/g, (placeholder, name) => values[name] ?? placeholder);
  }

  function apply(root) {
    for (const element of root.querySelectorAll(selector)) {
      if (element.dataset.i18n) element.textContent = t(element.dataset.i18n);
      for (const [from, to] of Object.entries(attributes)) {
        if (element.hasAttribute(from)) element.setAttribute(to, t(element.getAttribute(from)));
      }
    }
    for (const template of root.querySelectorAll("template")) apply(template.content);
  }

  function setLanguage(value) {
    const next = value === "en" ? "en" : "fa";
    if (language === next) return;
    language = next;
    formats = formatters(language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === "en" ? "ltr" : "rtl";
    apply(document);
    document.dispatchEvent(new Event("language-changed"));
  }

  return { t, apply, setLanguage, get formats() { return formats; } };
})();
