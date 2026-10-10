/* Schilderwald – Klangeffekte. Alles live per Web Audio erzeugt, keine Audiodateien. */
window.SFX = (() => {
  let ctx = null, master = null, on = true, buf = null;

  function ac() {
    if (!on) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }

  function tone(freq, at, dur, o = {}) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + at, osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.12, t0 + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noise(at, dur, o = {}) {
    const c = ac(); if (!c) return;
    if (!buf) {
      buf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + at, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 2000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    f.Q.value = o.q || 1;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.1, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  return {
    set(v) { on = !!v; },
    tick() { noise(0, 0.03, { f: 3400, q: 6, gain: 0.22 }); },           // Blinker „tick"
    tock() { noise(0, 0.035, { f: 1900, q: 6, gain: 0.18 }); },          // Blinker „tack"
    blink() { this.tick(); setTimeout(() => this.tock(), 330); },
    ok() { tone(659.3, 0, 0.22, { type: 'triangle', gain: 0.14 }); tone(987.8, 0.085, 0.4, { type: 'triangle', gain: 0.12 }); },
    no() { tone(185, 0, 0.3, { gain: 0.2, to: 140 }); noise(0, 0.08, { f: 500, gain: 0.06 }); },
    flip() { noise(0, 0.2, { f: 900, to: 2600, q: 0.8, gain: 0.05 }); },
    done() { [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.55, { type: 'triangle', gain: 0.1 })); }
  };
})();
