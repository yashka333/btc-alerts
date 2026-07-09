(function () {
  "use strict";

  var TG_STORAGE_KEY = "btc-alerts-tg-v1";
  var VOUCHER_STORAGE_KEY = "btc-alerts-vouchers-v2";
  var VOUCHER_LEVERAGE = 20;
  var POLL_MS = 5000;
  var SYMBOL = "BTCUSDT";
  var PRICE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=" + SYMBOL;
  var TG_RELAY_URL = "https://btc-alerts-relay.antonyksenua.workers.dev";

  var tgConfig = loadTgConfig();
  var vouchers = loadVouchers();
  var currentPrice = null;
  var audioCtx = null;

  var els = {
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
      { id: "v25", amount: 25, nextRow: 1, rows: [] },
      { id: "v50", amount: 50, nextRow: 1, rows: [] }
    ];
  }

  function loadVouchers() {
    try {
      var raw = localStorage.getItem(VOUCHER_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 2 && Array.isArray(parsed[0].rows)) return parsed;
      }
    } catch (e) {}
    return defaultVouchers();
  }

  function saveVouchers() {
    localStorage.setItem(VOUCHER_STORAGE_KEY, JSON.stringify(vouchers));
  }

  function rowPnl(voucherAmount, row) {
    if (row.entryPrice === null || currentPrice === null) return null;
    var positionBtc = (voucherAmount * VOUCHER_LEVERAGE) / row.entryPrice;
    var diff = row.side === "short" ? (row.entryPrice - currentPrice) : (currentPrice - row.entryPrice);
    return positionBtc * diff;
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

  function findVoucher(voucherId) {
    return vouchers.filter(function (v) { return v.id === voucherId; })[0];
  }

  function findRow(voucherId, rowId) {
    var v = findVoucher(voucherId);
    if (!v) return null;
    var row = v.rows.filter(function (r) { return r.id === rowId; })[0];
    return row ? { voucher: v, row: row } : null;
  }

  function addRow(voucherId) {
    var v = findVoucher(voucherId);
    if (!v) return;
    v.rows.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      account: v.nextRow,
      side: "long",
      entryPrice: null,
      alertProfit: null,
      armed: true,
      triggered: false
    });
    v.nextRow += 1;
    saveVouchers();
    renderVouchers();
  }

  function deleteRow(voucherId, rowId) {
    var v = findVoucher(voucherId);
    if (!v) return;
    v.rows = v.rows.filter(function (r) { return r.id !== rowId; });
    saveVouchers();
    renderVouchers();
    updateAlarmLoop();
  }

  function acknowledgeRow(voucherId, rowId) {
    var found = findRow(voucherId, rowId);
    if (!found) return;
    var pnl = rowPnl(found.voucher.amount, found.row);
    found.row.triggered = false;
    found.row.armed = !(pnl !== null && found.row.alertProfit !== null && pnl >= found.row.alertProfit);
    saveVouchers();
    renderVouchers();
    updateAlarmLoop();
  }

  function renderVouchers() {
    els.vouchersGrid.innerHTML = "";
    vouchers.forEach(function (v) {
      var block = document.createElement("div");
      block.className = "voucher-block";

      var head = document.createElement("div");
      head.className = "table-head-row";
      var h3 = document.createElement("h3");
      h3.textContent = "Ваучер " + v.amount + "$";
      var badge = document.createElement("span");
      badge.className = "voucher-badge";
      badge.textContent = "BTC " + VOUCHER_LEVERAGE + "x";
      h3.appendChild(badge);
      head.appendChild(h3);
      block.appendChild(head);

      var table = document.createElement("table");
      table.className = "voucher-table";
      var thead = document.createElement("thead");
      thead.innerHTML =
        "<tr><th>Аккаунт</th><th>Направление</th><th>Цена открытия, $</th><th>Алерт, $</th><th>PnL</th><th>Статус</th><th></th></tr>";
      table.appendChild(thead);

      var tbody = document.createElement("tbody");

      v.rows.forEach(function (row) {
        var tr = document.createElement("tr");
        if (row.triggered) tr.className = "triggered";

        var tdAccount = document.createElement("td");
        var accInput = document.createElement("input");
        accInput.type = "text";
        accInput.className = "account-input";
        accInput.value = row.account;
        accInput.addEventListener("change", function () {
          row.account = accInput.value;
          saveVouchers();
        });
        tdAccount.appendChild(accInput);

        var tdSide = document.createElement("td");
        var sideSelect = document.createElement("select");
        sideSelect.className = "side-select";
        ["long", "short"].forEach(function (val) {
          var opt = document.createElement("option");
          opt.value = val;
          opt.textContent = val === "long" ? "Long" : "Short";
          if ((row.side || "long") === val) opt.selected = true;
          sideSelect.appendChild(opt);
        });
        sideSelect.addEventListener("change", function () {
          row.side = sideSelect.value;
          row.armed = true;
          row.triggered = false;
          saveVouchers();
          renderVouchers();
          updateAlarmLoop();
        });
        tdSide.appendChild(sideSelect);

        var tdEntry = document.createElement("td");
        var entryInput = document.createElement("input");
        entryInput.type = "number";
        entryInput.step = "0.01";
        entryInput.placeholder = "напр. 63000";
        entryInput.value = row.entryPrice !== null ? row.entryPrice : "";
        entryInput.addEventListener("change", function () {
          var num = parseFloat(entryInput.value);
          row.entryPrice = isNaN(num) ? null : num;
          row.armed = true;
          row.triggered = false;
          saveVouchers();
          renderVouchers();
          updateAlarmLoop();
        });
        tdEntry.appendChild(entryInput);

        var tdAlert = document.createElement("td");
        var alertInput = document.createElement("input");
        alertInput.type = "number";
        alertInput.step = "0.01";
        alertInput.placeholder = "напр. 15";
        alertInput.value = row.alertProfit !== null ? row.alertProfit : "";
        alertInput.addEventListener("change", function () {
          var num = parseFloat(alertInput.value);
          row.alertProfit = isNaN(num) ? null : num;
          row.armed = true;
          row.triggered = false;
          saveVouchers();
          renderVouchers();
          updateAlarmLoop();
        });
        tdAlert.appendChild(alertInput);

        var tdPnl = document.createElement("td");
        var pnl = rowPnl(v.amount, row);
        if (pnl === null) {
          tdPnl.textContent = "—";
        } else {
          var pnlPct = (pnl / v.amount) * 100;
          tdPnl.className = pnl >= 0 ? "voucher-pnl pos" : "voucher-pnl neg";
          tdPnl.textContent = (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2) + " (" + (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(1) + "%)";
        }
        tdPnl.style.fontSize = "13px";

        var tdStatus = document.createElement("td");
        var statusSpan = document.createElement("span");
        statusSpan.className = "status-cell";
        if (row.entryPrice === null || row.alertProfit === null) {
          statusSpan.textContent = "заполните поля";
        } else if (row.triggered) {
          statusSpan.textContent = "🔔 сработало!";
          statusSpan.className += " triggered";
        } else {
          statusSpan.textContent = row.armed ? "ожидание" : "ожидание (сброс)";
          statusSpan.className += " armed";
        }
        tdStatus.appendChild(statusSpan);

        var tdActions = document.createElement("td");
        var actionsWrap = document.createElement("div");
        actionsWrap.className = "row-actions";

        var bellBtn = document.createElement("button");
        bellBtn.className = "btn-icon" + (row.triggered ? " ringing" : "");
        bellBtn.textContent = row.triggered ? "🔕" : "🔔";
        bellBtn.title = row.triggered ? "Остановить звук" : "Пока не сработало";
        bellBtn.disabled = !row.triggered;
        bellBtn.addEventListener("click", function () {
          acknowledgeRow(v.id, row.id);
        });

        var delBtn = document.createElement("button");
        delBtn.className = "btn-icon btn-delete";
        delBtn.textContent = "✕";
        delBtn.title = "Удалить";
        delBtn.addEventListener("click", function () {
          deleteRow(v.id, row.id);
        });

        actionsWrap.appendChild(bellBtn);
        actionsWrap.appendChild(delBtn);
        tdActions.appendChild(actionsWrap);

        tr.appendChild(tdAccount);
        tr.appendChild(tdSide);
        tr.appendChild(tdEntry);
        tr.appendChild(tdAlert);
        tr.appendChild(tdPnl);
        tr.appendChild(tdStatus);
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      block.appendChild(table);

      var addBtn = document.createElement("button");
      addBtn.className = "btn-primary";
      addBtn.textContent = "+ Добавить";
      addBtn.addEventListener("click", function () {
        addRow(v.id);
      });
      block.appendChild(addBtn);

      els.vouchersGrid.appendChild(block);
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
    return vouchers.some(function (v) {
      return v.rows.some(function (r) { return r.triggered; });
    });
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
        els.tgStatus.textContent = ok ? "Тестовое сообщение отправлено, проверьте Telegram." : "Заполните Chat ID.";
      })
      .catch(function (err) {
        els.tgStatus.textContent = "Ошибка: " + err.message;
      });
  });

  // ---- Price polling ----

  function checkVoucherTriggers() {
    if (currentPrice === null) return;
    var changed = false;
    vouchers.forEach(function (v) {
      v.rows.forEach(function (row) {
        if (row.entryPrice === null || row.alertProfit === null) return;
        var pnl = rowPnl(v.amount, row);
        if (!row.triggered && row.armed && pnl >= row.alertProfit) {
          row.triggered = true;
          row.armed = false;
          changed = true;
          sendTelegramMessage(
            "🎯 Ваучер " + v.amount + "$ (BTC " + VOUCHER_LEVERAGE + "x " + (row.side === "short" ? "Short" : "Long") + "), аккаунт " + row.account + " достиг цели по прибыли!\n" +
            "Цена входа: $" + row.entryPrice.toLocaleString("en-US") +
            "\nТекущая цена: $" + currentPrice.toLocaleString("en-US") +
            "\nPnL: $" + pnl.toFixed(2) + " (цель $" + row.alertProfit + ")"
          ).catch(function () {});
        } else if (!row.armed && !row.triggered && pnl < row.alertProfit) {
          row.armed = true;
        }
      });
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
        checkVoucherTriggers();
      })
      .catch(function (err) {
        els.statusDot.className = "status-dot err";
        els.lastUpdated.textContent = "Ошибка соединения с Binance, повтор через " + (POLL_MS / 1000) + "с";
      });
  }

  renderVouchers();
  updateAlarmLoop();
  fetchPrice();
  setInterval(fetchPrice, POLL_MS);
})();
