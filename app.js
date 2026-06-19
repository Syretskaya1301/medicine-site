(function () {
  "use strict";

  var STORAGE_USERS = "medReminder_users";
  var STORAGE_PREFIX = "medReminder_data_";
  var SESSION_KEY = "medReminder_session";
  var LAN_IP_KEY = "medReminder_lan_ip";

  var state = {
    username: null,
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    selectedDate: null,
  };

  function normalizeUsername(raw) {
    var s = String(raw || "").trim();
    s = s.replace(/\s+/g, " ");
    if (!s) return "";
    if (s.length > 60) s = s.slice(0, 60);
    return s;
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function generateId() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function getUsers() {
    try {
      var raw = localStorage.getItem(STORAGE_USERS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveUsers(users) {
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  }

  function getUserData(username) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + username);
      if (!raw) return { medications: [], history: [], profile: defaultProfile() };
      var data = JSON.parse(raw);
      if (!Array.isArray(data.medications)) data.medications = [];
      if (!Array.isArray(data.history)) data.history = [];
      ensureProfile(data);
      return data;
    } catch (e) {
      return { medications: [], history: [], profile: defaultProfile() };
    }
  }

  function defaultProfile() {
    return {
      fontScale: "normal",
    };
  }

  function ensureProfile(data) {
    if (!data.profile) data.profile = defaultProfile();
    var p = data.profile;
    if (p.email !== undefined) delete p.email;
    if (p.fontScale === "xlarge") p.fontScale = "large";
    if (p.fontScale !== "normal" && p.fontScale !== "large") {
      p.fontScale = "normal";
    }
    return data;
  }

  function saveUserData(username, data) {
    localStorage.setItem(STORAGE_PREFIX + username, JSON.stringify(data));
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var sess = JSON.parse(raw);
      return sess;
    } catch (e) {
      return null;
    }
  }

  function setSession(username) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ username: username }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function parseTimes(str) {
    if (!str || typeof str !== "string") return [];
    var normalized = str
      .replace(/[;；]/g, ",")
      .replace(/[\uFF0C\u060C]/g, ",");
    return normalized
      .split(",")
      .map(function (s) {
        return s.trim().replace(/\s+/g, "");
      })
      .filter(Boolean)
      .map(function (t) {
        t = t.replace(/[.\-]/g, ":");
        return normalizeTime(t);
      })
      .filter(Boolean);
  }

  function normalizeTime(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return pad2(h) + ":" + pad2(min);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function compareDate(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function isoFromDateTime(value) {
    if (!value) return null;
    var s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    return null;
  }

  function medStartDate(med) {
    if (!med) return "1970-01-01";
    return (
      isoFromDateTime(med.startDate) ||
      isoFromDateTime(med.createdAt) ||
      todayISO()
    );
  }

  function findHistoryRecord(history, medId, date, time) {
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      if (h.medicationId === medId && h.date === date && h.time === time) return h;
    }
    return null;
  }

  function upsertHistory(username, medId, medName, date, time, status) {
    var data = getUserData(username);
    var existing = findHistoryRecord(data.history, medId, date, time);
    if (existing) {
      existing.status = status;
      existing.recordedAt = new Date().toISOString();
    } else {
      data.history.push({
        id: generateId(),
        medicationId: medId,
        medicationName: medName,
        date: date,
        time: time,
        status: status,
        recordedAt: new Date().toISOString(),
      });
    }
    saveUserData(username, data);
  }

  function initApp() {
    var users = getUsers();
    var u = state.username ? users[state.username] : null;
    var name = u && u.name ? String(u.name) : "";
    var label = $("#current-user-name");
    if (label) label.textContent = name || (state.username ? String(state.username) : "Пользователь");
    applyUiFromProfile();
    fillAccessibilityForm();
    renderAll();
  }

  function applyUiFromProfile() {
    if (!state.username) return;
    var data = getUserData(state.username);
    ensureProfile(data);
    var scale = data.profile.fontScale === "large" ? "large" : "normal";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.setAttribute("data-font-scale", scale);
  }

  function fillAccessibilityForm() {
    var form = $("#form-accessibility");
    if (!form || !state.username) return;
    var data = getUserData(state.username);
    ensureProfile(data);
    var elScale = form.querySelector('[name="fontScale"]');
    if (elScale) elScale.value = data.profile.fontScale || "normal";
  }

  function saveAccessibilityFromDom() {
    var form = $("#form-accessibility");
    if (!form || !state.username) return;
    var data = getUserData(state.username);
    ensureProfile(data);
    var elScale = form.querySelector('[name="fontScale"]');
    var sc = elScale ? String(elScale.value || "normal") : "normal";
    data.profile.fontScale = sc === "large" ? "large" : "normal";
    saveUserData(state.username, data);
    applyUiFromProfile();
  }

  function renderAll() {
    if (!state.username) return;
    renderMedications();
    renderCalendar();
    renderTodaySchedule();
    renderHistory();
  }

  function renderMedications() {
    var data = getUserData(state.username);
    var list = $("#medications-list");
    var empty = $("#medications-empty");
    list.innerHTML = "";
    if (!data.medications.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    data.medications.forEach(function (med) {
      var card = document.createElement("div");
      card.className = "med-card " + pickCardVariant(med.id);
      card.innerHTML =
        '<div class="med-card__main">' +
        '<p class="med-card__title"></p>' +
        '<div class="med-card__meta">' +
        '<span class="med-card__dose"></span>' +
        '<span class="med-card__note"></span>' +
        '<span class="med-card__added"></span>' +
        '<span class="med-card__times"><span class="med-card__times-ico" aria-hidden="true">⏰</span><span class="med-card__times-text"></span></span>' +
        "</div>" +
        "</div>" +
        '<div class="med-card__actions">' +
        '<button type="button" class="icon-btn" data-delete-med="' +
        med.id +
        '" aria-label="Удалить">🗑️</button>' +
        '<button type="button" class="icon-btn" data-edit-med="' +
        med.id +
        '" aria-label="Редактировать">✏️</button>' +
        "</div>";

      card.querySelector(".med-card__title").textContent = med.name || "Лекарство";
      var doseEl = card.querySelector(".med-card__dose");
      var noteEl = card.querySelector(".med-card__note");
      var addedEl = card.querySelector(".med-card__added");
      var timesEl = card.querySelector(".med-card__times-text");

      if (doseEl) {
        doseEl.textContent = med.dose ? String(med.dose) : "";
        doseEl.style.display = med.dose ? "" : "none";
      }
      if (noteEl) {
        noteEl.textContent = med.note ? String(med.note) : "";
        noteEl.style.display = med.note ? "" : "none";
      }
      if (timesEl) {
        timesEl.textContent = med.times && med.times.length ? med.times.join(", ") : "—";
      }
      if (addedEl) {
        var sd = medStartDate(med);
        addedEl.textContent = "Добавлено: " + formatDateRu(sd);
      }

      list.appendChild(card);
    });
  }



  function renderTodaySchedule() {
    var data = getUserData(state.username);
    var container = $("#today-schedule");
    var empty = $("#today-empty");
    var date = todayISO();
    
    if (!container) return;
    container.innerHTML = "";
  
    var slots = [];
    data.medications.forEach(function (med) {
      if (compareDate(date, medStartDate(med)) < 0) return;
      (med.times || []).forEach(function (time) {
        slots.push({ med: med, time: time });
      });
    });
  
    slots.sort(function (a, b) {
      return a.time.localeCompare(b.time);
    });
  
    if (!slots.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
  
    slots.forEach(function (slot) {
      var rec = findHistoryRecord(data.history, slot.med.id, date, slot.time);
      var div = document.createElement("div");
      div.className = "today-slot";
      var statusHtml = "";
      if (rec) {
        statusHtml =
          '<span class="today-slot__status ' +
          (rec.status === "taken" ? "today-slot__status--taken" : "today-slot__status--skipped") +
          '">' +
          (rec.status === "taken" ? "✓ Принято" : "✗ Не принято") +
          "</span>";
      }
      div.innerHTML =
        '<div class="today-slot__info">' +
        "<strong></strong>" +
        "<span></span>" +
        statusHtml +
        "</div>" +
        '<div class="today-slot__actions">' +
        '<button type="button" class="btn btn--sm btn--taken" data-action="taken" data-med-id="' +
        slot.med.id +
        '" data-time="' +
        slot.time +
        '" data-med-name="' +
        encodeURIComponent(slot.med.name) +
        '" data-dose="' +
        encodeURIComponent(slot.med.dose || "") +
        '">✓ Принято</button>' +
        '<button type="button" class="btn btn--sm btn--skipped" data-action="skipped" data-med-id="' +
        slot.med.id +
        '" data-time="' +
        slot.time +
        '" data-med-name="' +
        encodeURIComponent(slot.med.name) +
        '" data-dose="' +
        encodeURIComponent(slot.med.dose || "") +
        '">✗ Не принято</button>' +
        "</div>";
      div.querySelector("strong").textContent = slot.med.name;
      div.querySelector(".today-slot__info > span:first-of-type").textContent =
        slot.med.dose ? slot.med.dose + " · " + slot.time : slot.time;
      container.appendChild(div);
    });
  }



  function dayStatusForDate(isoDate) {
    var data = getUserData(state.username);
    var hasTaken = false;
    var hasSkipped = false;
    var needsMark = false;
    var todayIso = todayISO();

    data.history.forEach(function (h) {
      if (h.date !== isoDate) return;
      if (h.status === "taken") hasTaken = true;
      if (h.status === "skipped") hasSkipped = true;
    });

    data.medications.forEach(function (med) {
      if (compareDate(isoDate, medStartDate(med)) < 0) return;
      (med.times || []).forEach(function (time) {
        var rec = findHistoryRecord(data.history, med.id, isoDate, time);
        if (!rec && compareDate(isoDate, todayIso) <= 0) needsMark = true;
      });
    });

    return { hasTaken: hasTaken, hasSkipped: hasSkipped, needsMark: needsMark };
  }

  function renderCalendar() {
    var year = state.calYear;
    var month = state.calMonth;
    var months = [
      "январь",
      "февраль",
      "март",
      "апрель",
      "май",
      "июнь",
      "июль",
      "август",
      "сентябрь",
      "октябрь",
      "ноябрь",
      "декабрь",
    ];

    var yearTitle = $("#cal-year-title");
    if (yearTitle) yearTitle.textContent = String(year) + " год";
    var monthLabel = $("#cal-month-label");
    if (monthLabel) monthLabel.textContent = months[month] + " " + year + "г.";

    var grid = $("#calendar-grid");
    if (!grid) return;
    grid.innerHTML = "";

    var first = new Date(year, month, 1);
    var startPad = (first.getDay() + 6) % 7;
    var start = new Date(year, month, 1 - startPad);
    var today = new Date();
    var todayIso = today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());
    if (!state.selectedDate) state.selectedDate = todayIso;

    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var iso =
        d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
      var inMonth = d.getFullYear() === year && d.getMonth() === month;

      var cell = document.createElement("div");
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("data-iso", iso);
      cell.className = "cal-day" + (inMonth ? "" : " cal-day--out");
      if (iso === todayIso) cell.classList.add("cal-day--today");
      if (iso === state.selectedDate) cell.classList.add("cal-day--selected");

      var st = dayStatusForDate(iso);
      if (st.hasTaken) cell.classList.add("cal-day--taken");
      if (st.hasSkipped) cell.classList.add("cal-day--skipped");
      if (st.needsMark && !st.hasTaken && !st.hasSkipped) cell.classList.add("cal-day--planned");

      cell.textContent = String(d.getDate());
      grid.appendChild(cell);
    }

    renderCalendarDayDetails();
  }

  function renderCalendarDayDetails() {
    var date = state.selectedDate || todayISO();
    var data = state.username ? getUserData(state.username) : null;
    var title = $("#cal-selected-date");
    var list = $("#cal-day-list");
    var empty = $("#cal-day-empty");
    if (title) title.textContent = "Дата: " + formatDateRu(date);
    if (!list || !data) return;
    list.innerHTML = "";
    if (empty) empty.hidden = true;

    var slots = [];
    (data.medications || []).forEach(function (med) {
      if (compareDate(date, medStartDate(med)) < 0) return;
      (med.times || []).forEach(function (time) {
        var rec = findHistoryRecord(data.history, med.id, date, time);
        slots.push({ med: med, time: time, rec: rec });
      });
    });
    slots.sort(function (a, b) {
      var tc = a.time.localeCompare(b.time);
      if (tc !== 0) return tc;
      return String(a.med.name || "").localeCompare(String(b.med.name || ""));
    });

    if (!slots.length) {
      if (empty) empty.hidden = false;
      return;
    }

    slots.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "cal-day-item";
      var badge = "";
      if (s.rec) {
        badge =
          s.rec.status === "taken"
            ? '<span class="badge badge--taken">Принято</span>'
            : '<span class="badge badge--skipped">Не принято</span>';
      } else {
        badge = '<span class="badge cal-badge--planned">По плану</span>';
      }
      row.innerHTML =
        '<div class="cal-day-item__main">' +
        "<strong></strong>" +
        '<span class="cal-day-item__time"></span>' +
        "</div>" +
        '<div class="cal-day-item__status">' +
        badge +
        "</div>";
      row.querySelector("strong").textContent = s.med.name || "—";
      row.querySelector(".cal-day-item__time").textContent = s.med.dose
        ? s.time + " · " + s.med.dose
        : s.time;
      list.appendChild(row);
    });
  }

  function renderHistory() {
    var data = getUserData(state.username);
    var filterEl = $("#history-filter");
    var filter = filterEl ? filterEl.value : "all";
    var tbody = $("#history-body");
    var empty = $("#history-empty");
    var medList = $("#history-med-list");
    var medEmpty = $("#history-med-empty");
    
    if (!tbody) return;
    tbody.innerHTML = "";

    var rows = data.history.slice().sort(function (a, b) {
      var dc = compareDate(b.date, a.date);
      if (dc !== 0) return dc;
      return b.time.localeCompare(a.time);
    });

    renderHistoryMedList(data, filter, medList, medEmpty);

    if (filter === "taken") rows = rows.filter(function (r) {
      return r.status === "taken";
    });
    if (filter === "skipped") rows = rows.filter(function (r) {
      return r.status === "skipped";
    });

    if (!rows.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      var badge =
        r.status === "taken"
          ? '<span class="badge badge--taken">Принято</span>'
          : '<span class="badge badge--skipped">Не принято</span>';
      tr.innerHTML =
        "<td></td><td></td><td></td><td>" + badge + "</td>";
      tr.cells[0].textContent = formatDateRu(r.date);
      tr.cells[1].textContent = r.time;
      tr.cells[2].textContent = r.medicationName || "—";
      tbody.appendChild(tr);
    });
  }

  function renderHistoryMedList(data, filter, container, emptyEl) {
    if (!container) return;
    container.innerHTML = "";
    if (emptyEl) emptyEl.hidden = true;

    var stats = {};
    (data.history || []).forEach(function (h) {
      var id = h.medicationId || "";
      if (!id) return;
      if (!stats[id]) {
        stats[id] = {
          medicationId: id,
          medicationName: h.medicationName || "—",
          takenCount: 0,
          skippedCount: 0,
          last: null, // { date, time, status }
        };
      }
      if (h.status === "taken") stats[id].takenCount++;
      if (h.status === "skipped") stats[id].skippedCount++;

      if (
        !stats[id].last ||
        compareDate(h.date, stats[id].last.date) > 0 ||
        (h.date === stats[id].last.date && h.time.localeCompare(stats[id].last.time) > 0)
      ) {
        stats[id].last = { date: h.date, time: h.time, status: h.status };
      }
    });

    var meds = Object.keys(stats)
      .map(function (k) {
        return stats[k];
      })
      .sort(function (a, b) {
        if (!a.last && !b.last) return 0;
        if (!a.last) return 1;
        if (!b.last) return -1;
        var dc = compareDate(b.last.date, a.last.date);
        if (dc !== 0) return dc;
        return b.last.time.localeCompare(a.last.time);
      });

    if (filter === "taken") meds = meds.filter(function (m) { return m.last && m.last.status === "taken"; });
    if (filter === "skipped") meds = meds.filter(function (m) { return m.last && m.last.status === "skipped"; });

    if (!meds.length) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    meds.forEach(function (m) {
      var card = document.createElement("div");
      var st = m.last && m.last.status ? m.last.status : "";
      card.className =
        "history-med-card " +
        (st === "taken" ? "history-med-card--taken" : st === "skipped" ? "history-med-card--skipped" : "");

      var badge =
        st === "taken"
          ? '<span class="badge badge--taken">Принято</span>'
          : st === "skipped"
          ? '<span class="badge badge--skipped">Не принято</span>'
          : '<span class="badge">—</span>';

      var lastText = m.last ? formatDateRu(m.last.date) + " " + m.last.time : "—";

      card.innerHTML =
        '<div class="history-med-card__main">' +
        "<strong></strong>" +
        '<div class="history-med-card__meta">' +
        '<span class="history-med-card__last"></span>' +
        '<span class="history-med-card__counts"></span>' +
        "</div>" +
        "</div>" +
        '<div class="history-med-card__status">' +
        badge +
        "</div>";

      card.querySelector("strong").textContent = m.medicationName || "—";
      var lastEl = card.querySelector(".history-med-card__last");
      if (lastEl) lastEl.textContent = "Последний раз: " + lastText;
      var countsEl = card.querySelector(".history-med-card__counts");
      if (countsEl) countsEl.textContent = "✓ " + m.takenCount + " · ✗ " + m.skippedCount;

      container.appendChild(card);
    });
  }

  function formatDateRu(iso) {
    var p = iso.split("-");
    if (p.length !== 3) return iso;
    return p[2] + "." + p[1] + "." + p[0];
  }

  function getDefaultIndexUrl() {
    return window.location.protocol + "//" + window.location.host + "/index.html";
  }

  function buildIndexUrlForHost(host) {
    var h = String(host || "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    if (!h) return getDefaultIndexUrl();
    return "http://" + h + "/index.html";
  }

  function fillLanIpField() {
    var el = $("#settings-lan-ip");
    if (!el) return;
    try {
      var saved = localStorage.getItem(LAN_IP_KEY);
      if (saved) el.value = saved;
    } catch (e) {}
  }

  function saveLanIp(raw) {
    try {
      localStorage.setItem(LAN_IP_KEY, String(raw || "").trim());
    } catch (e) {}
  }

  function renderSettingsQr(url) {
    var img = $("#settings-qr-img");
    var urlEl = $("#settings-qr-url");
    if (!img || !urlEl) return;
    var target = url || getDefaultIndexUrl();
    urlEl.textContent = target;
    img.src =
      "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=" +
      encodeURIComponent(target);
    img.onerror = function () {
      urlEl.textContent = "Не удалось загрузить QR. Проверьте интернет и обновите страницу (Ctrl+F5).";
    };
  }

  function qrUrlForPhone() {
    var el = $("#settings-lan-ip");
    var ip = el ? String(el.value || "").trim() : "";
    if (!ip) return null;
    saveLanIp(ip);
    var host = ip.indexOf(":") >= 0 ? ip : ip + ":5173";
    return buildIndexUrlForHost(host);
  }

  function switchView(name) {
    $all(".app-nav__btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === name);
    });
    $("#view-medications").hidden = name !== "medications";
    $("#view-calendar").hidden = name !== "calendar";
    $("#view-history").hidden = name !== "history";
    var settingsView = $("#view-settings");
    if (settingsView) settingsView.hidden = name !== "settings";
    var title = $("#page-title");
    if (title) {
      if (name === "medications") title.textContent = "Мои лекарства";
      if (name === "calendar") title.textContent = "Календарь";
      if (name === "history") title.textContent = "История";
      if (name === "settings") title.textContent = "Настройки";
    }
    if (name === "calendar") renderCalendar();
    if (name === "history") {
      renderTodaySchedule();
      renderHistory();
    }
    if (name === "settings") {
      fillAccessibilityForm();
      fillLanIpField();
      renderSettingsQr(getDefaultIndexUrl());
      var a11ySt = $("#accessibility-status");
      if (a11ySt) a11ySt.hidden = true;
    }
  }

  function openModal() {
    var m = $("#modal-med");
    if (!m) return;
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    var m = $("#modal-med");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
  }

  function setModalMode(editing) {
    var title = $("#modal-med-title");
    if (title) title.textContent = editing ? "Редактировать лекарство" : "Добавить лекарство";
  }

  function pickCardVariant(id) {
    var s = String(id || "");
    var sum = 0;
    for (var i = 0; i < s.length; i++) sum = (sum + s.charCodeAt(i)) % 10;
    return sum % 2 === 0 ? "med-card--red" : "";
  }

  function init() {
    var sess = getSession();
    var users = getUsers();

    if (sess && sess.phone && users && users[sess.phone] && !sess.username) {
      var legacy = users[sess.phone];
      var base = normalizeUsername((legacy && legacy.name) || "") || "Пользователь";
      var username = base;
      var i = 1;
      while (users[username]) {
        i++;
        username = base + " " + i;
      }
      users[username] = {
        __v: 2,
        password: legacy.password || "",
        email: legacy.email || "",
        name: base,
        legacyPhone: sess.phone,
      };
      try {
        var legacyData = localStorage.getItem(STORAGE_PREFIX + sess.phone);
        if (legacyData && !localStorage.getItem(STORAGE_PREFIX + username)) {
          localStorage.setItem(STORAGE_PREFIX + username, legacyData);
        }
      } catch (e) {}
      delete users[sess.phone];
      saveUsers(users);
      setSession(username);
      sess = { username: username };
    }

    if (!sess || !sess.username || !getUsers()[sess.username]) {
      window.location.replace("index.html");
      return;
    }
    state.username = sess.username;
    initApp();
    setTimeout(function () {
      if ($("#view-settings") && !$("#view-settings").hidden) {
        fillLanIpField();
        renderSettingsQr(getDefaultIndexUrl());
      }
    }, 300);

    $("#btn-logout").addEventListener("click", function () {
      state.username = null;
      clearSession();
      window.location.href = "index.html";
    });

    $all(".app-nav__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchView(btn.getAttribute("data-view"));
      });
    });

    var btnAdd = $("#btn-add-med");
    if (btnAdd) {
      btnAdd.addEventListener("click", function () {
        var form = $("#form-medication");
        if (form) {
          form.reset();
          if (form.elements.editId) form.elements.editId.value = "";
        }
        setModalMode(false);
        openModal();
      });
    }

    var modal = $("#modal-med");
    if (modal) {
      modal.addEventListener("click", function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute("data-close-modal")) closeModal();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeModal();
      });
    }

    $("#form-medication").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!state.username) return;
      var fd = new FormData(e.target);
      var medName = String(fd.get("medicationName") || "").trim();
      var timesRaw = String(fd.get("times") || "");
      var dose = String(fd.get("dose") || "").trim();
      var note = String(fd.get("note") || "").trim();
      var editId = String(fd.get("editId") || "").trim();
      if (!medName) {
        alert("Введите название лекарства.");
        return;
      }
      var times = parseTimes(timesRaw);
      if (!times.length) {
        alert(
          "Укажите хотя бы одно время в формате ЧЧ:ММ (например 9:00 или 09:00). Несколько времён — через запятую."
        );
        return;
      }
      var data = getUserData(state.username);
      if (editId) {
        var existing = data.medications.find(function (m) {
          return m.id === editId;
        });
        if (existing) {
          existing.name = medName;
          existing.times = times;
          existing.dose = dose;
          existing.note = note;
          existing.updatedAt = new Date().toISOString();
        }
      } else {
        data.medications.push({
          id: generateId(),
          name: medName,
          times: times,
          dose: dose,
          note: note,
          startDate: todayISO(),
          createdAt: new Date().toISOString(),
        });
      }
      saveUserData(state.username, data);
      e.target.reset();
      closeModal();
      renderAll();
    });

    $("#medications-list").addEventListener("click", function (e) {
      var delBtn = e.target.closest && e.target.closest("[data-delete-med]");
      var editBtn = e.target.closest && e.target.closest("[data-edit-med]");
      if (delBtn && delBtn.getAttribute("data-delete-med")) {
        var id = delBtn.getAttribute("data-delete-med");
        if (!confirm("Удалить это лекарство?")) return;
        var data = getUserData(state.username);
        data.medications = data.medications.filter(function (m) {
          return m.id !== id;
        });
        data.history = data.history.filter(function (h) {
          return h.medicationId !== id;
        });
        saveUserData(state.username, data);
        renderAll();
      }
      if (editBtn && editBtn.getAttribute("data-edit-med")) {
        var eid = editBtn.getAttribute("data-edit-med");
        var d = getUserData(state.username);
        var med = d.medications.find(function (m) {
          return m.id === eid;
        });
        if (!med) return;
        var form = $("#form-medication");
        if (!form) return;
        if (form.elements.editId) form.elements.editId.value = med.id;
        form.elements.medicationName.value = med.name || "";
        form.elements.times.value = med.times && med.times.length ? med.times.join(", ") : "";
        if (form.elements.dose) form.elements.dose.value = med.dose || "";
        if (form.elements.note) form.elements.note.value = med.note || "";
        setModalMode(true);
        openModal();
      }
    });

    // === НОВЫЙ БЛОК: Обработчик кнопок "Принято / Не принято" ===
    var todayContainer = $("#today-schedule");
    if (todayContainer) {
      todayContainer.addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest("[data-action]");
        if (!btn || !state.username) return;
        
        var action = btn.getAttribute("data-action");
        var medId = btn.getAttribute("data-med-id");
        var time = btn.getAttribute("data-time");
        var medName = decodeURIComponent(btn.getAttribute("data-med-name") || "");
        var dose = decodeURIComponent(btn.getAttribute("data-dose") || "");
        var date = todayISO();
        
        upsertHistory(state.username, medId, medName, date, time, action);
        
        renderTodaySchedule();
        renderCalendar();
        renderHistory();
        
        btn.style.transform = "scale(0.95)";
        setTimeout(function() { btn.style.transform = ""; }, 150);
      });
    }

    $("#cal-prev").addEventListener("click", function () {
      state.calMonth--;
      if (state.calMonth < 0) {
        state.calMonth = 11;
        state.calYear--;
      }
      renderCalendar();
    });

    $("#cal-next").addEventListener("click", function () {
      state.calMonth++;
      if (state.calMonth > 11) {
        state.calMonth = 0;
        state.calYear++;
      }
      renderCalendar();
    });

    var calGrid = $("#calendar-grid");
    if (calGrid) {
      calGrid.addEventListener("click", function (e) {
        var cell = e.target && e.target.closest && e.target.closest("[data-iso]");
        if (!cell) return;
        var iso = cell.getAttribute("data-iso");
        if (!iso) return;
        state.selectedDate = iso;
        renderCalendar();
      });
    }

    var historyFilter = $("#history-filter");
    if (historyFilter) {
      historyFilter.addEventListener("change", function () {
        renderHistory();
      });
    }

    var formA11y = $("#form-accessibility");
    if (formA11y) {
      formA11y.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!state.username) return;
        saveAccessibilityFromDom();
        var st = $("#accessibility-status");
        if (st) {
          st.textContent = "Оформление сохранено.";
          st.hidden = false;
        }
      });
      formA11y.addEventListener("change", function () {
        if (!state.username) return;
        saveAccessibilityFromDom();
      });
    }

    var btnQrPhone = $("#btn-update-qr");
    if (btnQrPhone) {
      btnQrPhone.addEventListener("click", function () {
        var url = qrUrlForPhone();
        if (!url) {
          alert("Введите IP из PowerShell (например 10.30.221.125)");
          var ipEl = $("#settings-lan-ip");
          if (ipEl) ipEl.focus();
          return;
        }
        renderSettingsQr(url);
      });
    }
    var btnQrPc = $("#btn-qr-this-pc");
    if (btnQrPc) {
      btnQrPc.addEventListener("click", function () {
        renderSettingsQr(getDefaultIndexUrl());
      });
    }
    var lanIpEl = $("#settings-lan-ip");
    if (lanIpEl) {
      lanIpEl.addEventListener("change", function () {
        saveLanIp(lanIpEl.value);
      });
    }
  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
// ==================== ПОВТОРНЫЕ УВЕДОМЛЕНИЯ ====================

// Отправка уведомления с повтором (если пользователь не принял лекарство)
function scheduleReminderWithRetry(medication, delayMinutes = 5) {
    const reminderId = medication.id;
    let attempts = 0;
    const maxAttempts = 3; // Максимум 3 попытки
    
    function sendNotification() {
        // Если достигли макс. попыток — останавливаемся
        if (attempts >= maxAttempts) return;
        
        // Проверяем, принято ли лекарство
        const isTaken = checkIfTaken(reminderId);
        if (isTaken) return;
        
        // Отправляем уведомление (если разрешение получено)
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('💊 Время приёма лекарства!', {
                body: `${medication.name} — ${medication.dosage}`,
                icon: '/icon.png',
                requireInteraction: true, // Уведомление не исчезнет само
                tag: reminderId // Уникальный идентификатор
            });
            
            attempts++;
            
            // Планируем повтор через N минут
            setTimeout(sendNotification, delayMinutes * 60 * 1000);
        }
    }
    
    // Запускаем первое уведомление
    sendNotification();
}

// Проверка: принято ли лекарство (по истории в localStorage)
function checkIfTaken(reminderId) {
    const history = JSON.parse(localStorage.getItem('medReminder_history') || '[]');
    
    return history.some(record => 
        record.reminderId === reminderId && 
        record.status === 'taken' &&
        // Проверяем, что отметка сделана в последние 10 минут
        new Date(record.time) > new Date(Date.now() - 10 * 60 * 1000)
    );
}

// ==================== ИНТЕГРАЦИЯ ====================

// Вызывайте эту функцию при добавлении препарата:
function addMedication(name, dosage, time) {
    const medication = {
        id: Date.now().toString(), // Уникальный ID
        name: name,
        dosage: dosage,
        time: time,
        createdAt: new Date().toISOString()
    };
    
    // Сохраняем препарат в расписание
    saveMedication(medication);
    
    // 🔄 Планируем уведомление с повтором (через 5 минут)
    scheduleReminderWithRetry(medication, 5);
    
    alert(`✅ Препарат "${name}" добавлен в расписание!`);
    return medication;
}

// ==================== ДОПОЛНИТЕЛЬНО: Запрос разрешения на уведомления ====================

// Вызовите эту функцию при старте приложения или по кнопке
function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('✅ Разрешение на уведомления получено');
            } else {
                console.log('⚠️ Уведомления заблокированы пользователем');
            }
        });
    }
}