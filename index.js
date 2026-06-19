// Регистрация Service Worker + простые уведомления по расписанию.
(function () {
  "use strict";

  var STORAGE_PREFIX = "medReminder_data_";
  var SESSION_KEY = "medReminder_session";
  var ENABLED_KEY = "medReminder_notifications_enabled";
  var CHECK_INTERVAL_MS = 30 * 1000;
  var _intervalId = null;
  var _registration = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    var el = $("notifications-status");
    if (!el) return;
    el.textContent = text || "";
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function nowHHMM() {
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function safeJsonParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getSession() {
    return safeJsonParse(localStorage.getItem(SESSION_KEY), null);
  }

  function getUserData(username) {
    return safeJsonParse(localStorage.getItem(STORAGE_PREFIX + username), {
      medications: [],
      history: [],
      profile: {},
    });
  }

  function isoFromDateTime(value) {
    if (!value) return null;
    var s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    return null;
  }

  function medStartDate(med) {
    return isoFromDateTime(med && (med.startDate || med.createdAt)) || "1970-01-01";
  }

  function compareDate(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      // Важно: service-worker.js лежит в /public → регистрируем по этому пути.
      var reg = await navigator.serviceWorker.register("/service-worker.js");
      return reg;
    } catch (e) {
      return null;
    }
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
      return await Notification.requestPermission();
    } catch (e) {
      return "default";
    }
  }

  async function showReminderNotification(registration, title, options) {
    if (!registration || !registration.showNotification) return false;
    try {
      await registration.showNotification(title, options || {});
      return true;
    } catch (e) {
      return false;
    }
  }

  function notifiedKey(username, date, time, medId) {
    return "medReminder_notified_" + username + "_" + date + "_" + time + "_" + medId;
  }

  function wasNotified(username, date, time, medId) {
    try {
      return localStorage.getItem(notifiedKey(username, date, time, medId)) === "1";
    } catch (e) {
      return false;
    }
  }

  function markNotified(username, date, time, medId) {
    try {
      localStorage.setItem(notifiedKey(username, date, time, medId), "1");
    } catch (e) {}
  }

  async function checkScheduleAndNotify(registration) {
    // запускаем только если пользователь включил уведомления
    try {
      if (localStorage.getItem(ENABLED_KEY) !== "1") return;
    } catch (e) {
      return;
    }

    var sess = getSession();
    if (!sess || !sess.username) return;
    var username = sess.username;

    var data = getUserData(username);
    var meds = (data && data.medications) || [];
    if (!meds.length) return;

    var date = todayISO();
    var time = nowHHMM();

    for (var i = 0; i < meds.length; i++) {
      var med = meds[i];
      if (!med || !med.id) continue;
      if (compareDate(date, medStartDate(med)) < 0) continue;

      var times = med.times || [];
      for (var j = 0; j < times.length; j++) {
        if (times[j] !== time) continue;
        if (wasNotified(username, date, time, med.id)) continue;

        var title = "Пора принять: " + (med.name || "лекарство");
        var body = (med.dose ? med.dose + " · " : "") + time;

        var ok = await showReminderNotification(registration, title, {
          body: body,
          tag: "medReminder_" + med.id + "_" + date + "_" + time,
          renotify: false,
          data: { url: "app.html" },
        });

        if (ok) markNotified(username, date, time, med.id);
      }
    }
  }

  function startChecker() {
    if (!_registration) return;
    if (_intervalId) return;
    checkScheduleAndNotify(_registration);
    _intervalId = setInterval(function () {
      checkScheduleAndNotify(_registration);
    }, CHECK_INTERVAL_MS);
  }

  function stopChecker() {
    if (_intervalId) clearInterval(_intervalId);
    _intervalId = null;
  }

  function isEnabled() {
    try {
      return localStorage.getItem(ENABLED_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setEnabled(v) {
    try {
      localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
    } catch (e) {}
  }

  async function enableNotificationsByUserGesture() {
    if (!("Notification" in window)) {
      setStatus("Этот браузер не поддерживает уведомления.");
      return;
    }
    if (!_registration) {
      _registration = await registerServiceWorker();
    }
    if (!_registration) {
      setStatus("Service Worker не зарегистрировался. Откройте через http://127.0.0.1 и обновите страницу.");
      return;
    }
    var perm = await requestNotificationPermission();
    if (perm === "granted") {
      setEnabled(true);
      setStatus("Уведомления включены.");
      startChecker();
      return;
    }
    if (perm === "denied") {
      setEnabled(false);
      setStatus("Уведомления заблокированы в браузере. Разрешите их в настройках сайта (замок слева от адреса).");
      stopChecker();
      return;
    }
    setEnabled(false);
    setStatus("Разрешение не выдано. Нажмите «Включить уведомления» ещё раз и выберите «Разрешить».");
    stopChecker();
  }

  async function testNotification() {
    if (!_registration) _registration = await registerServiceWorker();
    if (!_registration) {
      setStatus("Service Worker не зарегистрировался (нужен http://127.0.0.1).");
      return;
    }
    if (!("Notification" in window) || Notification.permission !== "granted") {
      setStatus("Сначала включите уведомления (разрешение браузера).");
      return;
    }
    await showReminderNotification(_registration, "Тест уведомления", {
      body: "Если вы это видите — уведомления работают.",
      tag: "medReminder_test",
      renotify: false,
      data: { url: "app.html" },
    });
    setStatus("Тест отправлен.");
  }

  async function initNotifications() {
    _registration = await registerServiceWorker();
    // Не запрашиваем разрешение автоматически (нужно действие пользователя)
    if (isEnabled() && "Notification" in window && Notification.permission === "granted") {
      startChecker();
      setStatus("Уведомления включены. Оставьте вкладку app.html открытой.");
    } else if ("Notification" in window) {
      setStatus("Нажмите «Включить уведомления», чтобы разрешить уведомления.");
    }

    var btnEnable = $("btn-enable-notifications");
    if (btnEnable) {
      btnEnable.addEventListener("click", function () {
        enableNotificationsByUserGesture();
      });
    }
    var btnTest = $("btn-test-notification");
    if (btnTest) {
      btnTest.addEventListener("click", function () {
        testNotification();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNotifications);
  } else {
    initNotifications();
  }

  // Экспортируем функции, если захочешь привязать к кнопке.
  window.MedReminderNotifications = {
    registerServiceWorker: registerServiceWorker,
    requestPermission: requestNotificationPermission,
    enable: enableNotificationsByUserGesture,
    test: testNotification,
  };
})();

