(function () {
  "use strict";

  var STORAGE_KEY = "btc-alerts-state-v1";
  var TG_STORAGE_KEY = "btc-alerts-tg-v1";
  var VOUCHER_STORAGE_KEY = "btc-alerts-vouchers-v1";
  var VOUCHER_LEVERAGE = 20;
  var POLL_MS = 5000;
  var SYMBOL = "BTCUSDT";
  var PRICE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=" + SYMBOL;
  var TG_RELAY_URL = "https://btc-alerts-relay.antonyksenua.workers.dev";

  var state = loadState();
  var tgConfig = loadTgConfig();
  var vouchers = loadVouchers();
  var currentPrice = null;
  var audioCtx = null;

  var els = {
    body: document.getElementById("accounts-body"),
    addBtn: document.getElementById("btn-add"),
    soundBtn: document.getElementById("btn-sound-unlock"),
    currentPrice: document.getElementById("current-price"),
    chartPrice: document.getElementById("chart-price"),
    statusDot: document.getElementById("price-status"),
    lastUpdated: document.getElementById("last-updated"),
    tgChatId: document.getElementById("tg-chatid"),
    tgSaveBtn: document.getElementById("btn-tg-save"),
    tgTestBtn: document.getElementById("btn-tg-test"),
    tgStatus: document.getElementById("tg-status"),
    vouchersGrid: document.getElementById("vouchers-grid")
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.accounts)) return parsed;
      }
    } catch (e) {}
    return { accounts: [], nextAccount: 111 };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadTgConfig() {
    try {
      var raw = localStorage.getItem(TG_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { chatId: "" };
  }

  function saveTgConfig() {
    localStorage.setItem(TG_STORAGE_KEY, JSON.stringify(tgConfig));
  }

  function defaultVouchers() {
    return [
      { id: "v25", amount: 25, entryPrice: null, alertProfit: null, armed: true, triggered: false },
      { id: "v50", amount: 50, entryPrice: null, alertProfit: null, armed: true, triggered: false }
    ];
  }

  function loadVouchers() {
    try {
      var raw = localStorage.getItem(VOUCHER_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 2) return parsed;
      }
    } catch (e) {}
    return defaultVouchers();
  }

  function saveVouchers() {
    localStorage.setItem(VOUCHER_STORAGE_KEY, JSON.stringify(vouchers));
  }

  function voucherPnl(v) {
    if (v.entryPrice === null || currentPrice === null) return null;
    var positionBtc = (v.amount * VOUCHER_LEVERAGE) / v.entryPrice;
    return positionBtc * (currentPrice - v.entryPrice);
  }

  function sendTelegramMessage(text) {
    if (!tgConfig.chatId) return Promise.resolve(false);
    return fetch(TG_RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: tgConfig.chatId, text: text })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.description || "Telegram API error");
        return true;
      });
  }

  function addAccount() {
    state.accounts.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      account: state.nextAccount,
      target: null,
      armed: true,
      triggered: false
    });
    state.nextAccount += 1;
    saveState();
    render();
  }

  function deleteAccount(id) {
    state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
    saveState();
    render();
    updateAlarmLoop();
  }

  function setAccountNumber(id, value) {
    var acc = findAccount(id);
    if (!acc) return;
    acc.account = value;
    saveState();
  }

  function setTarget(id, value) {
    var acc = findAccount(id);
    if (!acc) return;
    var num = value === "" ? null : parseFloat(value);
    acc.target = isNaN(num) ? null : num;
    acc.armed = true;
    acc.triggered = false;
    saveState();
    render();
    updateAlarmLoop();
  }

  function acknowledge(id) {
    var acc = findAccount(id);
    if (!acc) return;
    acc.triggered = false;
    acc.armed = !(currentPrice !== null && acc.target !== null && currentPrice >= acc.target);
    saveState();
    render();
    updateAlarmLoop();
  }

  function findAccount(id) {
    for (var i = 0; i < state.accounts.length; i++) {
      if (state.accounts[i].id === id) return state.accounts[i];
    }
    return null;
  }

  function render() {
    els.body.innerHTML = "";
    state.accounts.forEach(function (acc) {
      var tr = document.createElement("tr");
      if (acc.triggered) tr.className = "triggered";

      var tdAccount = document.createElement("td");
      var accInput = document.createElement("input");
      accInput.type = "text";
      accInput.className = "account-input";
      accInput.value = acc.account;
      accInput.addEventListener("change", function () {
        setAccountNumber(acc.id, accInput.value);
      });
      tdAccount.appendChild(accInput);

      var tdTarget = document.createElement("td");
      var targetInput = document.createElement("input");
      targetInput.type = "number";
      targetInput.step = "0.01";
      targetInput.placeholder = "напр. 65000";
      targetInput.value = acc.target !== null ? acc.target : "";
      targetInput.addEventListener("change", function () {
        setTarget(acc.id, targetInput.value);
      });
      tdTarget.appendChild(targetInput);

      var tdStatus = document.createElement("td");
      var statusSpan = document.createElement("span");
      statusSpan.className = "status-cell";
      if (acc.target === null) {
        statusSpan.textContent = "не задано";
      } else if (acc.triggered) {
        statusSpan.textContent = "🔔 сработало!";
        statusSpan.className += " triggered";
      } else {
        statusSpan.textContent = acc.armed ? "ожидание" : "ожидание (сброс)";
        statusSpan.className += " armed";
      }
      tdStatus.appendChild(statusSpan);

      var tdActions = document.createElement("td");
      var actionsWrap = document.createElement("div");
      actionsWrap.className = "row-actions";

      var bellBtn = document.createElement("button");
      bellBtn.className = "btn-icon" + (acc.triggered ? " ringing" : "");
      bellBtn.textContent = acc.triggered ? "🔕" : "🔔";
      bellBtn.title = acc.triggered ? "Остановить звук" : "Пока не сработало";
      bellBtn.disabled = !acc.triggered;
      bellBtn.addEventListener("click", function () {
        acknowledge(acc.id);
      });

      var delBtn = document.createElement("button");
      delBtn.className = "btn-icon btn-delete";
      delBtn.textContent = "✕";
      delBtn.title = "Удалить аккаунт";
      delBtn.addEventListener("click", function () {
        deleteAccount(acc.id);
      });

      actionsWrap.appendChild(bellBtn);
      actionsWrap.appendChild(delBtn);
      tdActions.appendChild(actionsWrap);

      tr.appendChild(tdAccount);
      tr.appendChild(tdTarget);
      tr.appendChild(tdStatus);
      tr.appendChild(tdActions);
      els.body.appendChild(tr);
    });
  }

  function acknowledgeVoucher(id) {
    var v = vouchers.filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    var pnl = voucherPnl(v);
    v.triggered = false;
    v.armed = !(pnl !== null && v.alertProfit !== null && pnl >= v.alertProfit);
    saveVouchers();
    renderVouchers();
    updateAlarmLoop();
  }

  function renderVouchers() {
    els.vouchersGrid.innerHTML = "";
    vouchers.forEach(function (v) {
      var card = document.createElement("div");
      card.className = "voucher-card" + (v.triggered ? " triggered" : "");

      var h3 = document.createElement("h3");
      h3.textContent = "Ваучер " + v.amount + "$";
      var badge = document.createElement("span");
      badge.className = "voucher-badge";
      badge.textContent = VOUCHER_LEVERAGE + "x Long";
      h3.appendChild(badge);
      card.appendChild(h3);

      var entryField = document.createElement("div");
      entryField.className = "voucher-field";
      var entryLabel = document.createElement("label");
      entryLabel.textContent = "Цена открытия, $";
      var entryInput = document.createElement("input");
      entryInput.type = "number";
      entryInput.step = "0.01";
      entryInput.placeholder = "напр. 63000";
      entryInput.value = v.entryPrice !== null ? v.entryPrice : "";
      entryInput.addEventListener("change", function () {
        var num = parseFloat(entryInput.value);
        v.entryPrice = isNaN(num) ? null : num;
        v.armed = true;
        v.triggered = false;
        saveVouchers();
        renderVouchers();
        updateAlarmLoop();
      });
      entryField.appendChild(entryLabel);
      entryField.appendChild(entryInput);
      card.appendChild(entryField);

      var alertField = document.createElement("div");
      alertField.className = "voucher-field";
      var alertLabel = document.createElement("label");
      alertLabel.textContent = "Алерт при прибыли, $";
      var alertInput = document.createElement("input");
      alertInput.type = "number";
      alertInput.step = "0.01";
      alertInput.placeholder = "напр. 15";
      alertInput.value = v.alertProfit !== null ? v.alertProfit : "";
      alertInput.addEventListener("change", function () {
        var num = parseFloat(alertInput.value);
        v.alertProfit = isNaN(num) ? null : num;
        v.armed = true;
        v.triggered = false;
        saveVouchers();
        renderVouchers();
        updateAlarmLoop();
      });
      alertField.appendChild(alertLabel);
      alertField.appendChild(alertInput);
      card.appendChild(alertField);

      var pnl = voucherPnl(v);
      var pnlEl = document.createElement("div");
      if (pnl === null) {
        pnlEl.className = "voucher-pnl";
        pnlEl.textContent = "PnL: —";
      } else {
        pnlEl.className = "voucher-pnl " + (pnl >= 0 ? "pos" : "neg");
        var pnlPct = (pnl / v.amount) * 100;
        pnlEl.textContent = (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2) + " (" + (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%)";
      }
      card.appendChild(pnlEl);

      var statusRow = document.createElement("div");
      statusRow.className = "voucher-status-row";
      var statusSpan = document.createElement("span");
      statusSpan.className = "status-cell";
      if (v.entryPrice === null || v.alertProfit === null) {
        statusSpan.textContent = "заполните поля";
      } else if (v.triggered) {
        statusSpan.textContent = "🔔 сработало!";
        statusSpan.className += " triggered";
      } else {
        statusSpan.textContent = v.armed ? "ожидание" : "ожидание (сброс)";
        statusSpan.className += " armed";
      }
      statusRow.appendChild(statusSpan);

      var bellBtn = document.createElement("button");
      bellBtn.className = "btn-icon" + (v.triggered ? " ringing" : "");
      bellBtn.textContent = v.triggered ? "🔕" : "🔔";
      bellBtn.title = v.triggered ? "Остановить звук" : "Пока не сработало";
      bellBtn.disabled = !v.triggered;
      bellBtn.addEventListener("click", function () {
        acknowledgeVoucher(v.id);
      });
      statusRow.appendChild(bellBtn);

      card.appendChild(statusRow);
      els.vouchersGrid.appendChild(card);
    });
  }

  // ---- Audio alarm (Web Audio API beep loop, no external file needed) ----

  var sirenOsc = null;
  var sirenLfo = null;

  function ensureAudio() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function startSiren() {
    if (sirenOsc) return; // already ringing
    ensureAudio();

    var compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 16;
    compressor.connect(audioCtx.destination);

    // Two detuned sawtooth voices for a harsh, piercing alarm tone.
    var gain = audioCtx.createGain();
    gain.gain.value = 0.9;
    gain.connect(compressor);

    var osc = audioCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 880;

    var osc2 = audioCtx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 884; // slight detune adds a beating, harsher edge

    // Wailing siren sweep between two tones (classic alarm effect).
    var lfo = audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 2.4;
    var lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 340;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoGain.connect(osc2.frequency);

    osc.connect(gain);
    osc2.connect(gain);

    osc.start();
    osc2.start();
    lfo.start();

    sirenOsc = [osc, osc2, gain, compressor];
    sirenLfo = lfo;
  }

  function stopSiren() {
    if (!sirenOsc) return;
    sirenOsc[0].stop();
    sirenOsc[1].stop();
    sirenOsc[0].disconnect();
    sirenOsc[1].disconnect();
    sirenOsc[2].disconnect();
    sirenOsc[3].disconnect();
    sirenLfo.stop();
    sirenLfo.disconnect();
    sirenOsc = null;
    sirenLfo = null;
  }

  function anyTriggered() {
    return state.accounts.some(function (a) { return a.triggered; }) ||
      vouchers.some(function (v) { return v.triggered; });
  }

  function updateAlarmLoop() {
    if (anyTriggered()) {
      startSiren();
    } else {
      stopSiren();
    }
  }

  els.soundBtn.addEventListener("click", function () {
    ensureAudio();
    startSiren();
    setTimeout(updateAlarmLoop, 1200); // brief test burst, then follow the real trigger state
  });

  // ---- Telegram settings ----

  els.tgChatId.value = tgConfig.chatId || "";

  els.tgSaveBtn.addEventListener("click", function () {
    tgConfig.chatId = els.tgChatId.value.trim();
    saveTgConfig();
    els.tgStatus.textContent = "Сохранено.";
  });

  els.tgTestBtn.addEventListener("click", function () {
    tgConfig.chatId = els.tgChatId.value.trim();
    saveTgConfig();
    els.tgStatus.textContent = "Отправляю…";
    sendTelegramMessage("✅ Тестовое сообщение с BTC Price Alerts. Всё настроено верно.")
      .then(function (ok) {
        els.tgStatus.textContent = ok ? "Тестовое сообщение отправлено, проверьте Telegram." : "Заполните токен и Chat ID.";
      })
      .catch(function (err) {
        els.tgStatus.textContent = "Ошибка: " + err.message;
      });
  });

  // ---- Price polling ----

  function checkTriggers() {
    if (currentPrice === null) return;
    var changed = false;
    state.accounts.forEach(function (acc) {
      if (acc.target === null) return;
      if (!acc.triggered && acc.armed && currentPrice >= acc.target) {
        acc.triggered = true;
        acc.armed = false;
        changed = true;
        sendTelegramMessage(
          "🔔 BTC достиг цены срабатывания!\nАккаунт: " + acc.account +
          "\nЦель: $" + acc.target.toLocaleString("en-US") +
          "\nТекущая цена: $" + currentPrice.toLocaleString("en-US")
        ).catch(function () {});
      } else if (!acc.armed && !acc.triggered && currentPrice < acc.target) {
        acc.armed = true;
      }
    });
    if (changed) {
      saveState();
      render();
    }
    updateAlarmLoop();
  }

  function checkVoucherTriggers() {
    if (currentPrice === null) return;
    var changed = false;
    vouchers.forEach(function (v) {
      if (v.entryPrice === null || v.alertProfit === null) return;
      var pnl = voucherPnl(v);
      if (!v.triggered && v.armed && pnl >= v.alertProfit) {
        v.triggered = true;
        v.armed = false;
        changed = true;
        sendTelegramMessage(
          "🎯 Ваучер " + v.amount + "$ (BTC " + VOUCHER_LEVERAGE + "x Long) достиг цели по прибыли!\n" +
          "Цена входа: $" + v.entryPrice.toLocaleString("en-US") +
          "\nТекущая цена: $" + currentPrice.toLocaleString("en-US") +
          "\nPnL: $" + pnl.toFixed(2) + " (цель $" + v.alertProfit + ")"
        ).catch(function () {});
      } else if (!v.armed && !v.triggered && pnl < v.alertProfit) {
        v.armed = true;
      }
    });
    if (changed) saveVouchers();
    renderVouchers();
    updateAlarmLoop();
  }

  function fetchPrice() {
    fetch(PRICE_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("bad status " + res.status);
        return res.json();
      })
      .then(function (data) {
        var price = parseFloat(data.price);
        if (isNaN(price)) throw new Error("bad price");
        currentPrice = price;
        var priceText = "$" + price.toLocaleString("en-US", { maximumFractionDigits: 2 });
        els.currentPrice.textContent = priceText;
        els.chartPrice.textContent = priceText;
        els.statusDot.className = "status-dot ok";
        els.lastUpdated.textContent = "Обновлено: " + new Date().toLocaleTimeString();
        checkTriggers();
        checkVoucherTriggers();
      })
      .catch(function (err) {
        els.statusDot.className = "status-dot err";
        els.lastUpdated.textContent = "Ошибка соединения с Binance, повтор через " + (POLL_MS / 1000) + "с";
      });
  }

  els.addBtn.addEventListener("click", addAccount);

  render();
  renderVouchers();
  updateAlarmLoop();
  fetchPrice();
  setInterval(fetchPrice, POLL_MS);
})();
