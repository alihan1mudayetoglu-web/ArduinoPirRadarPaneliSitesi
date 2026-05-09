(() => {
  const canvas = document.getElementById("radar");
  const ctx = canvas.getContext("2d");

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const angleText = document.getElementById("angleText");
  const timeText = document.getElementById("timeText");
  const holdText = document.getElementById("holdText");
  const netBadge = document.getElementById("netBadge");

  // Radar verileri
  let alarm = 0;
  let alarmAngle = 0;
  let lastUpdated = 0;

  // Tarama çizgisi
  let sweep = 40;
  let sweepDir = 1;

  const sweepMin = 40;
  const sweepMax = 140;
  const sweepSpeed = 0.55;
  const POLL_MS = 200;

  // HUD başlangıç
  holdText.textContent = "3.0s";

  // Canvas boyutlandırma
  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);

    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();

  // Derece → Radyan
  function degToRad(deg) {
    return deg * Math.PI / 180;
  }

  // Polar koordinat → X,Y
  function polarToXY(cx, cy, r, deg) {
    const rad = Math.PI - degToRad(deg);

    return {
      x: cx + r * Math.cos(rad),
      y: cy - r * Math.sin(rad)
    };
  }

  // Zaman formatı
  function nowStr(ts) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleTimeString();
  }

  // Arka plan efekti (alttaki yeşil parıltı)
  function drawBackground() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    const grad = ctx.createRadialGradient(
      w / 2,
      h * 0.85,
      50,
      w / 2,
      h * 0.85,
      Math.max(w, h)
    );

    grad.addColorStop(0, "rgba(60,255,140,0.08)");
    grad.addColorStop(0.55, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.75)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Radar ızgarası
  function drawGrid(cx, cy, R) {
    ctx.lineWidth = 1;

    // Yarım daireler
    for (let i = 1; i <= 4; i++) {
      const r = R * (i / 4);

      ctx.strokeStyle =
        i === 4
          ? "rgba(60,255,140,0.35)"
          : "rgba(60,255,140,0.18)";

      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, 0);
      ctx.stroke();
    }

    // Açısal çizgiler
    const rays = [30, 60, 90, 120, 150];

    rays.forEach(a => {
      ctx.strokeStyle =
        a === 90
          ? "rgba(60,255,140,0.38)"
          : "rgba(60,255,140,0.22)";

      const p = polarToXY(cx, cy, R, a);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });

    // Alt çizgi
    ctx.strokeStyle = "rgba(60,255,140,0.22)";
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.stroke();

    // Derece yazıları
    ctx.fillStyle = "rgba(60,255,140,0.8)";
    ctx.font = "600 16px ui-sans-serif, system-ui";

    [30, 60, 120, 150].forEach(a => {
      const p = polarToXY(cx, cy, R * 1.03, a);
      ctx.fillText(a + "°", p.x - 12, p.y);
    });

    // 90° üstte
    const top = polarToXY(cx, cy, R * 1.03, 90);
    ctx.fillText("90°", top.x - 18, top.y - 10);
  }

  // Tarama çizgisi
  function drawSweep(cx, cy, R) {
    // Hafif yeşil parlama
    const p = polarToXY(cx, cy, R, sweep);

    const glow = ctx.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      R
    );

    glow.addColorStop(0, "rgba(60,255,140,0.06)");
    glow.addColorStop(0.7, "rgba(60,255,140,0.02)");
    glow.addColorStop(1, "rgba(60,255,140,0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(
      cx,
      cy,
      R,
      Math.PI - degToRad(sweep - 8),
      Math.PI - degToRad(sweep + 8),
      true
    );
    ctx.closePath();
    ctx.fill();

    // Ana çizgi
    ctx.strokeStyle = "rgba(60,255,140,0.95)";
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // Uç noktası
    ctx.fillStyle = "rgba(60,255,140,0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Alarm çizgisi
  function drawAlarm(cx, cy, R) {
    if (!alarm) return;

    const p = polarToXY(cx, cy, R, alarmAngle);

    // Kırmızı çizgi
    ctx.strokeStyle = "rgba(255,60,60,0.95)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // Kırmızı nokta
    ctx.fillStyle = "rgba(255,60,60,0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Sol alt alarm bilgisi
    ctx.fillStyle = "rgba(255,60,60,0.95)";
    ctx.font = "800 18px ui-sans-serif, system-ui";
    ctx.fillText(`ALARM • ${alarmAngle}°`, 22, window.innerHeight - 22);
  }

  // Sol alt tarama bilgisi
  function drawBottomReadout() {
    // Alarm varsa alttaki yazı biraz yukarı çıksın
    const left = 22;
    const y = alarm ? window.innerHeight - 48 : window.innerHeight - 22;

    // Tarama açısı
    ctx.fillStyle = "rgba(60,255,140,0.9)";
    ctx.font = "800 22px ui-sans-serif, system-ui";
    ctx.fillText(`Sweep: ${Math.round(sweep)}°`, left, y);

    // Açıklama
    ctx.fillStyle = "rgba(235,255,245,0.75)";
    ctx.font = "600 14px ui-sans-serif, system-ui";
    ctx.fillText("Canvas Radar • /data", left, y - 24);
  }

  // Ana çizim fonksiyonu
  function draw() {
    // Daha koyu arka plan temizleme
    ctx.fillStyle = "rgba(6,8,12,0.28)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // Alt parlama efekti
    drawBackground();

    // Radar merkezi
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.84;
    const R = Math.min(
      window.innerWidth * 0.46,
      window.innerHeight * 0.72
    );

    // Radar çizimleri
    drawGrid(cx, cy, R);

    // Sweep hareketi
    sweep += sweepDir * sweepSpeed;

    if (sweep >= sweepMax) {
      sweep = sweepMax;
      sweepDir = -1;
    }

    if (sweep <= sweepMin) {
      sweep = sweepMin;
      sweepDir = 1;
    }

    // Çizimler
    drawSweep(cx, cy, R);
    drawAlarm(cx, cy, R);
    drawBottomReadout();

    requestAnimationFrame(draw);
  }

  // Sunucudan veri çekme
  async function poll() {
    try {
      const response = await fetch("/data", {
        cache: "no-store"
      });

      const d = await response.json();

      alarm = d.alarm ? 1 : 0;
      alarmAngle = d.angle || 0;
      lastUpdated = d.updated_at || 0;

      // HUD güncelleme
      if (alarm) {
        statusDot.classList.add("danger");
        statusText.textContent = "HAREKET VAR!";
        angleText.textContent = alarmAngle + "°";
      } else {
        statusDot.classList.remove("danger");
        statusText.textContent = "Hareket Yok";
        angleText.textContent = "—";
      }

      timeText.textContent = nowStr(lastUpdated);
      netBadge.textContent = "/data • 200ms";

    } catch (error) {
      netBadge.textContent = "Bağlantı yok";
    } finally {
      setTimeout(poll, POLL_MS);
    }
  }

  // Başlangıçta tamamen koyu ekran
  ctx.fillStyle = "rgba(6,8,12,1)";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  // Başlat
  draw();
  poll();
})();
