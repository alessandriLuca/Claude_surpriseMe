// Effetti visivi: lucine della festa, coriandoli, emoji che volano.

export function drawLights() {
  const box = document.querySelector(".lights");
  if (!box) return;
  const w = 1200;
  const n = 26;
  const colors = ["#ffc43d", "#ff5d5d", "#4cc9f0", "#7cff6b", "#ff70a6", "#ffffff"];
  let bulbs = "";
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * (w / n);
    const t = x / w;
    // filo a festoni: due archi
    const y = 8 + Math.abs(Math.sin(t * Math.PI * 3)) * 22;
    const c = colors[i % colors.length];
    bulbs += `<g class="bulb" style="animation-delay:${(i % 5) * -0.45}s">
      <rect x="${x - 2}" y="${y - 4}" width="4" height="5" fill="#333"/>
      <ellipse cx="${x}" cy="${y + 6}" rx="5" ry="7" fill="${c}"/>
      <ellipse cx="${x}" cy="${y + 6}" rx="12" ry="12" fill="${c}" opacity=".18"/>
    </g>`;
  }
  let path = "M0 8";
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * w;
    const y = 8 + Math.abs(Math.sin((x / w) * Math.PI * 3)) * 22;
    path += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  box.innerHTML = `<svg viewBox="0 0 ${w} 54" preserveAspectRatio="none"><path d="${path}" stroke="#2b2b2b" stroke-width="1.5" fill="none"/>${bulbs}</svg>`;
}

// ------------------------------------------------------------------ coriandoli

let confettiParts = [];
let confettiRunning = false;

export function confetti(amount = 160) {
  const cv = document.getElementById("confetti");
  if (!cv) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  const g = cv.getContext("2d");
  const colors = ["#d62828", "#ffffff", "#2a9d4b", "#ffc43d", "#4cc9f0", "#ff70a6"];
  for (let i = 0; i < amount; i++) {
    confettiParts.push({
      x: (innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.6) * dpr,
      y: (innerHeight * 0.35 + (Math.random() - 0.5) * 60) * dpr,
      vx: (Math.random() - 0.5) * 18 * dpr,
      vy: (-Math.random() * 16 - 6) * dpr,
      w: (6 + Math.random() * 8) * dpr,
      h: (4 + Math.random() * 6) * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0],
      life: 0,
      // ogni tanto un tortellino al posto del coriandolo
      emoji: Math.random() < 0.06 ? ["🍕", "🍝", "🧀", "🍷"][(Math.random() * 4) | 0] : null,
    });
  }
  if (confettiRunning) return;
  confettiRunning = true;
  const tick = () => {
    g.clearRect(0, 0, cv.width, cv.height);
    confettiParts = confettiParts.filter((p) => p.y < cv.height + 50 && p.life < 400);
    for (const p of confettiParts) {
      p.life++;
      p.vy += 0.35 * dpr;
      p.vx *= 0.99;
      p.vy *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      if (p.emoji) {
        g.font = `${22 * dpr}px serif`;
        g.fillText(p.emoji, -10 * dpr, 8 * dpr);
      } else {
        g.fillStyle = p.c;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      }
      g.restore();
    }
    if (confettiParts.length) requestAnimationFrame(tick);
    else {
      confettiRunning = false;
      g.clearRect(0, 0, cv.width, cv.height);
    }
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ reazioni

export function floatEmoji(emoji, label) {
  const el = document.createElement("div");
  el.className = "floater";
  el.style.left = 10 + Math.random() * 80 + "vw";
  el.style.setProperty("--dx", (Math.random() - 0.5) * 120 + "px");
  el.textContent = emoji;
  if (label) {
    const s = document.createElement("small");
    s.textContent = label;
    el.appendChild(s);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

export function shake(el) {
  if (!el) return;
  el.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(0)" }],
    { duration: 260, iterations: 2 },
  );
}
