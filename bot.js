// ============================================================
//   بوت واتساب - إدارة المجموعات + حماية + يوتيوب
//   WhatsApp Group Manager Bot - Updated Version
// ============================================================

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs   = require('fs');
const { exec } = require('child_process');
const https = require('https');

// ============================================================
// ⚙️  إعدادات البوت
// ============================================================
// ✅ Railway: اضبط المتغيرات دي في Settings → Variables
const BOT_NUMBER    = (process.env.BOT_NUMBER    || '201037443958').replace(/[^0-9]/g, '');
const BROKER_NUMBER = (process.env.BROKER_NUMBER || '201157784851').replace(/[^0-9]/g, '');

const CONFIG = {
  ADMINS: [BOT_NUMBER],
  MAX_WARNINGS: 6,
  AUDIO_DIR: process.env.AUDIO_DIR || '/tmp/temp_audio',
  YOUTUBE_COOLDOWN: 10,
};

// ============================================================
// 💾  إعدادات قابلة للحفظ
// ============================================================
const SETTINGS_FILE = process.env.DATA_DIR ? `${process.env.DATA_DIR}/settings.json` : './settings.json';
let botSettings = {
  welcomeEnabled:        true,
  prayerEnabled:         true,
  badWordsEnabled:       true,
  youtubeEnabled:        true,
  botEnabledGroups:      {},  // chatId => bool
  welcomeEnabledGroups:  {},  // chatId => bool (تحكم الأدمن في كل جروب)
};

function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      botSettings = Object.assign(botSettings, saved);
    } catch (_) {}
  }
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2));
}

// ── قائمة المطرودين (لكل جروب) ──────────────────────────────
const KICKED_FILE = process.env.DATA_DIR ? `${process.env.DATA_DIR}/kicked_members.json` : './kicked_members.json';

function loadKickedMembers() {
  try {
    if (fs.existsSync(KICKED_FILE))
      return JSON.parse(fs.readFileSync(KICKED_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function saveKickedMembers(data) {
  fs.writeFileSync(KICKED_FILE, JSON.stringify(data, null, 2));
}

function isBotEnabledInGroup(chatId) {
  if (botSettings.botEnabledGroups[chatId] === false) return false;
  return true;
}

// ============================================================
// 🕌  أوقات الصلاة (الإسكندرية - مصر)
// ============================================================
const CITY    = 'Alexandria';
const COUNTRY = 'Egypt';
let prayerTimers = [];

function fetchPrayerTimes() {
  if (!botSettings.prayerEnabled) return;
  const url = `https://api.aladhan.com/v1/timingsByCity?city=${CITY}&country=${COUNTRY}&method=5`;

  https.get(url, (res) => {
    // ✅ تحقق من كود الاستجابة
    if (res.statusCode !== 200) {
      console.error(`❌ أوقات الصلاة: كود HTTP ${res.statusCode}`);
      res.resume();
      return;
    }

    let data = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      // ✅ تحقق أن البيانات مكتملة قبل parse
      if (!data || data.trim() === '') {
        console.error('❌ أوقات الصلاة: استجابة فارغة');
        return;
      }
      try {
        const json = JSON.parse(data);
        if (!json.data || !json.data.timings) {
          console.error('❌ أوقات الصلاة: بيانات غير صحيحة');
          return;
        }
        schedulePrayerNotifications(json.data.timings);
        console.log('🕌 أوقات الصلاة جاهزة');
      } catch (e) {
        console.error('❌ خطأ أوقات الصلاة:', e.message);
      }
    });
    res.on('error', err => console.error('❌ خطأ قراءة أوقات الصلاة:', err.message));
  }).on('error', err => {
    console.error('❌ فشل جلب أوقات الصلاة:', err.message);
    // إعادة المحاولة بعد دقيقتين
    setTimeout(fetchPrayerTimes, 120000);
  });
}

const PRAYER_NAMES = {
  Fajr:    { name: 'الفجر',   msg: '🌙 صلاة الفجر أثابكم الله\nاستيقظوا للصلاة رحمكم الله 🤲' },
  Dhuhr:   { name: 'الظهر',   msg: '☀️ حان الآن موعد أذان الظهر\nحي على الصلاة 🕌' },
  Asr:     { name: 'العصر',   msg: '🌤️ حان الآن موعد أذان العصر\nحي على الصلاة 🕌' },
  Maghrib: { name: 'المغرب',  msg: '🌅 حان الآن موعد أذان المغرب\nحي على الصلاة 🕌' },
  Isha:    { name: 'العشاء',  msg: '🌙 حان الآن موعد أذان العشاء\nحي على الصلاة 🕌' },
};

function schedulePrayerNotifications(timings) {
  prayerTimers.forEach(t => clearTimeout(t));
  prayerTimers = [];

  const now = new Date();

  Object.entries(PRAYER_NAMES).forEach(([key, info]) => {
    if (!timings[key]) return;
    const parts = timings[key].split(':');
    if (parts.length < 2) return;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return;

    const prayerTime = new Date();
    prayerTime.setHours(h, m, 0, 0);

    const diff = prayerTime - now;
    if (diff > 0) {
      const timer = setTimeout(async () => {
        if (!botSettings.prayerEnabled) return;
        try {
          const chats = await client.getChats();
          for (const chat of chats) {
            if (chat.isGroup && isBotEnabledInGroup(chat.id._serialized)) {
              await chat.sendMessage(info.msg);
            }
          }
          console.log(`🕌 أذان ${info.name}`);
        } catch (e) {
          console.error('❌ خطأ إرسال الأذان:', e.message);
        }
      }, diff);
      prayerTimers.push(timer);
    }
  });

  // تجديد كل يوم الساعة 12:01 ليلاً
  const midnight = new Date();
  midnight.setHours(24, 1, 0, 0);
  setTimeout(fetchPrayerTimes, midnight - now);
}

// ============================================================
// 🔗  فحص الروابط
// ============================================================
function containsLink(text) {
  const linkRegex = /(https?:\/\/|www\.|bit\.ly|t\.me|wa\.me|youtu\.be|tinyurl|linktr\.ee|instagram\.com|facebook\.com|twitter\.com|tiktok\.com|telegram\.me)[^\s]*/i;
  return linkRegex.test(text);
}

// ============================================================
// 🔇  المكتومون وصلاحياتهم
// ============================================================
const mutedUsers  = new Set();
const memberPerms = new Map();
const stickerLocked = new Map();
const imageLocked   = new Map();
const linkLocked    = new Map();

function getPerms(chatId, userId) {
  const key = `${chatId}:${userId}`;
  if (!memberPerms.has(key)) memberPerms.set(key, { sticker: true, media: true, voice: true, text: true });
  return memberPerms.get(key);
}
function isMuted(chatId, userId) { return mutedUsers.has(`${chatId}:${userId}`); }

// ============================================================
// 🖥️  مسار Chrome
// ============================================================
function getChromePath() {
  // ✅ Railway: بيتضبط تلقائياً عن طريق PUPPETEER_EXECUTABLE_PATH في Dockerfile
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const linuxPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/chromium',
  ];
  for (const p of linuxPaths) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

// ============================================================
// 🤬  الألفاظ المحظورة
// ============================================================
const BAD_WORDS = [
  'كلب','حمار','غبي','احمق','غليظ','سفيه','وقح','خسيس','حقير','دنيء','وضيع','نذل','جبان','ساقط','فاسد',
  'كس','زب','طيز','عير','نيك','منيك','اتناك','متناك','شرموط','قحبة','عاهر','عاهرة','بغي','ساقطة','مومس',
  'كسمك','كسختك','كسمين','زبي','زبك','ازبي','مص','لحس','بظر','خرم','فتحة',
  'ابن الكلب','بنت الكلب','ابن الشرموطة','بنت الشرموطة','ابن القحبة','بنت القحبة',
  'يلعن امك','لعن امك','امك','ابوك','يلعن ابوك','اختك','يلعن دينك','يخرب بيتك',
  'عرص','خول','معرص','متخول','واطي','حيوان','بهيم','زبالة','قمامة','وسخ','وسخة','قذر','قذرة','نجس',
  'خرا','خره','خراء','براز','تفل','بصاق',
  'fuck','shit','bitch','ass','asshole','bastard','dick','cock','pussy','cunt','whore','slut',
  'motherfucker','damn','hell','piss','screw','retard','idiot',
  'kalb','klab','3ars','3rs','ars','khwal','nik','naik','5ara','khara','kos','kosmak','zob','zeby',
  'sharmoota','a7ba','kahba','k7ba',
  'ك ل ب','ك.ل.ب','ع ر ص','ع.ر.ص','خ و ل','خ.و.ل','ن ي ك','ن.ي.ك','ك س','ك.س','ز ب','ز.ب',
  '🖕',
];

function countBadWords(text) {
  let count = 0;
  const clean = text.toLowerCase().replace(/[\u064B-\u065F]/g, '').replace(/[ـ]/g, '').replace(/\s+/g, ' ');
  for (const w of BAD_WORDS) { if (clean.includes(w.toLowerCase())) count++; }
  const noSp = clean.replace(/[\s._\-]/g, '');
  for (const w of ['كلب','عرص','خول','نيك','كس','زب','شرموط','قحبة','خرا']) { if (noSp.includes(w)) count++; }
  const franco = noSp.replace(/[0-9]/g, '');
  for (const w of ['kalb','ars','khwal','nik','kos','zob','sharmoota']) { if (franco.includes(w)) count++; }
  return count;
}
function containsBadWord(text) { return countBadWords(text) > 0; }

// ============================================================
// 🛡️  حماية من السبام
// ============================================================
const spamTracker = new Map();
const SPAM_LIMIT  = 8;
const SPAM_WINDOW = 5000;

function isSpamming(userId) {
  const now = Date.now();
  const data = spamTracker.get(userId) || { count: 0, lastTime: now };
  if (now - data.lastTime > SPAM_WINDOW) { spamTracker.set(userId, { count: 1, lastTime: now }); return false; }
  data.count++;
  data.lastTime = now;
  spamTracker.set(userId, data);
  return data.count > SPAM_LIMIT;
}

// ============================================================
// 💾  التحذيرات
// ============================================================
const WARNINGS_FILE = process.env.DATA_DIR ? `${process.env.DATA_DIR}/warnings.json` : './warnings.json';
let warnings = {};

function loadWarnings() {
  if (fs.existsSync(WARNINGS_FILE)) {
    try { warnings = JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8')); } catch (_) { warnings = {}; }
  }
}
function saveWarnings() { fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2)); }
function getWarnings(userId) { return warnings[userId] || 0; }
function addWarning(userId) { warnings[userId] = (warnings[userId] || 0) + 1; saveWarnings(); return warnings[userId]; }
function resetWarnings(userId) { delete warnings[userId]; saveWarnings(); }

// ============================================================
// 🎵  تحميل يوتيوب — مع اكتشاف تلقائي لـ yt-dlp
// ============================================================
const youtubeCooldowns = new Map();

// اكتشاف مسار yt-dlp (Railway: Linux فقط)
function detectYtDlp() {
  const { execSync: _exec } = require('child_process');
  const candidates = [
    'yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.env.HOME || '/root', '.local/bin/yt-dlp'),
  ];
  for (const cmd of candidates) {
    try {
      _exec(`${cmd} --version`, { stdio: 'pipe', timeout: 8000 });
      console.log(`✅ yt-dlp found: ${cmd}`);
      return { type: 'binary', cmd };
    } catch (_) {}
  }
  // fallback: python module
  for (const py of ['python3', 'python']) {
    try {
      _exec(`${py} -m yt_dlp --version`, { stdio: 'pipe', timeout: 8000 });
      console.log(`✅ yt-dlp found via ${py} module`);
      return { type: 'module', cmd: `${py} -m yt_dlp` };
    } catch (_) {}
  }
  console.warn('⚠️  yt-dlp غير موجود! تأكد من الـ Dockerfile.');
  return null;
}

const YTDLP = detectYtDlp();

function buildYtDlpCommand(ytdlp, safeName, outputTemplate) {
  const base = ytdlp ? ytdlp.cmd : 'yt-dlp';
  return (
    `${base} -x --audio-format mp3 --audio-quality 0 ` +
    `--max-filesize 15m ` +
    `--write-thumbnail --convert-thumbnails jpg ` +
    `--no-playlist ` +
    `--socket-timeout 30 ` +
    `--extractor-args "youtube:player_client=android,mweb" ` +
    `-o "${outputTemplate}" ` +
    `"ytsearch1:${safeName}"`
  );
}

function collectResults(audioDir) {
  if (!fs.existsSync(audioDir)) return { audioPath: null, thumbPath: null };
  const allFiles = fs.readdirSync(audioDir);
  const mp3Files = allFiles.filter(f => f.endsWith('.mp3'));
  if (mp3Files.length === 0) return { audioPath: null, thumbPath: null };
  const latestAudio = mp3Files
    .map(f => ({ name: f, time: fs.statSync(path.join(audioDir, f)).mtime }))
    .sort((a, b) => b.time - a.time)[0];
  const audioPath = path.join(audioDir, latestAudio.name);
  const thumbFiles = allFiles.filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'));
  const latestThumb = thumbFiles.length > 0
    ? thumbFiles.map(f => ({ name: f, time: fs.statSync(path.join(audioDir, f)).mtime })).sort((a, b) => b.time - a.time)[0]
    : null;
  const thumbPath = latestThumb ? path.join(audioDir, latestThumb.name) : null;
  return { audioPath, thumbPath };
}

// ── مسح مجلد كامل بشكل نهائي ────────────────────────────────
function nukDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`🗑️ تم مسح المجلد: ${dirPath}`);
    }
  } catch (e) {
    // لو rmSync مش موجود (Node قديم) → امسح ملف ملف
    try {
      const files = fs.readdirSync(dirPath);
      for (const f of files) {
        try { fs.unlinkSync(path.join(dirPath, f)); } catch (_) {}
      }
      fs.rmdirSync(dirPath);
    } catch (_) {}
  }
}

// مسح كل مجلدات التحميل القديمة عند بدء التشغيل
function cleanAllAudio() {
  try {
    if (!fs.existsSync(CONFIG.AUDIO_DIR)) {
      fs.mkdirSync(CONFIG.AUDIO_DIR, { recursive: true });
      return;
    }
    const entries = fs.readdirSync(CONFIG.AUDIO_DIR);
    for (const entry of entries) {
      const fullPath = path.join(CONFIG.AUDIO_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          nukDir(fullPath);
        } else {
          fs.unlinkSync(fullPath);
          console.log(`🗑️ تم مسح: ${entry}`);
        }
      } catch (_) {}
    }
    console.log('✅ تم تنظيف مجلد الأغاني');
  } catch (e) {
    console.error('❌ فشل تنظيف مجلد الأغاني:', e.message);
  }
}

function downloadYouTubeAudio(songName) {
  return new Promise((resolve, reject) => {
    if (!YTDLP) {
      reject(new Error('yt-dlp غير مثبت.\nشغّل: bash setup_ytdlp.sh'));
      return;
    }

    // ✅ مجلد مؤقت خاص بكل تحميل → نمسحه كله بعدين
    const downloadId  = Date.now().toString();
    const downloadDir = path.join(CONFIG.AUDIO_DIR, downloadId);
    fs.mkdirSync(downloadDir, { recursive: true });

    const safeName       = songName.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim();
    const outputTemplate = path.join(downloadDir, 'audio.%(ext)s');
    const base           = YTDLP.cmd;

    const COOKIES_FILE = path.join(__dirname, 'cookies.txt');
    const cookiesFlag  = fs.existsSync(COOKIES_FILE) ? `--cookies "${COOKIES_FILE}"` : '';

    const commonFlags =
      `-x --audio-format mp3 --audio-quality 0 ` +
      `--max-filesize 15m --write-thumbnail --convert-thumbnails jpg ` +
      `--no-playlist --socket-timeout 30 --no-check-certificates ` +
      `--add-header "User-Agent:Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.6099.230 Mobile Safari/537.36" ` +
      `${cookiesFlag} `;

    // قائمة المحاولات — SoundCloud أولاً (ما محتاجش login) ثم YouTube
    const attempts = [
      {
        label: 'SoundCloud',
        cmd: `${base} ${commonFlags}-o "${outputTemplate}" "scsearch1:${safeName}"`,
      },
      {
        label: 'YouTube tv_embedded',
        cmd: `${base} ${commonFlags}--extractor-args "youtube:player_client=tv_embedded" -o "${outputTemplate}" "ytsearch1:${safeName}"`,
      },
      {
        label: 'YouTube mweb',
        cmd: `${base} ${commonFlags}--extractor-args "youtube:player_client=mweb" -o "${outputTemplate}" "ytsearch1:${safeName}"`,
      },
      {
        label: 'YouTube ios',
        cmd: `${base} ${commonFlags}--extractor-args "youtube:player_client=ios" -o "${outputTemplate}" "ytsearch1:${safeName}"`,
      },
      {
        label: 'YouTube web',
        cmd: `${base} ${commonFlags}--extractor-args "youtube:player_client=web" -o "${outputTemplate}" "ytsearch1:${safeName}"`,
      },
    ];

    console.log(`\n🎵 تحميل: ${safeName}`);

    const tryNext = (idx = 0) => {
      if (idx >= attempts.length) {
        nukDir(downloadDir);
        reject(new Error('فشل تحميل الأغنية من كل المصادر. جرب اسم أغنية تاني.'));
        return;
      }

      const { label, cmd } = attempts[idx];
      console.log(`🔄 [${idx + 1}/${attempts.length}] جاري التحميل من ${label}...`);

      exec(cmd, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        let audioPath = null;
        let thumbPath = null;
        try {
          if (fs.existsSync(downloadDir)) {
            const files = fs.readdirSync(downloadDir);
            const mp3   = files.find(f => f.endsWith('.mp3'));
            const thumb = files.find(f => f.match(/\.(jpg|jpeg|png|webp)$/i));
            if (mp3)   audioPath = path.join(downloadDir, mp3);
            if (thumb) thumbPath = path.join(downloadDir, thumb);
          }
        } catch (_) {}

        if (!audioPath) {
          console.warn(`⚠️ ${label} فشل — ${(stderr || '').slice(0, 120)}`);
          nukDir(downloadDir);
          fs.mkdirSync(downloadDir, { recursive: true });
          tryNext(idx + 1);
          return;
        }

        console.log(`✅ تم التحميل من ${label}`);
        resolve({ audioPath, thumbPath, downloadDir });
      });
    };

    tryNext();
  });
}

// ============================================================
// ============================================================
// 📋  قائمة الجروبات مع حالة الأدمن
// ============================================================
async function getGroupsList() {
  const chats = await client.getChats();
  const botJid = `${BOT_NUMBER}@c.us`;
  const groups = chats.filter(c => c.isGroup);
  return groups.map((g, i) => {
    const participant = g.participants?.find(p => p.id._serialized === botJid);
    const isAdmin = participant ? (participant.isAdmin || participant.isSuperAdmin) : false;
    return { index: i + 1, chat: g, isAdmin };
  });
}

function buildGroupsListText(groups) {
  if (groups.length === 0) return '📭 البوت مش منضم لأي جروب حالياً.';
  let msg = `📋 *قائمة الجروبات (${groups.length})*\n${'─'.repeat(30)}\n`;
  for (const g of groups) {
    const adminMark = g.isAdmin ? '✅' : '❌';
    const enabled   = isBotEnabledInGroup(g.chat.id._serialized) ? '🟢' : '🔴';
    msg += `\n*${g.index}.* ${g.chat.name} ${adminMark} ${enabled}`;
  }
  msg += `\n\n${'─'.repeat(30)}\n✅ = البوت أدمن  |  ❌ = مش أدمن\n🟢 = البوت مفعل  |  🔴 = البوت معطل`;
  return msg;
}

// ============================================================
// 🤖  حالة سير محادثة السمسار (01157784851)
// ============================================================
// phase: 'idle' | 'waiting_name' | 'waiting_group'
const brokerState = {
  phase: 'idle',
  mediaMsg: null,
  name:  '',
  count: '',
  groups: [],
};

// ============================================================
// ⚙️  حالة القائمة في الخاص مع النفس
// ============================================================
// phase: 'idle' | 'waiting_group_name:N' | 'waiting_group_photo:N'
//        'waiting_report_number' | 'waiting_report_count:NUMBER'
const selfState = {
  phase     : 'idle',
  transfer  : {           // بيانات عملية النقل
    sourceIdx : null,
    destIdx   : null,
    groups    : [],
    failedJids: [],       // أرقام فشل إضافتها (محتاجة invite link)
    inviteLink: null,     // رابط الجروب الوجهة
  },
};

// ============================================================
// 🤖  إنشاء العميل
// ============================================================
loadWarnings();
loadSettings();
cleanAllAudio(); // ✅ مسح أي ملفات صوتية متبقية من تشغيل سابق

const chromePath = getChromePath();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'group-manager-bot' }),
  puppeteer: {
    headless: true,
    ...(chromePath && { executablePath: chromePath }),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-extensions', '--disable-default-apps',
      '--disable-sync', '--disable-translate', '--no-first-run',
      '--ignore-certificate-errors', '--window-size=800,600',
    ],
    defaultViewport: { width: 800, height: 600 },
    timeout: 0,
    ignoreHTTPSErrors: true,
  },
});

// ============================================================
// 📱  كود الربط
// ============================================================
let pairingCodeRequested = false; // منع التكرار

client.on('qr', async () => {
  // لو طلبنا الكود قبل كدا، متطلبوش تاني
  if (pairingCodeRequested) return;
  pairingCodeRequested = true;

  clearInterval(loadTimer);
  console.clear();

  console.log('════════════════════════════════════════');
  console.log('   🔗 ربط واتساب عن طريق كود الربط');
  console.log(`   📱 الرقم: +${BOT_NUMBER}`);
  console.log('════════════════════════════════════════\n');

  // ✅ انتظر 5 ثواني عشان WhatsApp Web يكمل التحميل
  console.log('⏳ انتظار تحميل WhatsApp Web...');
  await new Promise(r => setTimeout(r, 5000));
  console.log('⏳ جاري طلب كود الربط...\n');

  // ✅ حاول 3 مرات لو فشل
  let code = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      code = await client.requestPairingCode(BOT_NUMBER);
      break; // نجح
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️  محاولة ${attempt}/3 فشلت: ${err.message}`);
      if (attempt < 3) {
        console.log('⏳ إعادة المحاولة بعد 5 ثواني...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  if (!code) {
    console.error('❌ فشل طلب كود الربط بعد 3 محاولات:', lastErr?.message);
    console.log('\n💡 تأكد من:');
    console.log('   • الرقم صح بالصيغة الدولية (بدون +)');
    console.log('   • واتساب مثبت على الهاتف وشغال');
    console.log('   • مش مربوط بجهاز تاني دلوقتي');
    console.log('   • احذف مجلد .wwebjs_auth وأعد التشغيل\n');
    // مش بنعمل process.exit عشان البوت ممكن يحاول تاني
    pairingCodeRequested = false;
    return;
  }

  console.log('════════════════════════════════════════');
  console.log('   ✅ كود الربط الخاص بك:');
  console.log(`\n        🔑  ${code}\n`);
  console.log('════════════════════════════════════════');
  console.log('\n📋 الخطوات:');
  console.log('   1. افتح واتساب على هاتفك');
  console.log('   2. الإعدادات ← الأجهزة المرتبطة');
  console.log('   3. ربط جهاز ← ربط بالرقم بدلاً من الـ QR');
  console.log('   4. أدخل الكود أعلاه\n');
  console.log('⏰ الكود صالح لمدة دقيقتين فقط!\n');
});

// ============================================================
// ✅  جاهز
// ============================================================
client.on('ready', () => {
  clearInterval(loadTimer);
  console.clear();
  console.log('════════════════════════════════════════');
  console.log('   ✅ البوت يعمل الآن!');
  console.log('════════════════════════════════════════');
  console.log(`   🛡️  حماية المجموعات: ${botSettings.badWordsEnabled ? 'مفعّلة' : 'معطلة'}`);
  console.log(`   🎵  يوتيوب: ${botSettings.youtubeEnabled ? 'مفعّل' : 'معطل'}`);
  console.log(`   👋  الترحيب: ${botSettings.welcomeEnabled ? 'مفعّل' : 'معطل'}`);
  console.log(`   🕌  أوقات الصلاة: ${botSettings.prayerEnabled ? 'مفعّلة' : 'معطلة'}`);
  console.log('════════════════════════════════════════');
  setTimeout(fetchPrayerTimes, 2000);
});

// ============================================================
// 👥  رسالة ترحيب — صورة + نص مع fallback لنص فقط
// ============================================================
client.on('group_join', async (notification) => {
  if (!botSettings.welcomeEnabled) return;
  try {
    const chat = await notification.getChat();
    if (!isBotEnabledInGroup(chat.id._serialized)) return;
    if (botSettings.welcomeEnabledGroups[chat.id._serialized] === false) return;

    // جلب معلومات العضو الجديد
    let memberName = null;
    let memberId   = null;
    try {
      const targetId = (notification.recipientIds && notification.recipientIds.length > 0)
        ? notification.recipientIds[0]
        : null;
      if (targetId) {
        memberId = targetId;
        const contact = await client.getContactById(targetId);
        memberName = contact.pushname || contact.verifiedName || contact.name || null;
      } else {
        const contact = await notification.getContact();
        memberId   = contact.id._serialized;
        memberName = contact.pushname || contact.verifiedName || contact.name || null;
      }
    } catch (_) {}

    if (!memberName || memberName.trim() === '') memberName = 'عضو جديد';

    const welcomeMsg =
      `🌟 أهلاً وسهلاً يا *${memberName}* في جروب *${chat.name}* 🎉\n` +
      `يسعدنا انضمامك معنا!\n` +
      `اكتب *!مساعدة* لمعرفة أوامر الجروب 🤖`;

    // ✅ حاول ترسل صورة البروفايل — لو مفيش ابعت نص بس
    let sentWithPic = false;
    if (memberId) {
      try {
        const picUrl = await client.getProfilePicUrl(memberId);
        if (picUrl) {
          const media = await MessageMedia.fromUrl(picUrl, { unsafeMime: true });
          await chat.sendMessage(media, { caption: welcomeMsg });
          sentWithPic = true;
          console.log(`✅ ترحيب مع صورة: ${memberName}`);
        }
      } catch (_) {}
    }
    if (!sentWithPic) {
      await chat.sendMessage(welcomeMsg);
      console.log(`✅ ترحيب نص فقط: ${memberName}`);
    }
  } catch (err) {
    console.error('❌ خطأ في الترحيب:', err.message);
  }
});

// ============================================================
// 📨  معالجة الرسائل — موحّدة
// ============================================================
client.on('message_create', async (msg) => {
  try {
    if (msg.isStatus) return;

    const chat = await msg.getChat();

    // ─── خاص ───
    if (!chat.isGroup) {
      // ✅ تجاهل رسائل البوت في الخاص مع نفسه عشان ما يردش عليها
      if (selfChatBotMsgIds.has(msg.id._serialized)) {
        selfChatBotMsgIds.delete(msg.id._serialized);
        return;
      }
      await handlePrivateMessage(msg, chat);
      return;
    }

    // ─── جروب ───
    await handleGroupMessage(msg, chat);

  } catch (err) {
    console.error('❌ خطأ في معالجة الرسالة:', err.message);
  }
});


// رد واحد فقط لكل شخص بعت خاص
const autoRepliedUsers = new Set();

// ✅ تتبع رسائل البوت في الخاص عشان ميشتغلش عليها
const selfChatBotMsgIds = new Set();

async function selfReply(msg, text) {
  try {
    const sent = await msg.reply(text);
    if (sent?.id?._serialized) selfChatBotMsgIds.add(sent.id._serialized);
    return sent;
  } catch (e) { return null; }
}

async function selfSend(chat, text) {
  try {
    const sent = await chat.sendMessage(text);
    if (sent?.id?._serialized) selfChatBotMsgIds.add(sent.id._serialized);
    return sent;
  } catch (e) { return null; }
}


// ============================================================
// 🔍  بحث ذكي بدون API key — DuckDuckGo + Wikipedia
// ============================================================
function searchWeb(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const options = {
      hostname: 'api.duckduckgo.com',
      path: `/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    };

    const req = https.get(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let answer = '';

          // إجابة مباشرة
          if (json.Answer) answer = json.Answer;
          // ملخص الموضوع
          else if (json.AbstractText) answer = json.AbstractText;
          // أول نتيجة ذات صلة
          else if (json.RelatedTopics && json.RelatedTopics.length > 0) {
            const topics = json.RelatedTopics.filter(t => t.Text).slice(0, 3);
            answer = topics.map(t => `• ${t.Text}`).join('\n');
          }

          if (answer && answer.length > 20) {
            resolve({ source: 'DuckDuckGo', text: answer });
          } else {
            // جرب Wikipedia
            searchWikipedia(query).then(resolve).catch(() => resolve(null));
          }
        } catch (_) {
          searchWikipedia(query).then(resolve).catch(() => resolve(null));
        }
      });
      res.on('error', () => searchWikipedia(query).then(resolve).catch(() => resolve(null)));
    });
    req.on('error', () => searchWikipedia(query).then(resolve).catch(() => resolve(null)));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

function searchWikipedia(query) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(query);
    // جرب عربي أولاً ثم إنجليزي
    const langs = ['ar', 'en'];
    let tried = 0;

    function tryLang() {
      if (tried >= langs.length) { reject(new Error('no result')); return; }
      const lang = langs[tried++];
      const options = {
        hostname: `${lang}.wikipedia.org`,
        path: `/api/rest_v1/page/summary/${encoded}`,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      };
      const req = https.get(options, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.extract && json.extract.length > 30) {
              // أول 800 حرف بس
              const text = json.extract.slice(0, 800);
              resolve({ source: `Wikipedia (${lang})`, text, url: json.content_urls?.desktop?.page || '' });
            } else {
              tryLang();
            }
          } catch (_) { tryLang(); }
        });
        res.on('error', () => tryLang());
      });
      req.on('error', () => tryLang());
      req.setTimeout(8000, () => { req.destroy(); tryLang(); });
    }
    tryLang();
  });
}

// ============================================================
// 💬  معالجة الرسائل الخاصة
// ============================================================
async function handlePrivateMessage(msg, chat) {
  const sender   = await msg.getContact();
  const senderId = sender.id.user;
  const text     = msg.body?.trim() || '';

  // ────────────────────────────────────────────
  // 🤖  خاص مع النفس (إعدادات البوت)
  // ────────────────────────────────────────────
  const isSelfChat = msg.fromMe && (
    chat.id._serialized === `${BOT_NUMBER}@c.us` ||
    senderId === BOT_NUMBER ||
    chat.id.user === BOT_NUMBER
  );
  if (isSelfChat) {
    await handleSelfChat(msg, chat, text);
    return;
  }

  // ────────────────────────────────────────────
  // 🖼️  سمسار (01157784851) يبعت صورة أو اسكرين
  // ────────────────────────────────────────────
  if (senderId === BROKER_NUMBER) {
    await handleBrokerFlow(msg, chat, text, sender);
    return;
  }

  // ────────────────────────────────────────────
  // 🚫  رد واحد فقط لكل شخص — ومنبعتش رسائل من عندنا
  // ────────────────────────────────────────────
  if (!msg.fromMe && !autoRepliedUsers.has(senderId)) {
    autoRepliedUsers.add(senderId);
    await msg.reply(
      `عذرا، انا روبوت مساعد، رقم مع الليدر او صاحب الجروب او البوت هو 01157784851`
    );
  }
}

// ============================================================
// ⚙️  إعدادات البوت (خاص مع النفس)
// ============================================================
async function handleSelfChat(msg, chat, text) {

  // ════════════════════════════════════════════════════
  // 🔀  نقل الأعضاء — مراحل الـ flow
  // ════════════════════════════════════════════════════

  // مرحلة: انتظار اختيار جروب المنقول منه
  if (selfState.phase === 'transfer_pick_source') {
    const choice = parseInt(text, 10);
    const adminGroups = selfState.transfer.groups.filter(g => g.isAdmin);
    if (isNaN(choice) || !adminGroups.find(g => g.index === choice)) {
      await selfReply(msg, '❌ اختار رقم من القائمة.');
      return;
    }
    selfState.transfer.sourceIdx = choice;
    selfState.phase = 'transfer_pick_dest';

    let listMsg =
      `✅ *جروب المنقول منه:* ${adminGroups.find(g=>g.index===choice).chat.name}

` +
      `📋 *اختار جروب الوجهة (المنقول إليه):*
${'─'.repeat(28)}
`;
    for (const g of adminGroups) {
      if (g.index !== choice)
        listMsg += `
*${g.index}.* ${g.chat.name}`;
    }
    listMsg += `

${'─'.repeat(28)}
اكتب رقم الجروب:`;
    await selfReply(msg, listMsg);
    return;
  }

  // مرحلة: انتظار اختيار جروب الوجهة
  if (selfState.phase === 'transfer_pick_dest') {
    const choice = parseInt(text, 10);
    const adminGroups = selfState.transfer.groups.filter(g => g.isAdmin);
    const srcIdx = selfState.transfer.sourceIdx;
    if (isNaN(choice) || !adminGroups.find(g => g.index === choice) || choice === srcIdx) {
      await selfReply(msg, '❌ اختار جروب مختلف عن جروب المصدر.');
      return;
    }
    selfState.transfer.destIdx = choice;
    selfState.phase = 'transfer_pick_mode';

    const srcName  = adminGroups.find(g=>g.index===srcIdx).chat.name;
    const destName = adminGroups.find(g=>g.index===choice).chat.name;

    await selfReply(msg,
      `✅ *تأكيد النقل*
${'═'.repeat(28)}

` +
      `📤 *المنقول منه:* ${srcName}
` +
      `📥 *المنقول إليه:* ${destName}

` +
      `${'─'.repeat(28)}
` +
      `اختار نوع النقل:

` +
      `*1️⃣*  نقل مع طرد الأعضاء من الجروب القديم
` +
      `*2️⃣*  نقل بدون طرد (نسخ فقط)`
    );
    return;
  }

  // مرحلة: انتظار نوع النقل (1 أو 2) والتنفيذ
  if (selfState.phase === 'transfer_pick_mode') {
    const mode = parseInt(text, 10);
    if (mode !== 1 && mode !== 2) {
      await selfReply(msg, '❌ اكتب *1* للنقل مع الطرد أو *2* للنسخ فقط.');
      return;
    }
    selfState.phase = 'idle';

    const groups   = selfState.transfer.groups;
    const srcGroup = groups.find(g => g.index === selfState.transfer.sourceIdx);
    const dstGroup = groups.find(g => g.index === selfState.transfer.destIdx);

    if (!srcGroup || !dstGroup) {
      await selfReply(msg, '❌ فشل في جلب بيانات الجروبات. ابدأ من الأول.');
      selfState.transfer = { sourceIdx:null, destIdx:null, groups:[], failedJids:[], inviteLink:null };
      return;
    }

    const botJid   = `${BOT_NUMBER}@c.us`;
    const srcParts = srcGroup.chat.participants || [];
    const toMove   = srcParts.filter(p =>
      p.id._serialized !== botJid && !p.isAdmin && !p.isSuperAdmin
    );

    if (toMove.length === 0) {
      await selfReply(msg, 'ℹ️ مفيش أعضاء يمكن نقلهم (كلهم أدمن أو البوت نفسه).');
      selfState.transfer = { sourceIdx:null, destIdx:null, groups:[], failedJids:[], inviteLink:null };
      return;
    }

    const progressMsg = await selfReply(msg,
      `🔀 *جاري نقل الأعضاء...*

` +
      `📤 من: *${srcGroup.chat.name}*
` +
      `📥 إلى: *${dstGroup.chat.name}*
` +
      `👥 العدد: *${toMove.length}*
` +
      `${'─'.repeat(28)}
` +
      `⏳ 0 / ${toMove.length}`
    );

    let added = 0, kicked = 0, failed = 0;
    const failedJids = [];

    for (const member of toMove) {
      // إضافة للجروب الجديد
      let addOk = false;
      try {
        const result = await dstGroup.chat.addParticipants([member.id._serialized]);
        // whatsapp-web.js بيرجع object — لو code != 200 يعني فشل
        const code = result?.[member.id._serialized]?.code ?? 200;
        if (code === 200 || code === 208) {
          addOk = true;
          added++;
        } else {
          failedJids.push(member.id._serialized);
          failed++;
        }
      } catch (_) {
        failedJids.push(member.id._serialized);
        failed++;
      }

      // طرد من الجروب القديم لو mode = 1
      if (mode === 1 && addOk) {
        try {
          await srcGroup.chat.removeParticipants([member.id._serialized]);
          kicked++;
        } catch (_) {}
      }

      await new Promise(r => setTimeout(r, 1000));

      // تحديث progress كل 5
      if ((added + failed) % 5 === 0) {
        try {
          await progressMsg.edit(
            `🔀 *جاري نقل الأعضاء...*

` +
            `📤 من: *${srcGroup.chat.name}*
` +
            `📥 إلى: *${dstGroup.chat.name}*
` +
            `${'─'.repeat(28)}
` +
            `✅ تمت إضافتهم: *${added}*
` +
            `${mode===1 ? `👢 تم طردهم: *${kicked}*
` : ''}` +
            `❌ فشل: *${failed}*
` +
            `⏳ ${added+failed} / ${toMove.length}`
          );
        } catch (_) {}
      }
    }

    // حفظ الفاشلين
    selfState.transfer.failedJids = failedJids;

    // جلب invite link للجروب الوجهة
    let inviteLink = null;
    try {
      inviteLink = await dstGroup.chat.getInviteCode();
      inviteLink = `https://chat.whatsapp.com/${inviteLink}`;
      selfState.transfer.inviteLink = inviteLink;
    } catch (_) {}

    // رسالة النهاية
    const hasFailures = failedJids.length > 0;
    let finalText =
      `✅ *اكتمل النقل!*
${'═'.repeat(28)}

` +
      `📤 من: *${srcGroup.chat.name}*
` +
      `📥 إلى: *${dstGroup.chat.name}*
` +
      `${'─'.repeat(28)}
` +
      `✅ تمت إضافتهم: *${added}*
` +
      `${mode===1 ? `👢 تم طردهم: *${kicked}*
` : ''}` +
      `❌ فشل (محتاج invite): *${failed}*
`;

    if (hasFailures && inviteLink) {
      const nums = failedJids.map(j => j.replace('@c.us', '')).join('\n');
      finalText +=
        `
${'─'.repeat(28)}
` +
        `⚠️ *الأرقام دي مش قادر يضيفها مباشرة:*
${nums}

` +
        `${'─'.repeat(28)}
` +
        `🔗 *رابط الجروب:* ${inviteLink}

` +
        `اختار:
` +
        `*1️⃣*  إرسال رابط الدعوة لكلهم
` +
        `*2️⃣*  إرسال رابط الدعوة لرقم معين
` +
        `*3️⃣*  الرجوع للقائمة الرئيسية`;
      selfState.phase = 'transfer_invite_menu';
    } else {
      selfState.transfer = { sourceIdx:null, destIdx:null, groups:[], failedJids:[], inviteLink:null };
    }

    try { await progressMsg.edit(finalText); } catch (_) { await selfReply(msg, finalText); }
    console.log(`🔀 [transfer] added=${added} kicked=${kicked} failed=${failed}`);
    return;
  }

  // مرحلة: قائمة خيارات الـ invite link للفاشلين
  if (selfState.phase === 'transfer_invite_menu') {
    const choice = parseInt(text, 10);

    if (choice === 3) {
      selfState.phase = 'idle';
      selfState.transfer = { sourceIdx:null, destIdx:null, groups:[], failedJids:[], inviteLink:null };
      const menu =
        `⚙️ *إعدادات البوت*
${'═'.repeat(30)}

` +
        `1️⃣  الترحيب: ${botSettings.welcomeEnabled ? '✅ مفعّل' : '❌ معطّل'}
` +
        `    → اكتب: *تفعيل الترحيب* / *تعطيل الترحيب*

` +
        `2️⃣  أوقات الصلاة: ${botSettings.prayerEnabled ? '✅ مفعّلة' : '❌ معطّلة'}
` +
        `    → اكتب: *تفعيل الصلاة* / *تعطيل الصلاة*

` +
        `3️⃣  فلتر الشتائم: ${botSettings.badWordsEnabled ? '✅ مفعّل' : '❌ معطّل'}
` +
        `    → اكتب: *تفعيل الحماية* / *تعطيل الحماية*

` +
        `4️⃣  يوتيوب: ${botSettings.youtubeEnabled ? '✅ مفعّل' : '❌ معطّل'}
` +
        `    → اكتب: *تفعيل اليوتيوب* / *تعطيل اليوتيوب*

` +
        `${'─'.repeat(30)}
` +
        `📋 *أوامر إدارة الجروبات:*
` +
        `• *قائمة الجروبات* — عرض كل الجروبات
` +
        `• *نقل الأعضاء* — نقل أعضاء بين الجروبات
` +
        `• *تفعيل البوت [رقم]* — تفعيل في جروب
` +
        `• *تعطيل البوت [رقم]* — تعطيل في جروب
` +
        `• *تغيير اسم [رقم]* — تغيير اسم جروب
` +
        `• *تغيير صورة [رقم]* — تغيير صورة جروب

` +
        `🚨 *الإبلاغ عن النصابين:*
` +
        `• *ابلاغ* — الإبلاغ عن رقم نصاب

` +
        `📖 *اوامر البوت* — لعرض كل الأوامر`;
      await selfReply(msg, menu);
      return;
    }

    if (choice === 1) {
      // إرسال رابط الدعوة للكل
      const link      = selfState.transfer.inviteLink;
      const failedNums = selfState.transfer.failedJids;
      let sent = 0, failed = 0;
      const progressMsg = await selfReply(msg, `📨 جاري إرسال رابط الدعوة لـ ${failedNums.length} شخص...`);
      for (const jid of failedNums) {
        try {
          await client.sendMessage(jid,
            `👋 السلام عليكم!

تم دعوتك للانضمام للجروب عبر هذا الرابط:

${link}`
          );
          sent++;
          await new Promise(r => setTimeout(r, 1000));
        } catch (_) { failed++; }
      }
      selfState.phase = 'idle';
      selfState.transfer = { sourceIdx:null, destIdx:null, groups:[], failedJids:[], inviteLink:null };
      try {
        await progressMsg.edit(
          `✅ *تم إرسال رابط الدعوة*

` +
          `📨 أُرسل لـ: *${sent}* شخص
` +
          `❌ فشل: *${failed}*`
        );
      } catch (_) {}
      return;
    }

    if (choice === 2) {
      selfState.phase = 'transfer_invite_single';
      const nums = selfState.transfer.failedJids.map((j,i) => `*${i+1}.* ${j.replace('@c.us','')}`).join('\n');
      await selfReply(msg,
        `📋 *الأرقام الفاشلة:*
${'─'.repeat(25)}
${nums}
${'─'.repeat(25)}

اكتب رقم الشخص (الرقم الكامل مثل 201XXXXXXXXX):`
      );
      return;
    }

    await selfReply(msg, '❌ اكتب 1 أو 2 أو 3 فقط.');
    return;
  }

  // مرحلة: إرسال invite لرقم واحد
  if (selfState.phase === 'transfer_invite_single') {
    const rawNum = text.replace(/[^0-9]/g, '');
    let number = rawNum;
    if (number.startsWith('01') && number.length === 11) number = '2' + number;
    const jid  = `${number}@c.us`;
    const link = selfState.transfer.inviteLink;
    try {
      await client.sendMessage(jid,
        `👋 السلام عليكم!

تم دعوتك للانضمام للجروب عبر هذا الرابط:

${link}`
      );
      await selfReply(msg, `✅ تم إرسال رابط الدعوة لـ +${number}`);
    } catch (_) {
      await selfReply(msg, `❌ فشل الإرسال لـ +${number}`);
    }
    selfState.phase = 'transfer_invite_menu';
    const failedNums = selfState.transfer.failedJids;
    const nums = failedNums.map(j => j.replace('@c.us','')).join('\n');
    await selfReply(msg,
      `${'─'.repeat(28)}
` +
      `⚠️ *الأرقام اللي لسه محتاجة invite:*
${nums}

` +
      `${'─'.repeat(28)}
` +
      `🔗 ${link}

` +
      `*1️⃣*  إرسال رابط الدعوة لكلهم
` +
      `*2️⃣*  إرسال رابط الدعوة لرقم معين
` +
      `*3️⃣*  الرجوع للقائمة الرئيسية`
    );
    return;
  }

  // ✅ لو في وسط flow الإبلاغ — اتعامل معاه فوراً ومتروحش للأوامر التانية
  if (selfState.phase === 'waiting_report_number') {
    if (!text || text.replace(/[^0-9]/g, '').length < 7) {
      await selfReply(msg, '❌ اكتب رقم الواتساب المراد الإبلاغ عنه.\nمثال: 201XXXXXXXXX');
      return;
    }
    const rawNum = text.replace(/[^0-9]/g, '');
    let number = rawNum;
    if (number.startsWith('01') && number.length === 11) number = '2' + number;
    else if (number.startsWith('0') && number.length <= 10) number = '20' + number.slice(1);
    selfState.phase = `waiting_report_count:${number}`;
    await selfReply(msg, 
      `📋 الرقم: *+${number}*\n\n` +
      `❓ كم عدد البلاغات؟\nاكتب رقم من 1 لـ 20`
    );
    return;
  }

  if (selfState.phase.startsWith('waiting_report_count:')) {
    const targetNumber = selfState.phase.split(':')[1];
    const count = parseInt(text, 10);
    if (isNaN(count) || count < 1 || count > 20) {
      await selfReply(msg, '❌ اكتب رقم صحيح من 1 لـ 20 بس.');
      return;
    }
    selfState.phase = 'idle';

    const targetJid = `${targetNumber}@c.us`;

    const buildText = (done, total, finished = false) => {
      const lines = [];
      for (let j = 0; j < total; j++) {
        if (j < done)                  lines.push(`✅ بلاغ ${j + 1} نجح`);
        else if (j === done && !finished) lines.push(`⏳ بلاغ ${j + 1} جاري...`);
        else                           lines.push(`🔲 بلاغ ${j + 1}`);
      }
      const header = finished
        ? `🚨 *تقرير الإبلاغ عن +${targetNumber}*`
        : `🚨 *جاري الإبلاغ عن +${targetNumber}*`;
      const footer = finished
        ? `\n${'─'.repeat(25)}\n✅ *تم اكتمال الإبلاغ* ♡\n📌 البلاغات المُنفَّذة: ${done}/${total}`
        : `\n${'─'.repeat(25)}\n📊 ${done}/${total} تم`;
      return `${header}\n${'─'.repeat(25)}\n\n${lines.join('\n')}${footer}`;
    };

    // رسالة واحدة فقط — هيتم تعديلها كل بلاغ
    const progressMsg = await selfReply(msg, buildText(0, count));

    for (let i = 0; i < count; i++) {
      // ── الإبلاغ الفعلي عبر WhatsApp Web internal API ──
      try {
        await client.pupPage.evaluate(async (jid) => {
          try {
            const wid = window.Store.WidFactory.createWid(jid);
            // محاولة 1: Spam store
            try {
              await window.Store.Spam.sendSpamReport(wid, 'status', true);
              return;
            } catch (_) {}
            // محاولة 2: عبر chat object
            const chatObj = window.Store.Chat.get(wid)
              || await window.Store.Chat.find(wid);
            if (chatObj) {
              await window.Store.Spam.sendSpamReport(chatObj, 'status', true);
            }
          } catch (_) {}
        }, targetJid);
      } catch (_) {}

      // تعديل الرسالة — بلاغ اتنجح
      try {
        await progressMsg.edit(buildText(i + 1, count, i === count - 1));
      } catch (_) {}

      // تأخير بين البلاغات (إلا الأخير)
      if (i < count - 1) await new Promise(r => setTimeout(r, 1500));

      console.log(`📢 بلاغ ${i + 1}/${count} — +${targetNumber}`);
    }
    return;
  }

  // ── انتظار اسم جروب ──
  if (selfState.phase.startsWith('waiting_group_name:')) {
    const idx = parseInt(selfState.phase.split(':')[1], 10);
    selfState.phase = 'idle';
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await selfReply(msg, '❌ رقم الجروب مش صح.'); return; }
      await target.chat.setSubject(text);
      await selfReply(msg, `✅ تم تغيير اسم *${target.chat.name}* إلى *${text}*`);
    } catch (err) {
      await selfReply(msg, '❌ فشل تغيير الاسم: ' + err.message);
    }
    return;
  }

  // ── انتظار صورة جروب ──
  if (selfState.phase.startsWith('waiting_group_photo:')) {
    const idx = parseInt(selfState.phase.split(':')[1], 10);
    if (!msg.hasMedia) { await selfReply(msg, '❌ ابعت صورة مش نص.'); return; }
    selfState.phase = 'idle';
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await selfReply(msg, '❌ رقم الجروب مش صح.'); return; }
      const media = await msg.downloadMedia();
      await target.chat.setPicture(media);
      await selfReply(msg, `✅ تم تغيير صورة جروب *${target.chat.name}*`);
    } catch (err) {
      await selfReply(msg, '❌ فشل تغيير الصورة: ' + err.message);
    }
    return;
  }

  // ══════════════════════════════════════════
  // الأوامر المباشرة
  // ══════════════════════════════════════════

  if (text === 'ابلاغ' || text === 'إبلاغ' || text === 'بلاغ') {
    selfState.phase = 'waiting_report_number';
    await selfReply(msg, 
      `🚨 *ميزة الإبلاغ عن النصابين*\n` +
      `${'─'.repeat(25)}\n\n` +
      `❓ اكتب رقم الشخص اللي عايز تبلغ عنه:\n` +
      `(مثال: 201XXXXXXXXX أو 01XXXXXXXXX)`
    );
    return;
  }

  if (text === 'اعدادات البوت' || text === 'إعدادات البوت') {
    const menu =
      `⚙️ *إعدادات البوت*\n${'═'.repeat(30)}\n\n` +
      `1️⃣  الترحيب: ${botSettings.welcomeEnabled ? '✅ مفعّل' : '❌ معطّل'}\n` +
      `    → اكتب: *تفعيل الترحيب* / *تعطيل الترحيب*\n\n` +
      `2️⃣  أوقات الصلاة: ${botSettings.prayerEnabled ? '✅ مفعّلة' : '❌ معطّلة'}\n` +
      `    → اكتب: *تفعيل الصلاة* / *تعطيل الصلاة*\n\n` +
      `3️⃣  فلتر الشتائم: ${botSettings.badWordsEnabled ? '✅ مفعّل' : '❌ معطّل'}\n` +
      `    → اكتب: *تفعيل الحماية* / *تعطيل الحماية*\n\n` +
      `4️⃣  يوتيوب: ${botSettings.youtubeEnabled ? '✅ مفعّل' : '❌ معطّل'}\n` +
      `    → اكتب: *تفعيل اليوتيوب* / *تعطيل اليوتيوب*\n\n` +
      `${'─'.repeat(30)}\n` +
      `📋 *أوامر إدارة الجروبات:*\n` +
      `• *قائمة الجروبات* — عرض كل الجروبات\n` +
      `• *نقل الأعضاء* — نقل أعضاء بين الجروبات\n` +
      `• *تفعيل البوت [رقم]* — تفعيل في جروب\n` +
      `• *تعطيل البوت [رقم]* — تعطيل في جروب\n` +
      `• *تغيير اسم [رقم]* — تغيير اسم جروب\n` +
      `• *تغيير صورة [رقم]* — تغيير صورة جروب\n\n` +
      `🚨 *الإبلاغ عن النصابين:*\n` +
      `• *ابلاغ* — الإبلاغ عن رقم نصاب\n\n` +
      `📖 *اوامر البوت* — لعرض كل الأوامر`;
    await selfReply(msg, menu);
    return;
  }

  if (text === 'اوامر البوت' || text === 'أوامر البوت') {
    const cmds =
      `📖 *قائمة أوامر البوت*\n${'═'.repeat(30)}\n\n` +
      `*🎵 للجميع:*\n` +
      `يوت [اسم الأغنية] — تحميل أغنية\n` +
      `*👮 للمشرفين (في الجروب):*\n` +
      `قفل/فتح الملصقات\n` +
      `قفل/فتح الصور\n` +
      `قفل/فتح الروابط\n` +
      `اقفل المكالمة\n` +
      `كتم / رفع الكتم — رد على رسالة\n` +
      `مسح / احذف — رد على رسالة\n` +
      `حظر / بان — رد على رسالة\n` +
      `حظر [رقم] — حظر برقم\n` +
      `!حظر @شخص — حظر بذكر\n` +
      `!طرد @شخص — طرد عضو\n` +
      `!تحذير @شخص — تحذير\n` +
      `!مسح @شخص — مسح تحذيرات\n` +
      `اضافة [رقم] — إضافة عضو\n` +
      `مسح كل الرسايل — رد على رسالة عضو\n` +
      `!معلومات — معلومات الجروب\n` +
      `قائمة الصلاحيات — عرض الصلاحيات\n` +
      `سلب/منح صلاحية ملصقات/وسائط/صوت/رسائل\n\n` +
      `*🤖 للبوت (خاص مع نفسك):*\n` +
      `اعدادات البوت — إعدادات كاملة\n` +
      `قائمة الجروبات — عرض الجروبات\n` +
      `اوامر البوت — هذه القائمة`;
    await selfReply(msg, cmds);
    return;
  }

  // ─ تبديل الترحيب ─
  if (text === 'تفعيل الترحيب') {
    botSettings.welcomeEnabled = true; saveSettings();
    await selfReply(msg, '✅ تم تفعيل الترحيب في جميع الجروبات');
    return;
  }
  if (text === 'تعطيل الترحيب') {
    botSettings.welcomeEnabled = false; saveSettings();
    await selfReply(msg, '❌ تم تعطيل الترحيب في جميع الجروبات');
    return;
  }

  // ─ تبديل الصلاة ─
  if (text === 'تفعيل الصلاة') {
    botSettings.prayerEnabled = true; saveSettings();
    fetchPrayerTimes();
    await selfReply(msg, '✅ تم تفعيل إشعارات أوقات الصلاة');
    return;
  }
  if (text === 'تعطيل الصلاة') {
    botSettings.prayerEnabled = false; saveSettings();
    prayerTimers.forEach(t => clearTimeout(t)); prayerTimers = [];
    await selfReply(msg, '❌ تم تعطيل إشعارات أوقات الصلاة');
    return;
  }

  // ─ تبديل الحماية ─
  if (text === 'تفعيل الحماية') {
    botSettings.badWordsEnabled = true; saveSettings();
    await selfReply(msg, '✅ تم تفعيل فلتر الشتائم والحماية');
    return;
  }
  if (text === 'تعطيل الحماية') {
    botSettings.badWordsEnabled = false; saveSettings();
    await selfReply(msg, '❌ تم تعطيل فلتر الشتائم والحماية');
    return;
  }

  // ─ تبديل يوتيوب ─
  if (text === 'تفعيل اليوتيوب') {
    botSettings.youtubeEnabled = true; saveSettings();
    await selfReply(msg, '✅ تم تفعيل تحميل اليوتيوب');
    return;
  }
  if (text === 'تعطيل اليوتيوب') {
    botSettings.youtubeEnabled = false; saveSettings();
    await selfReply(msg, '❌ تم تعطيل تحميل اليوتيوب');
    return;
  }

  // ─ نقل الأعضاء ─
  if (text === 'نقل الأعضاء') {
    try {
      const groups = await getGroupsList();
      const adminGroups = groups.filter(g => g.isAdmin);
      if (adminGroups.length < 2) {
        await selfReply(msg, '❌ محتاج على الأقل جروبين البوت فيهم أدمن.');
        return;
      }
      selfState.transfer.groups = groups;
      selfState.phase = 'transfer_pick_source';

      let listMsg =
        `🔀 *نقل الأعضاء بين الجروبات*
${'═'.repeat(30)}

` +
        `📋 *اختار جروب المنقول منه:*
${'─'.repeat(28)}
`;
      for (const g of adminGroups) {
        listMsg += `
*${g.index}.* ${g.chat.name} — ${(g.chat.participants||[]).length} عضو`;
      }
      listMsg += `

${'─'.repeat(28)}
aكتب رقم الجروب:`;
      await selfReply(msg, listMsg);
    } catch (err) {
      await selfReply(msg, '❌ فشل جلب الجروبات: ' + err.message);
    }
    return;
  }

  // ─ قائمة الجروبات ─
  if (text === 'قائمة الجروبات') {
    try {
      const groups = await getGroupsList();
      await selfReply(msg, buildGroupsListText(groups));
    } catch (err) {
      await selfReply(msg, '❌ فشل جلب الجروبات: ' + err.message);
    }
    return;
  }

  // ─ تفعيل/تعطيل البوت في جروب ─
  const enableMatch  = text.match(/^تفعيل البوت (\d+)$/);
  const disableMatch = text.match(/^تعطيل البوت (\d+)$/);
  if (enableMatch || disableMatch) {
    const idx    = parseInt((enableMatch || disableMatch)[1], 10);
    const enable = !!enableMatch;
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await selfReply(msg, '❌ رقم الجروب مش صح.'); return; }
      botSettings.botEnabledGroups[target.chat.id._serialized] = enable;
      saveSettings();
      await selfReply(msg, `${enable ? '✅ تفعيل' : '❌ تعطيل'} البوت في جروب *${target.chat.name}*`);
    } catch (err) {
      await selfReply(msg, '❌ خطأ: ' + err.message);
    }
    return;
  }

  // ─ تغيير اسم جروب ─
  const renameMatch = text.match(/^تغيير اسم (\d+)$/);
  if (renameMatch) {
    const idx = parseInt(renameMatch[1], 10);
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await selfReply(msg, '❌ رقم الجروب مش صح.'); return; }
      selfState.phase = `waiting_group_name:${idx}`;
      await selfReply(msg, `✏️ اكتب الاسم الجديد لجروب *${target.chat.name}*:`);
    } catch (err) {
      await selfReply(msg, '❌ خطأ: ' + err.message);
    }
    return;
  }

  // ─ تغيير صورة جروب ─
  const photoMatch = text.match(/^تغيير صورة (\d+)$/);
  if (photoMatch) {
    const idx = parseInt(photoMatch[1], 10);
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await selfReply(msg, '❌ رقم الجروب مش صح.'); return; }
      selfState.phase = `waiting_group_photo:${idx}`;
      await selfReply(msg, `📷 ابعت الصورة الجديدة لجروب *${target.chat.name}*:`);
    } catch (err) {
      await selfReply(msg, '❌ خطأ: ' + err.message);
    }
    return;
  }
}

// ============================================================
// 🖼️  تدفق سير سمسار (01157784851)
// ============================================================
async function handleBrokerFlow(msg, chat, text, sender) {

  // ── مرحلة: استقبال صورة / اسكرين (تبدأ الرحلة) ──
  if (msg.hasMedia && (msg.type === 'image' || msg.type === 'document' || msg.type === 'video')) {
    brokerState.phase    = 'waiting_name';
    brokerState.mediaMsg = msg;
    brokerState.name     = '';
    brokerState.count    = '';
    brokerState.groups   = [];
    await msg.reply(
      `✅ وصلت الصورة!\n\n` +
      `❓ *السؤال الأول:*\nإيه اسم الشخص أو المشروع؟`
    );
    return;
  }

  // ── مرحلة: انتظار الاسم ──
  if (brokerState.phase === 'waiting_name') {
    if (!text) { await msg.reply('❌ اكتب الاسم كنص.'); return; }
    brokerState.name  = text;
    brokerState.phase = 'waiting_count';
    await msg.reply(
      `👤 الاسم: *${text}*\n\n` +
      `❓ *السؤال التاني:*\nاكتب العدد:`
    );
    return;
  }

  // ── مرحلة: انتظار العدد ──
  if (brokerState.phase === 'waiting_count') {
    if (!text) { await msg.reply('❌ اكتب العدد.'); return; }
    brokerState.count = text;
    brokerState.phase = 'waiting_group';

    try {
      const groups = await getGroupsList();
      brokerState.groups = groups;
      let listMsg =
        `👤 الاسم: *${brokerState.name}*\n` +
        `🔢 العدد: *${brokerState.count}*\n\n` +
        `📋 *اختار الجروب اللي هيتبعتله:*\n${'─'.repeat(25)}\n`;
      for (const g of groups) {
        const mark = g.isAdmin ? '✅' : '❌';
        listMsg += `\n*${g.index}.* ${mark} ${g.chat.name}`;
      }
      listMsg += `\n\n${'─'.repeat(25)}\n✅ البوت أدمن  |  ❌ مش أدمن\n\nاكتب رقم الجروب:`;
      await msg.reply(listMsg);
    } catch (err) {
      await msg.reply('❌ فشل جلب الجروبات: ' + err.message);
      brokerState.phase = 'idle';
    }
    return;
  }

  // ── مرحلة: انتظار اختيار الجروب ──
  if (brokerState.phase === 'waiting_group') {
    const choice = parseInt(text, 10);
    if (isNaN(choice)) { await msg.reply('❌ اكتب رقم الجروب فقط.'); return; }

    const target = brokerState.groups.find(g => g.index === choice);
    if (!target) {
      await msg.reply(`❌ رقم مش صح. اختار من 1 إلى ${brokerState.groups.length}`);
      return;
    }

    try {
      // ✅ الرسالة بالشكل الجديد
      const caption =
        `𝑫𝑶𝑵𝑬 ${brokerState.count} ${brokerState.name}\n` +
        `𝑩𝒀(𝑻𝑬𝑺𝑳𝑨 𝑻𝑬𝑨𝑴) ♡`;

      const media = await brokerState.mediaMsg.downloadMedia();
      await target.chat.sendMessage(media, { caption });

      await msg.reply(
        `✅ تم الإرسال إلى *${target.chat.name}* بنجاح! 🚀\n\n` +
        `📝 الرسالة:\n${caption}`
      );
      console.log(`📤 السمسار أرسل إلى: ${target.chat.name}`);
    } catch (err) {
      await msg.reply('❌ فشل الإرسال: ' + err.message);
    }

    brokerState.phase    = 'idle';
    brokerState.mediaMsg = null;
    brokerState.name     = '';
    brokerState.count    = '';
    brokerState.groups   = [];
    return;
  }

  // ── أي رسالة نصية وقت idle → رد عادي ──
  if (!msg.fromMe && brokerState.phase === 'idle' && !msg.hasMedia) {
    await msg.reply(
      `👋 مرحباً!\nابعت الصورة أو الاسكرين اللي عايز تبعتها للجروب وأنا هساعدك.`
    );
  }
}

// ============================================================
// 💬  معالجة رسائل الجروبات
// ============================================================
async function handleGroupMessage(msg, chat) {
  if (!isBotEnabledInGroup(chat.id._serialized)) return;

  const sender     = await msg.getContact();
  const senderId   = sender.id.user;
  const senderName = sender.pushname || sender.number;
  const text       = msg.body?.trim() || '';

  const participants   = chat.participants || [];
  const participantObj = participants.find(p => p.id.user === senderId);
  const isGroupAdmin   = participantObj ? (participantObj.isAdmin || participantObj.isSuperAdmin) : false;
  const isAdmin        = CONFIG.ADMINS.includes(senderId) || isGroupAdmin;

  console.log(`\n📩 [${chat.name}] ${senderName}: ${text.substring(0, 50)}`);

  // ════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════
  // 👤  فين امير؟
  // ════════════════════════════════════════════════════
  if (
    text.includes('فين امير') || text.includes('امير فين') ||
    text.includes('فين أمير') || text.includes('أمير فين') ||
    text === 'امير' || text === 'أمير'
  ) {
    await msg.reply('معلش 😅 امير مش موجود دلوقتي\nممكن يكون موجود لما يفضى عشان عنده مزاكرة وحاجات مهمة 📚');
    return;
  }

  // ════════════════════════════════════════════════════
  // 🎵  يوتيوب
  // ════════════════════════════════════════════════════
  const youtubeMatch = text.match(/^يوت\s+(.+)/i) || text.match(/^يوتيوب\s+(.+)/i);
  if (youtubeMatch && botSettings.youtubeEnabled) {
    const songName = youtubeMatch[1].trim();
    const lastRequest = youtubeCooldowns.get(senderId);
    if (lastRequest && Date.now() - lastRequest < CONFIG.YOUTUBE_COOLDOWN * 1000) {
      await msg.reply(`⏳ انتظر ${CONFIG.YOUTUBE_COOLDOWN} ثانية!`);
      return;
    }
    youtubeCooldowns.set(senderId, Date.now());
    const waitMsg = await msg.reply(`🔍 جاري البحث عن: *${songName}*\nانتظر لحظة...`);
    let downloadDir = null;
    try {
      const result = await downloadYouTubeAudio(songName);
      downloadDir = result.downloadDir;

      // إرسال الصورة المصغرة لو موجودة
      if (result.thumbPath && fs.existsSync(result.thumbPath)) {
        try {
          const thumbMedia = MessageMedia.fromFilePath(result.thumbPath);
          await msg.reply(thumbMedia, undefined, { caption: `🎵 *${songName}*` });
        } catch (_) {}
      }

      // إرسال الأغنية
      const audioMedia = MessageMedia.fromFilePath(result.audioPath);
      audioMedia.mimetype = 'audio/mpeg';
      await msg.reply(audioMedia, undefined, { sendAudioAsVoice: false });

      try { await waitMsg.delete(true); } catch (_) {}
      console.log(`✅ تم إرسال: ${songName}`);
    } catch (err) {
      try { await waitMsg.delete(true); } catch (_) {}
      await msg.reply(`❌ ${err.message}`);
      console.error('❌ YouTube error:', err.message);
    } finally {
      // ✅ مسح مجلد التحميل كله — مضمون حتى لو فشل الإرسال
      if (downloadDir) nukDir(downloadDir);
    }
    return;
  }

  // ════════════════════════════════════════════════════
  // 🚫  حظر فوري — شتائم الأهل والتحرش
  // ════════════════════════════════════════════════════
  const INSTANT_BAN_PATTERNS = [
    /امك|أمك|ام[كه]|أم[كه]/i,
    /اختك|أختك/i,
    /ابوك|أبوك/i,
    /يلعن.*ام|يلعن.*أم/i,
    /كس.*ام|كس.*أم/i,
    /نيك.*ام|نيك.*أم/i,
    /ابن.*وسخ|ابن.*متناك|ابن.*شرموط/i,
    /بنت.*وسخ|بنت.*متناكه|بنت.*شرموط/i,
  ];

  if (!isAdmin && text.length > 0) {
    const isInstantBan = INSTANT_BAN_PATTERNS.some(p => p.test(text));
    if (isInstantBan) {
      try {
        await msg.delete(true);
        await chat.removeParticipants([sender.id._serialized]);
        resetWarnings(senderId);
        await chat.sendMessage(
          `🚫 تم حظر *${senderName}* فوراً بسبب استخدام شتائم في الأهل.\nالجروب ده مش هيتسمح بالكلام ده.`,
          { mentions: [sender] }
        );
        console.log(`🚫 حظر فوري (أهل): ${senderName}`);
      } catch (err) {
        console.error('❌ فشل الحظر الفوري:', err.message);
      }
      return;
    }
  }

  // ════════════════════════════════════════════════════
  // ⚠️  كلام غير لائق (مش شتيمة) — تحذير ثم تهديد
  // ════════════════════════════════════════════════════
  const INAPPROPRIATE_PATTERNS = [
    /كلوت|لباس\s*داخلي|بوكسر|سروال\s*داخلي/i,
    /ثدي|بزاز|نهود|حلمة/i,
    /مؤخرة|طيز|ردف|دبر/i,
    /عورة|أعضاء\s*تناسلية/i,
    /جنس\s*بدون\s*سياق|الجنس\s*مع/i,
    /إباحي|بورن|سكس\s+/i,
  ];

  const inappropriateViolations = new Map(); // senderId => count

  if (!isAdmin && text.length > 0) {
    const isInappropriate = INAPPROPRIATE_PATTERNS.some(p => p.test(text));
    if (isInappropriate) {
      try {
        await msg.delete(true);
        const prevCount = inappropriateViolations.get(senderId) || 0;
        inappropriateViolations.set(senderId, prevCount + 1);

        if (prevCount === 0) {
          // أول مرة → تحذير مؤدب
          await chat.sendMessage(
            `يسطا *${senderName}* عيب — احنا معانا بنات هنا 🙂\nالكلام ده مش مناسب في الجروب ده.`,
            { mentions: [sender] }
          );
        } else {
          // تكرار → تهديد
          await chat.sendMessage(
            `هو إنت مستمر يا *${senderName}*؟ وأنا أحظرك دلوقتي؟!! 😤\nده إنذار أخير.`,
            { mentions: [sender] }
          );
          // لو كرر للمرة التالتة → حظر
          if (prevCount >= 2) {
            await chat.removeParticipants([sender.id._serialized]);
            inappropriateViolations.delete(senderId);
            await chat.sendMessage(
              `🚫 تم حظر *${senderName}* بعد تكرار الكلام الغير لائق.`,
              { mentions: [sender] }
            );
          }
        }
        console.log(`⚠️ كلام غير لائق (${prevCount + 1}): ${senderName}`);
      } catch (err) {
        console.error('❌ فشل التحذير:', err.message);
      }
      return;
    }
  }
  if (!isAdmin) {
    const chatKey = chat.id._serialized;
    const perms   = getPerms(chatKey, senderId);

    if (isMuted(chatKey, senderId)) { try { await msg.delete(true); } catch (_) {} return; }
    if (msg.type === 'chat' && !perms.text) { try { await msg.delete(true); } catch (_) {} return; }
    if (msg.type === 'sticker' && (!perms.sticker || stickerLocked.get(chatKey))) { try { await msg.delete(true); } catch (_) {} return; }
    if ((msg.type === 'image' || msg.type === 'video' || msg.type === 'document') && (!perms.media || imageLocked.get(chatKey))) { try { await msg.delete(true); } catch (_) {} return; }
    if ((msg.type === 'ptt' || msg.type === 'audio') && !perms.voice) { try { await msg.delete(true); } catch (_) {} return; }
    if (linkLocked.get(chatKey) && msg.type === 'chat' && containsLink(text)) {
      try {
        await msg.delete(true);
        await chat.sendMessage(`مش قولنا ممنوع الروابط؟ 🙂\nممنوع اللينكات متبعتهاش تاني ❤`, { mentions: [sender] });
        console.log(`🔗 رابط حُذف من: ${senderName}`);
      } catch (_) {}
      return;
    }
  }

  // ════════════════════════════════════════════════════
  // 🛡️  سبام + شتائم
  // ════════════════════════════════════════════════════
  if (!isAdmin && isSpamming(senderId)) {
    try { await msg.delete(true); console.log(`⚡ سبام من: ${senderName}`); } catch (_) {}
    return;
  }

  if (!isAdmin && botSettings.badWordsEnabled && text.length > 0) {
    const badCount = countBadWords(text);
    if (badCount > 0) {
      try {
        await msg.delete(true);
        if (badCount > 6) {
          await chat.removeParticipants([sender.id._serialized]);
          resetWarnings(senderId);
          await chat.sendMessage(`🚫 تم حظر *${senderName}* فوراً بسبب رسالة تحتوي على ${badCount} شتيمة.`, { mentions: [sender] });
        } else {
          const warnCount = addWarning(senderId);
          if (warnCount >= CONFIG.MAX_WARNINGS) {
            await chat.removeParticipants([sender.id._serialized]);
            resetWarnings(senderId);
            await chat.sendMessage(`🚫 تم حظر *${senderName}* بسبب الشتائم المتكررة.`, { mentions: [sender] });
          } else {
            await chat.sendMessage(`⚠️ تحذير *${senderName}*!\nاستخدمت ألفاظ غير لائقة.\nالتحذيرات: ${warnCount}/${CONFIG.MAX_WARNINGS}`, { mentions: [sender] });
          }
        }
      } catch (err) { console.error('❌ خطأ في الحظر/التحذير:', err.message); }
      return;
    }
  }

  // ════════════════════════════════════════════════════
  // 👮  للجميع
  // ════════════════════════════════════════════════════
  if (
    text.includes('مين صاحب الروم') || text.includes('مين صاحب الجروب') ||
    text.includes('صاحب الروم مين') || text.includes('صاحب الجروب مين')
  ) {
    await chat.sendMessage('👑 *AMIR* هو صاحب الروم');
    return;
  }

  if (text === '!مساعدة' || text === '!help') {
    const helpMsg =
      `🤖 *أوامر البوت*\n\n` +
      `*📄 للجميع:*\n` +
      `يوت [اغنية] — تحميل أغنية\n\n` +
      `*👮 للمشرفين:*\n` +
      `قفل/فتح الملصقات | قفل/فتح الصور\n` +
      `قفل/فتح الروابط | اقفل المكالمة\n` +
      `مسح / احذف — رد على رسالة\n` +
      `حظر / بان — رد على رسالة\n` +
      `حظر [رقم] — حظر بالرقم\n` +
      `!حظر @شخص | !طرد @شخص\n` +
      `!تحذير @شخص | !مسح @شخص\n` +
      `اضافة [رقم] — إضافة عضو\n` +
      `مسح كل الرسايل — رد على رسالة\n` +
      `!معلومات — معلومات الجروب\n` +
      `قائمة الصلاحيات`;
    await msg.reply(helpMsg);
    return;
  }

  // ════════════════════════════════════════════════════
  // 👋  تشغيل/إيقاف الترحيب (لأي أدمن في الجروب)
  // ════════════════════════════════════════════════════
  if (text === 'ايقاف الترحيب' || text === 'إيقاف الترحيب' || text === 'وقف الترحيب') {
    if (!isGroupAdmin && !CONFIG.ADMINS.includes(senderId)) {
      await msg.reply('❌ هذا الأمر للمشرفين فقط.');
      return;
    }
    botSettings.welcomeEnabledGroups[chat.id._serialized] = false;
    saveSettings();
    await chat.sendMessage('🔕 تم إيقاف رسالة الترحيب في هذا الجروب.');
    return;
  }

  if (text === 'تشغيل الترحيب' || text === 'تفعيل الترحيب هنا') {
    if (!isGroupAdmin && !CONFIG.ADMINS.includes(senderId)) {
      await msg.reply('❌ هذا الأمر للمشرفين فقط.');
      return;
    }
    botSettings.welcomeEnabledGroups[chat.id._serialized] = true;
    saveSettings();
    await chat.sendMessage('🔔 تم تشغيل رسالة الترحيب في هذا الجروب.');
    return;
  }

  if (!isAdmin) return;

  // ════════════════════════════════════════════════════
  // 👮  أوامر المشرفين فقط
  // ════════════════════════════════════════════════════

  if (text === 'كتم') {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    mutedUsers.add(`${chat.id._serialized}:${target.id.user}`);
    await chat.sendMessage(`🔇 تم كتم *${target.pushname || target.number}*`, { mentions: [target] });
    return;
  }

  if (text === 'رفع الكتم' || text === 'فك الكتم') {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    mutedUsers.delete(`${chat.id._serialized}:${target.id.user}`);
    await chat.sendMessage(`🔊 تم رفع الكتم عن *${target.pushname || target.number}*`, { mentions: [target] });
    return;
  }

  if (text === 'قائمة الصلاحيات' || text === 'الصلاحيات') {
    const parts = chat.participants || [];
    let listMsg = `📋 *قائمة الصلاحيات — ${chat.name}*\n${'─'.repeat(30)}\n`;
    let idx = 1;
    for (const p of parts) {
      const uid = p.id.user;
      const role = (p.isAdmin || p.isSuperAdmin) ? '👑 أدمن' : '👤 عضو';
      const muted = mutedUsers.has(`${chat.id._serialized}:${uid}`) ? '🔇 ' : '';
      const perms = getPerms(chat.id._serialized, uid);
      listMsg += `\n*${idx}.* +${uid} ${role} ${muted}\n`;
      listMsg += `   💬${perms.text?'✅':'❌'} 🖼️${perms.media?'✅':'❌'} 🎤${perms.voice?'✅':'❌'} 😀${perms.sticker?'✅':'❌'}\n`;
      idx++;
    }
    listMsg += `\n${'─'.repeat(30)}\nرد على رسالة العضو واكتب:\n*سلب/منح صلاحية ملصقات/وسائط/صوت/رسائل*`;
    await chat.sendMessage(listMsg);
    return;
  }

  const permActions = {
    'سلب صلاحية ملصقات': { perm: 'sticker', val: false }, 'منح صلاحية ملصقات': { perm: 'sticker', val: true },
    'سلب صلاحية وسائط':  { perm: 'media',   val: false }, 'منح صلاحية وسائط':  { perm: 'media',   val: true },
    'سلب صلاحية صور':    { perm: 'media',   val: false }, 'منح صلاحية صور':    { perm: 'media',   val: true },
    'سلب صلاحية صوت':    { perm: 'voice',   val: false }, 'منح صلاحية صوت':    { perm: 'voice',   val: true },
    'سلب صلاحية رسائل':  { perm: 'text',    val: false }, 'منح صلاحية رسائل':  { perm: 'text',    val: true },
  };

  if (permActions[text]) {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    const { perm, val } = permActions[text];
    const perms = getPerms(chat.id._serialized, target.id.user);
    perms[perm] = val;
    const permNames = { sticker: 'الملصقات', media: 'الوسائط/الصور', voice: 'التسجيلات الصوتية', text: 'الرسائل' };
    await chat.sendMessage(`${val ? '✅ منح' : '❌ سلب'} صلاحية *${permNames[perm]}* ${val ? 'لـ' : 'من'} *${target.pushname || target.number}*`, { mentions: [target] });
    return;
  }

  if (text === 'قفل الروابط' || text === 'منع الروابط') { linkLocked.set(chat.id._serialized, true); await chat.sendMessage('🔒 تم قفل الروابط'); return; }
  if (text === 'فتح الروابط' || text === 'سماح الروابط') { linkLocked.set(chat.id._serialized, false); await chat.sendMessage('🔓 تم فتح الروابط'); return; }
  if (text === 'قفل الملصقات') { stickerLocked.set(chat.id._serialized, true); await chat.sendMessage('🔒 تم قفل الملصقات'); return; }
  if (text === 'فتح الملصقات') { stickerLocked.set(chat.id._serialized, false); await chat.sendMessage('🔓 تم فتح الملصقات'); return; }
  if (text === 'قفل الصور') { imageLocked.set(chat.id._serialized, true); await chat.sendMessage('🔒 تم قفل الصور'); return; }
  if (text === 'فتح الصور') { imageLocked.set(chat.id._serialized, false); await chat.sendMessage('🔓 تم فتح الصور'); return; }

  if (text === 'اقفل المكالمه' || text === 'اقفل المكالمة' || text === 'اقفل المكالمه الجماعيه') {
    try { await chat.setMessagesAdminsOnly(true); await chat.sendMessage('📵 تم قفل المكالمات الجماعية'); }
    catch (_) { await msg.reply('❌ فشل قفل المكالمة.'); }
    return;
  }

  if (text === 'مسح كل الرسايل' || text === 'مسح كل رسايله') {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    await msg.reply(`🗑️ جاري مسح رسايل *${target.pushname || target.number}*...`);
    try {
      const messages = await chat.fetchMessages({ limit: 1000 });
      let count = 0;
      for (const m of messages) {
        if (m.author === target.id._serialized || m.from === target.id._serialized) {
          try { await m.delete(true); count++; await new Promise(r => setTimeout(r, 300)); } catch (_) {}
        }
      }
      await chat.sendMessage(`✅ تم مسح ${count} رسالة لـ *${target.pushname || target.number}*`);
    } catch (err) { await msg.reply('❌ فشل مسح الرسايل: ' + err.message); }
    return;
  }

  if (text === 'مسح' || text === 'احذف') {
    if (msg.hasQuotedMsg) { const q = await msg.getQuotedMessage(); await q.delete(true); await msg.react('✅'); }
    else { await msg.reply('❌ اعمل رد على الرسالة اللي تريد تحذفها.'); }
    return;
  }

// ── تحويل الأرقام العربية والمشوهة إلى أرقام صحيحة ──────────
function normalizeNumber(raw) {
  if (!raw) return null;
  // تحويل الأرقام العربية-الهندية → لاتينية
  let num = raw
    .replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[^0-9]/g, ''); // احتفظ بالأرقام فقط
  if (!num) return null;
  // مصر: 01XXXXXXXXX → 201XXXXXXXXX
  if (num.startsWith('01') && num.length === 11) num = '2' + num;
  // لو بدأ بـ 0 بس → أضف 20 (مصر افتراضي)
  else if (num.startsWith('0') && num.length <= 10) num = '20' + num.slice(1);
  return num;
}

  if (text === 'حظر' || text === 'بان') {
    if (msg.hasQuotedMsg) {
      const q = await msg.getQuotedMessage(); const target = await q.getContact();
      await chat.removeParticipants([target.id._serialized]);
      await chat.sendMessage(`🚫 تم حظر *${target.pushname || target.number}*`, { mentions: [target] });
    } else { await msg.reply('❌ اعمل رد على رسالة الشخص اللي تريد تحظره.'); }
    return;
  }

  if (text.startsWith('حظر ') || text.startsWith('بان ')) {
    const rawNum = text.split(/\s+/).slice(1).join('');
    const number = normalizeNumber(rawNum);
    if (!number) { await msg.reply('❌ الرقم مش واضح. اكتب مثال:\nحظر 201XXXXXXXXX'); return; }
    try {
      // ✅ ابعت الرقم كـ link قبل الحظر عشان تتأكد
      await msg.reply(`🔗 wa.me/${number}\n⏳ جاري حظر هذا الرقم...`);
      await chat.removeParticipants([`${number}@c.us`]);
      await chat.sendMessage(`🚫 تم حظر +${number} من الجروب`);
    } catch (err) { await msg.reply('❌ فشل الحظر. تأكد إن الرقم موجود في الجروب.'); }
    return;
  }

  if (text.startsWith('!حظر') || text.startsWith('!ban')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !حظر @شخص'); return; }
    for (const c of mentioned) {
      await chat.removeParticipants([c.id._serialized]);
      await chat.sendMessage(`🚫 تم حظر *${c.pushname || c.number}*`, { mentions: [c] });
    }
    return;
  }

  if (text.startsWith('!طرد') || text.startsWith('!kick')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !طرد @شخص'); return; }
    for (const c of mentioned) {
      await chat.removeParticipants([c.id._serialized]);
      await chat.sendMessage(`👢 تم طرد *${c.pushname || c.number}*`, { mentions: [c] });
    }
    return;
  }

  if (text.startsWith('!تحذير') || text.startsWith('!warn')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !تحذير @شخص'); return; }
    for (const c of mentioned) {
      const count = addWarning(c.id.user);
      await chat.sendMessage(`⚠️ تحذير *${c.pushname || c.number}*\nالتحذيرات: ${count}/${CONFIG.MAX_WARNINGS}`, { mentions: [c] });
    }
    return;
  }

  if (text.startsWith('!مسح') || text.startsWith('!reset')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !مسح @شخص'); return; }
    for (const c of mentioned) { resetWarnings(c.id.user); await msg.reply(`✅ تم مسح تحذيرات @${c.id.user}`); }
    return;
  }

  if (text === '!معلومات' || text === '!info') {
    const parts = chat.participants || [];
    const admins = parts.filter(p => p.isAdmin || p.isSuperAdmin).length;
    await msg.reply(`📋 *معلومات المجموعة*\n\n• الاسم: ${chat.name}\n• الأعضاء: ${parts.length}\n• المشرفون: ${admins}`);
    return;
  }

  if (text.startsWith('اضافة') || text.startsWith('add')) {
    const rawNum = text.split(/\s+/).slice(1).join('');
    const number = normalizeNumber(rawNum);
    if (!number) { await msg.reply('❌ الرقم مش واضح. اكتب مثال:\nاضافة 201XXXXXXXXX'); return; }
    try {
      // ✅ ابعت الرقم كـ link قبل الإضافة عشان تتأكد
      await msg.reply(`🔗 wa.me/${number}\n⏳ جاري إضافة هذا الرقم...`);
      await chat.addParticipants([`${number}@c.us`]);
      await chat.sendMessage(`✅ تمت إضافة +${number} للجروب 🎉`);
    } catch (err) { await msg.reply('❌ فشل إضافة الرقم. تأكد إن عنده واتساب.'); }
    return;
  }

  // ============================================================
  // 🧹  تصفية الأعضاء — طرد الكل (صاحب البوت فقط)
  //     الأوامر: .طرد الكل  /  .طرد الجميع
  // ============================================================
  if (text === '.طرد الكل' || text === '.طرد الجميع') {
    if (senderId !== BROKER_NUMBER) { await msg.reply('🚫 هذا الأمر لصاحب البوت فقط.'); return; }

    const botJid   = `${BOT_NUMBER}@c.us`;
    const allParts = chat.participants || [];
    const toKick   = allParts.filter(p =>
      p.id._serialized !== botJid && !p.isAdmin && !p.isSuperAdmin
    );

    if (toKick.length === 0) {
      await msg.reply('ℹ️ مفيش أعضاء يمكن طردهم (كلهم أدمن أو البوت نفسه).');
      return;
    }

    let progressMsg;
    try {
      progressMsg = await chat.sendMessage(
        `⚠️ *تصفية الأعضاء*\n\n` +
        `سيتم طرد *${toKick.length}* عضو من الجروب.\n` +
        `─────────────────\n` +
        `⏳ جاري التنفيذ...`
      );
    } catch (_) {}

    let kicked = 0, failed = 0;
    const kickedList = [];   // ← قائمة المطرودين للحفظ

    for (const member of toKick) {
      try {
        await chat.removeParticipants([member.id._serialized]);
        kickedList.push(member.id._serialized);   // ← احفظ الرقم
        kicked++;
        await new Promise(r => setTimeout(r, 800));
      } catch (_) { failed++; }

      if (progressMsg && (kicked + failed) % 5 === 0) {
        try {
          await progressMsg.edit(
            `⚠️ *تصفية الأعضاء*\n\n` +
            `✅ تم طرد: *${kicked}*\n` +
            `❌ فشل: *${failed}*\n` +
            `📊 الإجمالي: ${kicked + failed} / ${toKick.length}\n` +
            `─────────────────\n` +
            `⏳ جاري التنفيذ...`
          );
        } catch (_) {}
      }
    }

    // ── حفظ قائمة المطرودين ──────────────────────────────────
    if (kickedList.length > 0) {
      try {
        const kickedData = loadKickedMembers();
        kickedData[chat.id._serialized] = {
          groupName : chat.name,
          kickedAt  : new Date().toISOString(),
          members   : kickedList,
        };
        saveKickedMembers(kickedData);
        console.log(`💾 تم حفظ ${kickedList.length} رقم في kicked_members.json`);
      } catch (e) { console.error('❌ فشل حفظ قائمة المطرودين:', e.message); }
    }

    const finalText =
      `✅ *اكتملت التصفية*\n\n` +
      `👢 تم طرد: *${kicked}* عضو\n` +
      `❌ فشل: *${failed}*\n` +
      `─────────────────\n` +
      `💾 تم حفظ القائمة\n` +
      `📩 اكتب *.رجع الكل* لاستعادتهم`;

    try {
      if (progressMsg) await progressMsg.edit(finalText);
      else await chat.sendMessage(finalText);
    } catch (_) { await chat.sendMessage(finalText); }

    console.log(`🧹 [kick-all] طُرد=${kicked} فشل=${failed} جروب=${chat.name}`);
    return;
  }

  // ============================================================
  // 🔄  استعادة المطرودين — .رجع الكل (صاحب البوت فقط)
  // ============================================================
  if (text === '.رجع الكل' || text === '.ارجع الكل' || text === '.استعادة الكل') {
    if (senderId !== BROKER_NUMBER) { await msg.reply('🚫 هذا الأمر لصاحب البوت فقط.'); return; }

    const kickedData = loadKickedMembers();
    const groupData  = kickedData[chat.id._serialized];

    if (!groupData || !groupData.members || groupData.members.length === 0) {
      await msg.reply('ℹ️ مفيش قائمة مطرودين محفوظة لهذا الجروب.\nشغّل *.\u0637رد الكل* الأول.');
      return;
    }

    const toReAdd   = groupData.members;
    const kickedAt  = groupData.kickedAt ? new Date(groupData.kickedAt).toLocaleString('ar-EG') : 'غير معروف';

    let progressMsg;
    try {
      progressMsg = await chat.sendMessage(
        `🔄 *استعادة الأعضاء*\n\n` +
        `📅 تاريخ الطرد: ${kickedAt}\n` +
        `👥 عدد الأعضاء: *${toReAdd.length}*\n` +
        `─────────────────\n` +
        `⏳ جاري إعادة الإضافة...`
      );
    } catch (_) {}

    let added = 0, failed = 0;

    for (const jid of toReAdd) {
      try {
        await chat.addParticipants([jid]);
        added++;
        await new Promise(r => setTimeout(r, 1200));  // تأخير أكبر عند الإضافة
      } catch (_) { failed++; }

      if (progressMsg && (added + failed) % 5 === 0) {
        try {
          await progressMsg.edit(
            `🔄 *استعادة الأعضاء*\n\n` +
            `✅ تمت الإضافة: *${added}*\n` +
            `❌ فشل: *${failed}*\n` +
            `📊 الإجمالي: ${added + failed} / ${toReAdd.length}\n` +
            `─────────────────\n` +
            `⏳ جاري التنفيذ...`
          );
        } catch (_) {}
      }
    }

    // مسح القائمة بعد الاستعادة الناجحة
    if (added > 0) {
      try {
        delete kickedData[chat.id._serialized];
        saveKickedMembers(kickedData);
      } catch (_) {}
    }

    const finalText =
      `✅ *اكتملت الاستعادة*\n\n` +
      `🎉 تمت إضافة: *${added}* عضو\n` +
      `❌ فشل: *${failed}*\n` +
      `─────────────────\n` +
      `${failed > 0 ? '⚠️ الأرقام الفاشلة ربما حذفوا واتساب أو بلوكوا الجروب.' : '🎊 تمام كله رجع!'}`;

    try {
      if (progressMsg) await progressMsg.edit(finalText);
      else await chat.sendMessage(finalText);
    } catch (_) { await chat.sendMessage(finalText); }

    console.log(`🔄 [re-add] أُضيف=${added} فشل=${failed} جروب=${chat.name}`);
    return;
  }

}

// ============================================================
// 🔌  معالجة الأخطاء
// ============================================================
client.on('disconnected', (reason) => {
  console.log('⚠️ انقطع الاتصال:', reason);
  console.log('🔄 إعادة الاتصال خلال 10 ثوانٍ...');
  setTimeout(() => {
    client.initialize().catch(err => console.error('❌ فشل إعادة الاتصال:', err.message));
  }, 10000);
});

client.on('auth_failure', (msg) => {
  console.error('❌ فشل التوثيق:', msg);
  console.log('💡 احذف مجلد .wwebjs_auth وأعد التشغيل.');
});

// ============================================================
// 🚀  تشغيل
// ============================================================
console.log('════════════════════════════════════════');
console.log('   بوت واتساب — جاري التشغيل...');
console.log('════════════════════════════════════════\n');

const loadMsgs = ['⏳ فتح Chrome...', '🌐 الاتصال بواتساب...', '🔄 تحميل الجلسة...', '📡 مزامنة...'];
let li = 0, ld = 0;
const loadTimer = setInterval(() => {
  ld = (ld + 1) % 4;
  process.stdout.write(`\r${loadMsgs[li]}${ '.'.repeat(ld + 1) }   `);
  if (ld === 3) li = (li + 1) % loadMsgs.length;
}, 600);

client.initialize().catch(err => {
  console.error('❌ فشل تشغيل البوت:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 إيقاف البوت...');
  cleanAllAudio();
  process.exit(0);
});
