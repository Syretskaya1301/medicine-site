/**
 * Сервер: синхронизация расписания и SMS-напоминания в заданное время (Twilio).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

function trimEnv(v) {
  if (v == null || v === undefined) return "";
  return String(v).replace(/^\uFEFF/, "").trim();
}

const DEFAULT_SYNC_SECRET = "local-med-reminder";

const PORT = Number(trimEnv(process.env.PORT) || 3780);
const SYNC_SECRET = trimEnv(process.env.SYNC_SECRET) || DEFAULT_SYNC_SECRET;
const DATA_PATH = path.join(__dirname, "data", "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");

let twilioCached;
function getTwilioClient() {
  if (twilioCached === false) return null;
  if (twilioCached) return twilioCached;
  const sid = trimEnv(process.env.TWILIO_ACCOUNT_SID);
  const token = trimEnv(process.env.TWILIO_AUTH_TOKEN);
  if (!sid || !token) {
    twilioCached = false;
    return null;
  }
  try {
    twilioCached = require("twilio")(sid, token);
  } catch (e) {
    console.error("[sms] twilio:", e.message);
    twilioCached = false;
    return null;
  }
  return twilioCached;
}

function normalizePhoneE164(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s/g, "");
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return "+" + digits;
    return null;
  }
  const d = s.replace(/\D/g, "").replace(/^8/, "7");
  if (d.length === 10) return "+7" + d;
  if (d.length === 11 && d[0] === "7") return "+" + d;
  return null;
}

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data.users) data.users = {};
    if (!data.sent) data.sent = {};
    return data;
  } catch {
    return { users: {}, sent: {} };
  }
}

function saveStore(store) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf8");
}

function pruneOldSent(store, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const key of Object.keys(store.sent)) {
    const ts = store.sent[key];
    if (typeof ts === "string") {
      const d = new Date(ts).getTime();
      if (!Number.isNaN(d) && d < cutoff) delete store.sent[key];
    }
  }
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function nowKeyParts() {
  const now = new Date();
  return {
    hhmm: pad2(now.getHours()) + ":" + pad2(now.getMinutes()),
    dateStr:
      now.getFullYear() +
      "-" +
      pad2(now.getMonth() + 1) +
      "-" +
      pad2(now.getDate()),
  };
}

async function sendReminderSMS(to, medName, time) {
  const client = getTwilioClient();
  const from = trimEnv(process.env.TWILIO_FROM_NUMBER);
  if (!client || !from) {
    console.warn("[sms] Twilio не настроен (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).");
    return false;
  }
  const body = `Напоминание: примите «${medName}» в ${time}. — Лекарства`;
  await client.messages.create({
    body,
    from,
    to,
  });
  return true;
}

async function sendResetSMS(to, code) {
  const client = getTwilioClient();
  const from = trimEnv(process.env.TWILIO_FROM_NUMBER);
  if (!client || !from) {
    console.warn("[sms] Twilio не настроен — код восстановления:", to, code);
    return false;
  }
  const body = `Код восстановления: ${code}. Никому не сообщайте.`;
  await client.messages.create({
    body,
    from,
    to,
  });
  return true;
}

function checkAuth(req) {
  const h = String(req.headers.authorization || "");
  const token = h.startsWith("Bearer ") ? trimEnv(h.slice(7)) : trimEnv(h);
  return token === SYNC_SECRET;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "512kb" }));

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MIN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const otpStore = new Map(); // phone -> { codeHash, expiresAt, attemptsLeft, lastSentAt }

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function otpCleanup() {
  const now = Date.now();
  for (const [phone, rec] of otpStore.entries()) {
    if (!rec || !rec.expiresAt || rec.expiresAt <= now) otpStore.delete(phone);
  }
}

function genOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

app.get("/health", (_req, res) => {
  const twilioOk = Boolean(getTwilioClient() && trimEnv(process.env.TWILIO_FROM_NUMBER));
  res.json({ ok: true, sms: twilioOk, sync: true });
});

app.post("/api/password-reset/request", async (req, res) => {
  otpCleanup();
  const phoneKey = normalizePhoneE164((req.body || {}).phone);
  if (!phoneKey) return res.status(400).json({ error: "Некорректный номер телефона." });

  const now = Date.now();
  const existing = otpStore.get(phoneKey);
  if (existing && existing.lastSentAt && now - existing.lastSentAt < OTP_RESEND_MIN_MS) {
    return res.status(429).json({ error: "Код уже отправлен. Подождите минуту и попробуйте снова." });
  }

  const code = genOtpCode();
  otpStore.set(phoneKey, {
    codeHash: sha256(code),
    expiresAt: now + OTP_TTL_MS,
    attemptsLeft: OTP_MAX_ATTEMPTS,
    lastSentAt: now,
  });

  try {
    await sendResetSMS(phoneKey, code);
  } catch (e) {
    console.error("[reset] sms:", e.message);
  }

  const debugOtp = trimEnv(process.env.DEBUG_OTP);
  const payload = { ok: true, message: "Если номер существует, код отправлен по SMS." };
  if (debugOtp === "1") payload.debugCode = code;
  res.json(payload);
});

app.post("/api/password-reset/verify", (req, res) => {
  otpCleanup();
  const body = req.body || {};
  const phoneKey = normalizePhoneE164(body.phone);
  const code = String(body.code || "").trim();
  if (!phoneKey) return res.status(400).json({ error: "Некорректный номер телефона." });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Код должен быть из 6 цифр." });

  const rec = otpStore.get(phoneKey);
  if (!rec || !rec.expiresAt || rec.expiresAt <= Date.now()) {
    otpStore.delete(phoneKey);
    return res.status(400).json({ error: "Код просрочен или не запрошен." });
  }
  if (rec.attemptsLeft <= 0) {
    otpStore.delete(phoneKey);
    return res.status(429).json({ error: "Слишком много попыток. Запросите новый код." });
  }
  rec.attemptsLeft -= 1;
  otpStore.set(phoneKey, rec);

  if (sha256(code) !== rec.codeHash) {
    return res.status(400).json({ error: "Неверный код." });
  }

  otpStore.delete(phoneKey);
  res.json({ ok: true });
});

app.post("/api/reminders", (req, res) => {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: "Неверный или отсутствует ключ синхронизации." });
  }
  const { phone, medications } = req.body || {};
  const phoneKey = normalizePhoneE164(phone);
  if (!phoneKey) {
    return res.status(400).json({ error: "Некорректный номер телефона." });
  }
  const meds = Array.isArray(medications) ? medications : [];
  const store = loadStore();
  store.users[phoneKey] = {
    phone: phoneKey,
    medications: meds.map((m) => ({
      id: String(m.id || ""),
      name: String(m.name || "Лекарство"),
      times: Array.isArray(m.times) ? m.times.map(String) : [],
    })),
    updatedAt: new Date().toISOString(),
  };
  pruneOldSent(store, 14);
  saveStore(store);
  res.json({ ok: true, message: "Расписание обновлено." });
});

app.use(express.static(PUBLIC_DIR));

async function tickReminders() {
  const client = getTwilioClient();
  const from = trimEnv(process.env.TWILIO_FROM_NUMBER);
  if (!client || !from) return;

  const store = loadStore();
  pruneOldSent(store, 14);
  const { hhmm, dateStr } = nowKeyParts();

  for (const [phoneKey, user] of Object.entries(store.users)) {
    const to = user.phone || phoneKey;
    const medications = user.medications || [];
    for (const med of medications) {
      const times = med.times || [];
      for (const tStr of times) {
        if (tStr !== hhmm) continue;
        const sentKey = `${phoneKey}|${dateStr}|${med.id}|${tStr}`;
        if (store.sent[sentKey]) continue;
        try {
          await sendReminderSMS(to, med.name, tStr);
          store.sent[sentKey] = new Date().toISOString();
          console.log("[sms] отправлено:", sentKey);
        } catch (e) {
          console.error("[sms] ошибка:", sentKey, e.message);
        }
      }
    }
  }
  saveStore(store);
}

cron.schedule("* * * * *", () => {
  tickReminders().catch((e) => console.error("[cron]", e));
});

app.listen(PORT, () => {
  console.log(`Сайт и API: http://localhost:${PORT}`);
  const smsOk = Boolean(getTwilioClient() && trimEnv(process.env.TWILIO_FROM_NUMBER));
  console.log(`SMS (Twilio): ${smsOk ? "настроено" : "не настроено — см. TWILIO_* в .env"}`);
  const fromEnv = Boolean(trimEnv(process.env.SYNC_SECRET));
  console.log(
    fromEnv
      ? "Ключ синхронизации: из .env (тот же в браузере)."
      : "Ключ синхронизации: по умолчанию local-med-reminder (поле можно оставить пустым)."
  );
});
