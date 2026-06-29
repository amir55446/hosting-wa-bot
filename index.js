// ============================================================
//   Launcher — تحديث yt-dlp + تشغيل البوت
//   ✅ متوافق مع Railway
// ============================================================

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── إنشاء مجلد البيانات لو مش موجود ──────────────────────────
const DATA_DIR = process.env.DATA_DIR || '.';
if (DATA_DIR !== '.' && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`📁 تم إنشاء مجلد البيانات: ${DATA_DIR}`);
}

// ── تحديث yt-dlp ─────────────────────────────────────────────
async function updateYtDlp() {
  return new Promise((resolve) => {
    console.log('🔄 جاري تحديث yt-dlp...');
    const { exec } = require('child_process');

    const cmds = [
      'pip3 install -U yt-dlp --break-system-packages',
      'pip install -U yt-dlp --break-system-packages',
      'python3 -m pip install -U yt-dlp --break-system-packages',
    ];

    let i = 0;
    function tryNext() {
      if (i >= cmds.length) {
        exec('yt-dlp -U', { timeout: 60000 }, (err) => {
          if (!err) console.log('✅ yt-dlp updated (self-update)');
          else      console.warn('⚠️  yt-dlp update failed — using current version');
          resolve();
        });
        return;
      }
      exec(cmds[i++], { timeout: 120000 }, (err) => {
        if (!err) {
          try {
            const v = execSync('yt-dlp --version', { timeout: 10000 }).toString().trim();
            console.log(`✅ yt-dlp updated: v${v}`);
          } catch (_) { console.log('✅ yt-dlp updated'); }
          resolve();
        } else { tryNext(); }
      });
    }
    tryNext();
  });
}

async function main() {
  // ── 1. تحديث yt-dlp ───────────────────────────────────────
  await updateYtDlp();

  // ── 2. Chrome path (Railway: بيتضبط من الـ Dockerfile) ────
  const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (chromePath) {
    console.log(`✅ Chrome: ${chromePath}`);
  } else {
    console.warn('⚠️  PUPPETEER_EXECUTABLE_PATH غير موجود — سيستخدم puppeteer الـ default');
  }

  // ── 3. تشغيل البوت ────────────────────────────────────────
  require('./bot.js');
}

main().catch(err => {
  console.error('❌ فشل تشغيل البوت:', err.message);
  process.exit(1);
});
