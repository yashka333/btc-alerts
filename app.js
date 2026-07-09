(function () {
  "use strict";

  var STORAGE_KEY = "btc-alerts-state-v1";
  var POLL_MS = 5000;
  var MAX_POINTS = 120;
  var SYMBOL = "BTCUSDT";
  var PRICE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=" + SYMBOL;
  var KLINES_URL = "https://api.binance.com/api/v3/klines?symbol=" + SYMBOL + "&interval=1m&limit=" + MAX_POINTS;

  var state = loadState();
  var priceHistory = [];
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
    canvas: document.getElementById("chart")
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
    return state.accounts.some(function (a) { return a.triggered; });
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
        priceHistory.push(price);
        if (priceHistory.length > MAX_POINTS) priceHistory.shift();
        drawChart();
        checkTriggers();
      })
      .catch(function (err) {
        els.statusDot.className = "status-dot err";
        els.lastUpdated.textContent = "Ошибка соединения с Binance, повтор через " + (POLL_MS / 1000) + "с";
      });
  }

  function fetchHistory() {
    return fetch(KLINES_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("bad status " + res.status);
        return res.json();
      })
      .then(function (klines) {
        // each kline: [openTime, open, high, low, close, volume, closeTime, ...]
        priceHistory = klines.map(function (k) { return parseFloat(k[4]); });
        drawChart();
      })
      .catch(function () {
        // history is a nice-to-have; live polling still works without it
      });
  }

  // ---- Chart (plain canvas line chart, no dependencies) ----

  function drawChart() {
    var canvas = els.canvas;
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (priceHistory.length < 2) return;

    var min = Math.min.apply(null, priceHistory);
    var max = Math.max.apply(null, priceHistory);
    if (min === max) { min -= 1; max += 1; }
    var pad = 10;

    function x(i) { return pad + (i / (priceHistory.length - 1)) * (w - pad * 2); }
    function y(v) { return h - pad - ((v - min) / (max - min)) * (h - pad * 2); }

    ctx.beginPath();
    priceHistory.forEach(function (v, i) {
      var px = x(i), py = y(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = "#f0b90b";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(x(priceHistory.length - 1), h - pad);
    ctx.lineTo(x(0), h - pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(240, 185, 11, 0.12)";
    ctx.fill();
  }

  els.addBtn.addEventListener("click", addAccount);

  render();
  updateAlarmLoop();
  fetchHistory().then(fetchPrice);
  setInterval(fetchPrice, POLL_MS);
})();
