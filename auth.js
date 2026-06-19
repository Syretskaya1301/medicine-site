(function () {
  "use strict";

  var STORAGE_USERS = "medReminder_users";
  var STORAGE_PREFIX = "medReminder_data_";
  var SESSION_KEY = "medReminder_session";

  function normalizeUsername(raw) {
    var s = String(raw || "").trim();
    s = s.replace(/\s+/g, " ");
    if (!s) return "";
    if (s.length > 60) s = s.slice(0, 60);
    return s;
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

  function defaultProfile() {
    return {
      reminderPhone: "",
      reminderApiUrl:
        typeof window !== "undefined" &&
        window.location &&
        (window.location.protocol === "http:" || window.location.protocol === "https:")
          ? window.location.origin
          : "http://localhost:3780",
      syncSecret: "",
      fontScale: "normal",
    };
  }

  function saveUserData(username, data) {
    localStorage.setItem(STORAGE_PREFIX + username, JSON.stringify(data));
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setSession(username) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ username: username }));
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function $all(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  function switchAuthTab(which) {
    var loginForm = $("#form-login");
    var regForm = $("#form-register");
    $all("[data-auth-tab]").forEach(function (btn) {
      var active = btn.getAttribute("data-auth-tab") === which;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    loginForm.hidden = which !== "login";
    regForm.hidden = which !== "register";
    $("#login-error").hidden = true;
    $("#register-error").hidden = true;
  }

  function goToApp() {
    window.location.href = "app.html";
  }

  function normalizeEmail(raw) {
    var s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    // Базовая проверка — без фанатизма
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return "";
    return s;
  }

  function migrateLegacyPhoneUsersToUsername(users) {
    // Раньше ключом был телефон. Теперь ключ — username.
    // Пытаемся мигрировать так, чтобы старые данные в браузере не пропали.
    var changed = false;
    var nextUsers = {};
    Object.keys(users || {}).forEach(function (k) {
      var u = users[k];
      if (!u) return;
      if (u && u.__v === 2) {
        nextUsers[k] = u;
        return;
      }
      // legacy: k = phone
      var base = normalizeUsername((u && u.name) || "");
      if (!base) base = "Пользователь";
      var username = base;
      var i = 1;
      while (nextUsers[username]) {
        i++;
        username = base + " " + i;
      }
      nextUsers[username] = {
        __v: 2,
        password: u.password || "",
        email: u.email || "",
        name: base,
        legacyPhone: k,
      };
      // перенесём userData: medReminder_data_<phone> -> medReminder_data_<username>
      try {
        var legacyData = localStorage.getItem(STORAGE_PREFIX + k);
        if (legacyData && !localStorage.getItem(STORAGE_PREFIX + username)) {
          localStorage.setItem(STORAGE_PREFIX + username, legacyData);
        }
      } catch (e) {}
      changed = true;
    });
    if (changed) return nextUsers;
    // если не изменяли — пометим v2 без копирования
    Object.keys(nextUsers).forEach(function (uk) {
      if (nextUsers[uk] && nextUsers[uk].__v !== 2) {
        nextUsers[uk].__v = 2;
        changed = true;
      }
    });
    return changed ? nextUsers : users;
  }

  function init() {
    // миграция старого формата (по телефону)
    var users0 = getUsers();
    var users2 = migrateLegacyPhoneUsersToUsername(users0);
    if (users2 !== users0) saveUsers(users2);

    var sess = getSession();
    if (sess && sess.username && getUsers()[sess.username]) {
      window.location.replace("app.html");
      return;
    }

    $all("[data-auth-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchAuthTab(btn.getAttribute("data-auth-tab"));
      });
    });

    $("#form-login").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var username = normalizeUsername(fd.get("username"));
      var password = String(fd.get("password") || "");
      var err = $("#login-error");
      if (!username) {
        err.textContent = "Введите имя пользователя.";
        err.hidden = false;
        return;
      }
      var users = getUsers();
      if (!users[username] || users[username].password !== password) {
        err.textContent = "Неверное имя пользователя или пароль.";
        err.hidden = false;
        return;
      }
      setSession(username);
      err.hidden = true;
      goToApp();
    });

    $("#form-register").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var username = normalizeUsername(fd.get("username"));
      var email = normalizeEmail(fd.get("email") || "");
      var password = String(fd.get("password") || "");
      var password2 = String(fd.get("password2") || "");
      var err = $("#register-error");
      if (!username) {
        err.textContent = "Введите имя пользователя.";
        err.hidden = false;
        return;
      }
      if (!email) {
        err.textContent = "Введите корректный email.";
        err.hidden = false;
        return;
      }
      var users = getUsers();
      if (users[username]) {
        err.textContent = "Это имя уже занято. Выберите другое.";
        err.hidden = false;
        return;
      }
      if (password !== password2) {
        err.textContent = "Пароли не совпадают.";
        err.hidden = false;
        return;
      }
      if (password.length < 8) {
        err.textContent = "Пароль не короче 8 символов.";
        err.hidden = false;
        return;
      }
      users[username] = { __v: 2, password: password, name: username, email: email };
      saveUsers(users);
      saveUserData(username, { medications: [], history: [], profile: defaultProfile() });
      setSession(username);
      err.hidden = true;
      goToApp();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();





// === ФУНКЦИИ ПЕРЕКЛЮЧЕНИЯ ФОРМ ===

// Показать форму восстановления пароля
function showResetPasswordForm() {
  const mainContent = document.getElementById('authMainContent');
  const resetContent = document.getElementById('resetPasswordContent');
  
  if (mainContent && resetContent) {
    mainContent.classList.add('hidden');
    resetContent.hidden = false;
    
    setTimeout(() => {
      document.getElementById('resetUsername').focus();
    }, 100);
  }
}

// Вернуться к форме входа
function backToLogin() {
  const mainContent = document.getElementById('authMainContent');
  const resetContent = document.getElementById('resetPasswordContent');
  
  if (mainContent && resetContent) {
    resetContent.hidden = true;
    mainContent.classList.remove('hidden');
    
    // Очищаем форму восстановления
    const resetForm = document.getElementById('resetPasswordForm');
    if (resetForm) resetForm.reset();
    
    const resetError = document.getElementById('resetError');
    const resetSuccess = document.getElementById('resetSuccess');
    if (resetError) resetError.hidden = true;
    if (resetSuccess) resetSuccess.hidden = true;
  }
}

// === ОБРАБОТКА ФОРМЫ ВОССТАНОВЛЕНИЯ ===

document.getElementById('resetPasswordForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  
  const username = (function () {
    const raw = document.getElementById('resetUsername')?.value;
    return (typeof normalizeUsername === "function" ? normalizeUsername(raw) : String(raw || "").trim());
  })();
  const newPassword = document.getElementById('newPassword')?.value;
  const confirmPassword = document.getElementById('confirmPassword')?.value;
  
  const errorEl = document.getElementById('resetError');
  const successEl = document.getElementById('resetSuccess');
  
  // Сброс сообщений
  if (errorEl) errorEl.hidden = true;
  if (successEl) successEl.hidden = true;
  
  // Валидация
  if (!username) {
    if (errorEl) {
      errorEl.textContent = 'Введите имя пользователя';
      errorEl.hidden = false;
    }
    return;
  }
  
  // Должно совпадать с правилами регистрации/входа
  if (newPassword && newPassword.length < 8) {
    if (errorEl) {
      errorEl.textContent = 'Пароль должен быть не менее 8 символов';
      errorEl.hidden = false;
    }
    return;
  }
  
  if (newPassword !== confirmPassword) {
    if (errorEl) {
      errorEl.textContent = 'Пароли не совпадают';
      errorEl.hidden = false;
    }
    return;
  }
  
  // Получаем пользователей из localStorage
  const users = JSON.parse(localStorage.getItem('medReminder_users') || '{}');
  
  // Проверяем, существует ли пользователь
  if (!users[username]) {
    if (errorEl) {
      errorEl.textContent = 'Пользователь не найден. Проверьте имя или зарегистрируйтесь.';
      errorEl.hidden = false;
    }
    return;
  }
  
  // Обновляем пароль
  if (typeof users[username] === "string") {
    // На всякий случай поддержим очень старый формат, если он встретится
    users[username] = { __v: 2, password: newPassword, name: username, email: "" };
  } else {
    users[username].password = newPassword;
    users[username].__v = users[username].__v || 2;
    users[username].name = users[username].name || username;
    users[username].updatedAt = new Date().toISOString();
  }
  localStorage.setItem('medReminder_users', JSON.stringify(users));
  
  // Показываем успех
  if (successEl) {
    successEl.textContent = '✓ Пароль успешно изменён! Теперь вы можете войти.';
    successEl.hidden = false;
  }
  
  // Очищаем форму
  if (document.getElementById('resetPasswordForm')) {
    document.getElementById('resetPasswordForm').reset();
  }
  
  // Возвращаемся ко входу через 2 секунды
  setTimeout(() => {
    backToLogin();
  }, 2000);
});

// === ДЕЛАЕМ ФУНКЦИИ ДОСТУПНЫМИ ИЗ HTML ===
window.showResetPasswordForm = showResetPasswordForm;
window.backToLogin = backToLogin;




// === ПЕРЕКЛЮЧЕНИЕ ВИДИМОСТИ ПАРОЛЯ ===
function togglePassword(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input || !button) return;
  
  if (input.type === 'password') {
    input.type = 'text';
    button.classList.add('is-active');
    button.setAttribute('aria-label', 'Скрыть пароль');
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
  } else {
    input.type = 'password';
    button.classList.remove('is-active');
    button.setAttribute('aria-label', 'Показать пароль');
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  }
}
window.togglePassword = togglePassword;