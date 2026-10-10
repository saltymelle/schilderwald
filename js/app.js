/* Schilderwald – alle deutschen Verkehrszeichen spielerisch lernen.
   Klassisches Script (kein Modul), damit die Seite auch per Doppelklick (file://) läuft. */
(() => {
  'use strict';

  /* ---------- Daten ---------- */
  const ALL = ((window.SIGNS && window.SIGNS.signs) || []).filter(s => s && s.id && s.file && s.name);
  const EX = window.EXPLAIN || {};
  const G = window.gsap || null;
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (G && window.MorphSVGPlugin) G.registerPlugin(window.MorphSVGPlugin);
  if (G && RM) G.globalTimeline.timeScale(40);
  const S = window.SFX || new Proxy({}, { get: () => () => {} });

  const COL = { rot: '#c4161c', gelb: '#f5c400', blau: '#0b4f8c', gruen: '#00824f', weiss: '#f2f1ec', schwarz: '#161616' };

  // Noch nicht lokal gespeicherte Zeichen: Wikimedia-Vorschaubild in Standardgröße statt Original
  // (Originale werden von upload.wikimedia.org bei vielen Abrufen gedrosselt, Vorschaubilder liegen im Cache).
  const WM = 'https://upload.wikimedia.org/wikipedia/commons/';
  const viaThumb = f => (f.startsWith(WM) && !f.startsWith(WM + 'thumb/') && /\.svg$/i.test(f))
    ? `${WM}thumb/${f.slice(WM.length)}/500px-${f.split('/').pop()}.png` : f;
  ALL.forEach((s, i) => { s.i = i; s.id = String(s.id); s.base = String(s.base || s.id); s.file = viaThumb(String(s.file)); });
  // Wikimedia rendert Vorschaubilder beim ersten Abruf und lehnt bei vielen Erstabrufen kurz ab (400/429):
  // erst dasselbe Bild erneut laden, dann kleinere Standardgrößen.
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.src.includes('/thumb/')) return;
    const n = Number(img.dataset.retry || 0);
    if (n >= 3) return;
    img.dataset.retry = n + 1;
    const base = img.src.split('?')[0];
    const next = n === 0 ? base + '?r=1' : base.replace(/\/\d+px-/, n === 1 ? '/330px-' : '/250px-');
    setTimeout(() => { img.src = next; }, 900 * (n + 1));
  }, true);
  const byId = new Map(ALL.map(s => [s.id, s]));
  const BASES = new Map();
  for (const s of ALL) { if (!BASES.has(s.base)) BASES.set(s.base, []); BASES.get(s.base).push(s); }
  const baseList = [...BASES.keys()];
  const rep = b => (BASES.get(b) || [])[0];
  const ex = s => {
    const e = EX[s.id] || EX[s.base] || null;
    // Zeichen 101 gibt es mit vielen Sinnbildern (Steinschlag, Flugbetrieb …) – die allgemeine Erklärung passt dort nicht.
    if (e && s.base === '101' && s.id !== '101' && !EX[s.id]) return Object.assign({}, e, { kurz: `Achtung, Gefahrstelle: ${s.name}. Fahr vorsichtig und sei bremsbereit.` });
    return e;
  };

  const CATS = [
    { key: 'gefahr', label: 'Gefahrzeichen', rep: '101' },
    { key: 'vorschrift', label: 'Vorschriftzeichen', rep: '206' },
    { key: 'richt', label: 'Richtzeichen', rep: '306' },
    { key: 'markierung', label: 'Markierungen', rep: '294' },
    { key: 'einrichtung', label: 'Verkehrseinrichtungen', rep: '605' },
    { key: 'zusatz', label: 'Zusatzzeichen', rep: '1020-30' }
  ].filter(c => ALL.some(s => s.cat === c.key));
  const catLabel = k => (CATS.find(c => c.key === k) || {}).label || '';
  const CAT_BASES = Object.fromEntries(CATS.map(c => [c.key, baseList.filter(b => rep(b).cat === c.key)]));
  const catRep = c => rep(c.rep) || ALL.find(s => s.cat === c.key);

  const TOPICS = {
    vorfahrt: 'Vorfahrt', gefahr: 'Gefahren', verbot: 'Verbote', gebot: 'Gebote',
    tempo: 'Tempo & Überholen', parken: 'Halten & Parken', autobahn: 'Autobahn & Kraftfahrstraße',
    zonen: 'Zonen & Bereiche', wegweiser: 'Wegweiser', zusatz: 'Zusatzzeichen',
    markierung: 'Markierungen', baustelle: 'Baustelle & Absperrung'
  };

  /* ---------- Speicher (nur im Browser) ---------- */
  const KEY = 'schilderwald.v1';
  const store = Object.assign({ box: {}, km: 0, best: 0, sound: true, grammar: false }, read());
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* privater Modus o. ä. */ } }
  const lvl = b => store.box[b] || 0;
  function grade(b, ok) { const v = lvl(b); store.box[b] = ok ? Math.min(5, Math.max(1, v) + 1) : 1; save(); }
  function stats(bs = baseList) {
    let known = 0, seen = 0;
    for (const b of bs) { const v = lvl(b); if (v >= 4) known++; if (v > 0) seen++; }
    return { known, seen, total: bs.length };
  }
  const LVL = ['Noch neu', 'Gesehen', 'Am Lernen', 'Fast sicher', 'Sicher', 'Sitzt bombenfest'];

  /* ---------- Helfer ---------- */
  const $ = (q, r = document) => r.querySelector(q);
  const $$ = (q, r = document) => [...r.querySelectorAll(q)];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = a => a[(Math.random() * a.length) | 0];
  const norm = t => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
  const fmtKm = v => v.toFixed(1).replace('.', ',');
  const ARROW = '<path d="M12 1.5 22.5 12h-6.4v10.5H7.9V12H1.5z"/>';
  const arrow = (deg, cls = '') => `<svg class="arrow ${cls}" viewBox="0 0 24 24" style="--a:${deg}deg" aria-hidden="true">${ARROW}</svg>`;

  const absUrl = f => { try { return new URL(f, document.baseURI).href; } catch (e) { return f; } };
  const cssUrl = f => absUrl(f).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  function sign(s, o = {}) {
    const r = Math.min(3, Math.max(0.5, Number(s.ratio) || 1));
    return `<span class="sign ${o.cls || ''}" style="--src:url('${cssUrl(s.file)}');--r:${r}"><img src="${esc(s.file)}" alt="${esc(o.alt != null ? o.alt : s.name)}" draggable="false" ${o.eager ? '' : 'loading="lazy"'} decoding="async"></span>`;
  }
  function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

  /* ---------- Kilometerzähler ---------- */
  const odo = $('.odo-digits');
  function renderOdo(animate) {
    const str = store.km.toFixed(1).padStart(6, '0');
    const digits = str.replace('.', '');
    if (!odo.children.length) {
      odo.innerHTML = [...str].map(ch => ch === '.'
        ? '<span class="odo-sep">,</span>'
        : `<span class="odo-d"><span class="odo-col">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<span>${n}</span>`).join('')}</span></span>`).join('');
      odo.lastElementChild.classList.add('dec');
    }
    $$('.odo-col', odo).forEach((col, i) => {
      const y = -Number(digits[i] || 0) * 10;
      if (G && animate) G.to(col, { yPercent: y, duration: 1.4, ease: 'power3.out', delay: (digits.length - 1 - i) * 0.06 });
      else if (G) G.set(col, { yPercent: y });
      else col.style.transform = `translateY(${y}%)`;
    });
    $('.odo').setAttribute('aria-label', `${fmtKm(store.km)} Kilometer gefahren`);
  }
  function addKm(v) { store.km = Math.round((store.km + v) * 10) / 10; save(); renderOdo(true); }

  /* ---------- Scheinwerfer folgt dem Zeiger ---------- */
  const hl = $('.headlight');
  let raf = 0, mx = 0, my = 0;
  addEventListener('pointermove', e => {
    mx = e.clientX; my = e.clientY;
    if (!raf) raf = requestAnimationFrame(() => { hl.style.setProperty('--mx', mx + 'px'); hl.style.setProperty('--my', my + 'px'); raf = 0; });
  }, { passive: true });

  /* ---------- Ton ---------- */
  const sndBtn = $('.sound-toggle');
  function renderSound() { sndBtn.setAttribute('aria-pressed', String(store.sound)); sndBtn.classList.toggle('off', !store.sound); S.set(store.sound); }
  sndBtn.addEventListener('click', () => { store.sound = !store.sound; save(); renderSound(); if (store.sound) S.blink(); });

  /* ---------- Router ---------- */
  const app = $('#app');
  let keyHandler = null;
  const ROUTES = { '': home, form: grammar, lernen: learn, quiz: quiz, wald: wald };
  function route() {
    const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
    keyHandler = null;
    closeSheet(true);
    if (!ALL.length) return noData();
    (ROUTES[name] || home)(arg ? decodeURIComponent(arg) : undefined);
    window.scrollTo(0, 0);
    enter();
    sweep();
  }
  function enter() {
    if (!G) return;
    const els = $$('[data-in]', app);
    if (els.length) G.fromTo(els, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.07, clearProps: 'opacity,transform' });
  }
  function sweep() {
    if (!G) return;
    G.fromTo('.route-line', { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.55, ease: 'power2.inOut', onComplete() { G.to('.route-line', { opacity: 0, duration: 0.5 }); } });
  }
  addEventListener('hashchange', route);
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (!$('.sheet').hidden) { if (e.key === 'Escape') closeSheet(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button, a')) return;
    if (keyHandler) keyHandler(e);
  });

  function noData() {
    app.innerHTML = `<section class="empty" data-in><h1 class="page-title">Baustelle</h1><p class="page-sub">Die Zeichen-Daten fehlen noch. Im Projektordner einmal <code>node scripts/fetch-signs.mjs</code> ausführen.</p></section>`;
  }

  /* ---------- Lern-Pools ---------- */
  function pools() {
    const list = [];
    const kern = baseList.filter(b => EX[b]);
    if (kern.length) list.push({ key: 'kern', label: 'Prüfungswissen', group: 'Empfohlen', bases: kern });
    const weak = baseList.filter(b => lvl(b) > 0 && lvl(b) < 4);
    if (weak.length >= 4) list.push({ key: 'schwach', label: 'Meine Wackelkandidaten', group: 'Empfohlen', bases: weak });
    for (const [t, label] of Object.entries(TOPICS)) {
      const bs = kern.filter(b => EX[b].t === t);
      if (bs.length >= 3) list.push({ key: 't:' + t, label, group: 'Nach Thema', bases: bs });
    }
    for (const c of CATS) list.push({ key: 'c:' + c.key, label: c.label, group: 'Alle Zeichen nach Art', bases: CAT_BASES[c.key] });
    list.push({ key: 'alle', label: 'Alles gemischt', group: 'Alle Zeichen nach Art', bases: baseList });
    return list;
  }
  const findPool = key => { const ps = pools(); return ps.find(p => p.key === key) || ps.find(p => p.key === 'alle'); };

  /* ---------- Startseite ---------- */
  function home() {
    const st = stats();
    const h = new Date().getHours();
    const hi = h < 11 ? 'Guten Morgen!' : h < 18 ? 'Hallo!' : 'Guten Abend!';
    const msg = st.seen === 0
      ? `${hi} Willkommen im Schilderwald. Keine Angst – wir lichten ihn <b>Schild für Schild</b>.`
      : `${hi} Du kennst <b>${st.known}</b> von ${st.total} Zeichen sicher${st.seen > st.known ? ` – <b>${st.seen - st.known}</b> weitere sind auf dem Weg.` : '.'}`;
    const weak = baseList.filter(b => lvl(b) > 0 && lvl(b) < 4).length;
    const next = !store.grammar ? { href: '#/form', label: 'Los geht’s: Form & Farbe' }
      : weak >= 6 ? { href: '#/quiz/schwach', label: `${weak} Wackelkandidaten festigen` }
      : { href: '#/lernen/' + (baseList.some(b => EX[b]) ? 'kern' : 'alle'), label: 'Weiterlernen' };

    app.innerHTML = `
      <section class="hero">
        <div class="hero-road" aria-hidden="true"><div class="hero-plane"></div></div>
        <div class="hero-glow" aria-hidden="true"></div>
        <div class="ortstafel-wrap">
          <div class="ortstafel"><h1 class="ot-name">Schilderwald</h1><div class="ot-sub">Landkreis Führerschein</div></div>
          <div class="posts" aria-hidden="true"><i></i><i></i></div>
        </div>
      </section>
      <section class="status" data-in>
        <p class="hello">${msg}</p>
        <div class="lane" role="progressbar" aria-label="Sicher gelernte Zeichen" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${st.known}"><i style="--p:${st.total ? st.known / st.total : 0}"></i></div>
        <div class="lane-legend"><span>Start</span><span>${st.known} / ${st.total} sicher</span><span>Prüfung</span></div>
        <a class="btn btn-primary cta" href="${next.href}">${next.label} ${arrow(90)}</a>
      </section>
      <nav class="wegweiser" data-in aria-label="Hauptmenü">
        ${wwRow(1, '#/form', 'Form & Farbe', 'Das System hinter allen Schildern · 2 Min.', 0)}
        ${wwRow(2, '#/lernen', 'Lernen', 'Antwort auswählen oder Karteikarte', 45)}
        ${wwRow(3, '#/quiz', 'Quiz', 'Was bedeutet das? Welches ist es?', 90)}
        ${wwRow(4, '#/wald', 'Schilderwald', `Alle ${ALL.length} Zeichen auf einen Blick`, 135)}
      </nav>
      <h2 class="section-label" data-in>Deine Strecken</h2>
      <div class="cat-grid" data-in>${CATS.map(catCard).join('')}</div>`;

    $$('.cat', app).forEach(b => b.addEventListener('click', () => { location.hash = '#/lernen/' + encodeURIComponent('c:' + b.dataset.cat); }));
    if (G) {
      G.fromTo('.ortstafel-wrap', { y: -70, rotation: -5, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 1.4, ease: 'elastic.out(1, .5)', delay: 0.1 });
      G.from('.hero-plane', { opacity: 0, duration: 1.6, ease: 'power2.out' });
    }
    setTimeout(() => flash($('.ortstafel', app)), 750);
  }
  function wwRow(n, href, title, sub, deg) {
    return `<a class="ww-row" href="${href}"><span class="ww-num">${n}</span><span class="ww-text"><b>${title}</b><small>${sub}</small></span>${arrow(deg, 'ww-arrow')}</a>`;
  }
  function catCard(c) {
    const st = stats(CAT_BASES[c.key]); const r = catRep(c);
    return `<button class="cat" data-cat="${c.key}">${r ? `<img src="${esc(r.file)}" alt="" loading="lazy">` : ''}<span class="cat-name">${c.label}</span><span class="cat-count">${st.known} / ${st.total} sicher</span><span class="cat-bar"><i style="--p:${st.total ? st.known / st.total : 0}"></i></span></button>`;
  }

  /* ---------- Form & Farbe ---------- */
  const SHAPES = {
    tri: 'M100,22 L184,168 L16,168 Z',
    circle: 'M100,16 C146.4,16 184,53.6 184,100 C184,146.4 146.4,184 100,184 C53.6,184 16,146.4 16,100 C16,53.6 53.6,16 100,16 Z',
    oct: 'M132.9,20.5 L179.5,67.1 L179.5,132.9 L132.9,179.5 L67.1,179.5 L20.5,132.9 L20.5,67.1 L67.1,20.5 Z',
    invtri: 'M16,32 L184,32 L100,178 Z',
    diamond: 'M100,14 L186,100 L100,186 L14,100 Z',
    rect: 'M18,46 L182,46 L182,154 L18,154 Z',
    zusatz: 'M22,72 L178,72 L178,128 L22,128 Z'
  };
  const GRAMMAR = [
    { shape: 'tri', fill: COL.weiss, stroke: COL.rot, sw: 16, title: 'Dreieck mit rotem Rand', mean: 'Achtung, Gefahr!', cat: 'gefahr',
      text: 'Gefahrzeichen warnen vor einer Stelle, an der du besonders vorsichtig fahren musst. Außerorts stehen sie meist 150 bis 250 Meter vor der Gefahr.', ex: ['101', '102', '133', '123'] },
    { shape: 'circle', fill: COL.weiss, stroke: COL.rot, sw: 16, title: 'Kreis mit rotem Rand', mean: 'Verbot', cat: 'vorschrift',
      text: 'Was im roten Kreis zu sehen ist, ist verboten – oder begrenzt, wie die Höchstgeschwindigkeit. Ist der Kreis leer, darf hier gar kein Fahrzeug fahren.', ex: ['250', '254', '276', '274'] },
    { shape: 'circle', fill: COL.blau, stroke: COL.weiss, sw: 5, title: 'Blauer Kreis', mean: 'Gebot', cat: 'vorschrift',
      text: 'Blaue runde Schilder sagen dir, was du tun musst: in diese Richtung fahren, rechts vorbei, genau diesen Weg benutzen.', ex: ['209', '215', '222', '237'] },
    { shape: 'oct', fill: COL.rot, stroke: COL.weiss, sw: 6, label: 'STOP', labelFill: COL.weiss, labelSize: 46, title: 'Achteck', mean: 'Halt! Vorfahrt gewähren.', cat: 'vorschrift',
      text: 'Das einzige achteckige Schild. Du hältst immer an – auch wenn alles frei ist. Die Form erkennst du sogar von hinten oder wenn es zugeschneit ist.', ex: ['206'] },
    { shape: 'invtri', fill: COL.weiss, stroke: COL.rot, sw: 16, title: 'Dreieck auf der Spitze', mean: 'Vorfahrt gewähren', cat: 'vorschrift',
      text: 'Die anderen haben Vorfahrt. Du musst nicht unbedingt anhalten, aber langsam und bremsbereit heranfahren und sie durchlassen.', ex: ['205'] },
    { shape: 'diamond', fill: COL.gelb, stroke: COL.weiss, sw: 12, title: 'Gelbe Raute', mean: 'Vorfahrtstraße', cat: 'richt',
      text: 'Du hast an den folgenden Kreuzungen und Einmündungen Vorfahrt – bis die Raute durchgestrichen ist oder „Vorfahrt gewähren“ kommt.', ex: ['306', '307'] },
    { shape: 'rect', fill: COL.blau, stroke: COL.weiss, sw: 6, title: 'Rechteck', mean: 'Hinweis & Wegweisung', cat: 'richt',
      text: 'Eckige Schilder sind Richtzeichen. Sie informieren dich: wo du parken darfst, wo die Autobahn beginnt, wo ein Zebrastreifen ist.', ex: ['314', '350', '325.1', '330.1'] },
    { shape: 'circle', fill: COL.weiss, stroke: '#4a4a4a', sw: 3, slash: true, title: 'Schwarze Schrägstriche', mean: 'Ende – Aufhebung', cat: 'vorschrift',
      text: 'Diagonale Striche beenden ein Zeichen: Ende des Tempolimits, Ende des Überholverbots – oder gleich alles auf einmal.', ex: ['278', '280', '282'] },
    { shape: 'zusatz', fill: COL.weiss, stroke: COL.schwarz, sw: 4, label: 'Anlieger frei', labelFill: COL.schwarz, labelSize: 24, title: 'Kleines weißes Schild darunter', mean: 'Zusatzzeichen', cat: 'zusatz',
      text: 'Es gehört zum Zeichen darüber und schränkt es ein, erweitert oder erklärt es – zum Beispiel nur zu bestimmten Zeiten oder nur für bestimmte Fahrzeuge.', ex: ['1020-30', '1040-30', '1022-10'] }
  ];
  function slashLines() {
    let out = '';
    for (let k = -2; k <= 2; k++) {
      const o = k * 9, cx = 100 + 0.7071 * o, cy = 100 + 0.7071 * o, L = Math.sqrt(84 * 84 - o * o) - 8;
      out += `<line x1="${(cx - 0.7071 * L).toFixed(1)}" y1="${(cy + 0.7071 * L).toFixed(1)}" x2="${(cx + 0.7071 * L).toFixed(1)}" y2="${(cy - 0.7071 * L).toFixed(1)}"/>`;
    }
    return out;
  }
  function grammar() {
    let i = 0;
    app.innerHTML = `
      <section class="grammar">
        <div class="g-stage" data-in>
          <svg class="g-svg" viewBox="0 0 200 200" aria-hidden="true">
            <path class="g-path" d="${SHAPES.tri}" fill="${COL.weiss}" stroke="${COL.rot}" stroke-width="16" stroke-linejoin="round"/>
            <g class="g-slash" opacity="0" stroke="#1d1d1d" stroke-width="3.2" stroke-linecap="round">${slashLines()}</g>
            <text class="g-label" x="100" y="100" dominant-baseline="central" text-anchor="middle" opacity="0"></text>
          </svg>
          <div class="g-post" aria-hidden="true"></div>
        </div>
        <div class="g-copy" data-in>
          <div class="g-dots">${GRAMMAR.map(() => '<i></i>').join('')}</div>
          <h1 class="g-title"></h1>
          <p class="g-mean"></p>
          <p class="g-text"></p>
          <div class="g-ex"></div>
          <div class="g-nav">
            <button class="btn btn-ghost g-prev">${arrow(-90)} Zurück</button>
            <button class="btn btn-primary g-next">Weiter ${arrow(90)}</button>
          </div>
        </div>
      </section>`;
    const path = $('.g-path', app), label = $('.g-label', app);
    function show(n, first) {
      i = Math.max(0, Math.min(GRAMMAR.length - 1, n));
      const g = GRAMMAR[i];
      if (G && !first) {
        const props = { duration: 0.95, ease: 'expo.inOut', fill: g.fill, stroke: g.stroke, strokeWidth: g.sw };
        if (window.MorphSVGPlugin) props.morphSVG = SHAPES[g.shape]; else path.setAttribute('d', SHAPES[g.shape]);
        G.to(path, props);
        G.to('.g-slash', { opacity: g.slash ? 1 : 0, duration: 0.4, delay: g.slash ? 0.6 : 0 });
        G.fromTo('.g-svg', { rotationY: 0 }, { rotationY: 360, duration: 0.95, ease: 'expo.inOut', transformPerspective: 900 });
        G.fromTo(['.g-title', '.g-mean', '.g-text', '.g-ex'].map(q => $(q, app)), { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: 0.06, duration: 0.5, ease: 'power3.out', delay: 0.2 });
        S.flip();
      } else {
        path.setAttribute('d', SHAPES[g.shape]);
        Object.assign(path.style, { fill: g.fill, stroke: g.stroke, strokeWidth: g.sw });
        $('.g-slash', app).setAttribute('opacity', g.slash ? 1 : 0);
      }
      label.textContent = g.label || '';
      label.setAttribute('fill', g.labelFill || COL.weiss);
      label.setAttribute('font-size', g.labelSize || 40);
      if (G) G.to(label, { opacity: g.label ? 1 : 0, duration: 0.35, delay: g.label ? 0.7 : 0 }); else label.setAttribute('opacity', g.label ? 1 : 0);
      $('.g-title', app).textContent = g.title;
      $('.g-mean', app).textContent = g.mean;
      $('.g-text', app).textContent = g.text;
      let exs = g.ex.map(rep).filter(Boolean);
      if (!exs.length) exs = (CAT_BASES[g.cat] || []).slice(0, 3).map(rep);
      $('.g-ex', app).innerHTML = exs.map(s => `<button class="g-ex-item" data-id="${esc(s.id)}" title="${esc(s.name)}">${sign(s, { eager: true })}</button>`).join('');
      $$('.g-ex-item', app).forEach(b => b.addEventListener('click', () => openSheet(b.dataset.id)));
      $$('.g-dots i', app).forEach((d, j) => d.classList.toggle('on', j <= i));
      $('.g-prev', app).disabled = i === 0;
      $('.g-next', app).innerHTML = i === GRAMMAR.length - 1 ? `Verstanden – ab zum Lernen ${arrow(90)}` : `Weiter ${arrow(90)}`;
    }
    function nextSlide() {
      if (i === GRAMMAR.length - 1) { store.grammar = true; save(); addKm(1); location.hash = '#/lernen/' + (baseList.some(b => EX[b]) ? 'kern' : 'alle'); return; }
      show(i + 1);
    }
    $('.g-next', app).addEventListener('click', nextSlide);
    $('.g-prev', app).addEventListener('click', () => show(i - 1));
    keyHandler = e => { if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextSlide(); } else if (e.key === 'ArrowLeft') show(i - 1); };
    swipe($('.g-stage', app), dir => dir < 0 ? nextSlide() : show(i - 1));
    show(0, true);
  }
  function swipe(el, cb) {
    let x0 = null;
    el.addEventListener('pointerdown', e => { x0 = e.clientX; });
    el.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) cb(Math.sign(dx)); });
  }

  /* ---------- Auswahl (Lernen / Quiz) ---------- */
  function picker(mode, title, sub) {
    const ps = pools();
    const groups = [...new Set(ps.map(p => p.group))];
    app.innerHTML = `
      <header class="page-head" data-in><h1 class="page-title">${title}</h1><p class="page-sub">${sub}</p></header>
      ${groups.map(gr => `
        <h2 class="section-label" data-in>${gr}</h2>
        <div class="chips" data-in>${ps.filter(p => p.group === gr).map(p => {
          const st = stats(p.bases);
          return `<a class="chip" href="#/${mode}/${encodeURIComponent(p.key)}">${esc(p.label)}<small>${st.known}/${st.total}</small></a>`;
        }).join('')}</div>`).join('')}`;
  }
  function learn(key) {
    if (key) return learnSession(key);
    picker('lernen', 'Lernen', 'Wähl zu jedem Schild die richtige Bedeutung aus – oder dreh es klassisch als Karteikarte um und schätz dich selbst ein. Umschalten kannst du jederzeit oben rechts. Was noch wackelt, kommt öfter dran.');
  }
  function quiz(key) {
    if (key) return quizSession(key);
    picker('quiz', 'Quiz', 'Zehn Fragen, vier Antworten – mal Schild → Bedeutung, mal umgekehrt. Fehler sind erlaubt, genau dafür ist das hier.');
  }

  /* ---------- Lernen: Antwort auswählen oder Karteikarte ---------- */
  function learnSession(key) {
    const pool = findPool(key);
    const order = pool.bases.slice().sort((a, b) => lvl(a) - lvl(b) || rep(a).i - rep(b).i);
    const deck = order.slice(0, Math.min(10, order.length)).map(b => pick(BASES.get(b)));
    const total = deck.length, requeued = new Set();
    let idx = 0, flipped = false, knew = 0, busy = false, answered = false, opts = [];
    let mode = store.learnMode === 'self' ? 'self' : 'pick';
    app.innerHTML = `
      <div class="sess-top" data-in>
        <a class="back" href="#/lernen">${arrow(-90)}<span>${esc(pool.label)}</span></a>
        <div class="seg" role="group" aria-label="Lernart">
          <button class="seg-btn" data-mode="pick" aria-pressed="false">Auswählen</button>
          <button class="seg-btn" data-mode="self" aria-pressed="false">Karteikarte</button>
        </div>
      </div>
      <div class="steps" data-in style="--n:${total}">${'<i></i>'.repeat(total)}</div>
      <div class="fc-wrap" data-in><div class="flashcard" tabindex="0" role="button" aria-label="Karte umdrehen"></div></div>
      <div class="learn-zone" data-in></div>`;
    const card = $('.flashcard', app), zone = $('.learn-zone', app);

    function show() {
      const s = deck[idx], e = ex(s);
      answered = false; flipped = false;
      card.classList.toggle('compact', mode === 'pick');
      card.classList.remove('is-flipped');
      card.innerHTML = `
        <div class="fc-face fc-front">${sign(s, { eager: true, alt: 'Verkehrszeichen – was bedeutet es?' })}<p class="fc-hint">${mode === 'pick' ? 'Was bedeutet dieses Zeichen?' : 'Tippen zum Umdrehen'}</p></div>
        <div class="fc-face fc-back">
          <div class="fc-head">${sign(s, { cls: 'mini', eager: true, alt: '' })}<p class="fc-nr">Zeichen ${esc(s.id)}<br>${esc(catLabel(s.cat))}</p></div>
          <h2 class="fc-name">${esc(s.name)}</h2>
          ${e ? `<p class="fc-kurz">${esc(e.kurz)}</p>` : (s.section ? `<p class="fc-kurz muted">${esc(s.section)}</p>` : '')}
          ${e && e.merk ? `<p class="merk"><b>Merkhilfe</b>${esc(e.merk)}</p>` : ''}
        </div>`;
      $$('.seg-btn', app).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      $$('.steps i', app).forEach((el, j) => el.classList.toggle('cur', j === idx));
      if (mode === 'pick') {
        opts = shuffle([s, ...distractors(s, 3)]);
        zone.innerHTML = `
          <div class="answers">${opts.map((o, k) => `<button class="ans" data-k="${k}"><span class="k">${k + 1}</span><span class="t">${esc(o.name)}</span></button>`).join('')}</div>
          <div class="learn-actions single"><button class="btn btn-ghost btn-dunno">Weiß ich nicht – zeig’s mir</button></div>`;
        $$('[data-k]', zone).forEach(b => b.addEventListener('click', () => choose(+b.dataset.k)));
        $('.btn-dunno', zone).addEventListener('click', () => choose(-1));
      } else {
        zone.innerHTML = `
          <div class="learn-actions">
            <button class="btn btn-again">Nochmal <kbd>1</kbd></button>
            <button class="btn btn-know">Kann ich <kbd>2</kbd></button>
          </div>`;
        $('.btn-again', zone).addEventListener('click', () => rate(false));
        $('.btn-know', zone).addEventListener('click', () => rate(true));
      }
      if (G) {
        G.set(card, { rotationY: 0 });
        G.fromTo(card, { x: 90, opacity: 0, rotation: 4 }, { x: 0, opacity: 1, rotation: 0, duration: 0.6, ease: 'power3.out' });
        G.fromTo($$('button', zone), { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out', stagger: 0.05, delay: 0.1, clearProps: 'transform,opacity' });
      }
      setTimeout(() => flash($('.fc-front .sign', card)), 350);
    }
    function setFlip(v) {
      flipped = v; S.flip();
      if (G) G.to(card, { rotationY: v ? 180 : 0, duration: 0.75, ease: 'power3.inOut' });
      else card.classList.toggle('is-flipped', v);
    }
    // Ergebnis verbuchen: Lernstand, Fortschrittsstrich, Kilometer. Falsches kommt am Ende der Runde noch einmal.
    function settle(ok) {
      const s = deck[idx], step = $$('.steps i', app)[idx];
      grade(s.base, ok);
      if (step) { step.classList.remove('cur'); step.classList.add(ok ? 'ok' : 'bad'); }
      if (ok) { if (idx < total) knew++; addKm(0.2); }
      else if (!requeued.has(s.id)) { requeued.add(s.id); deck.push(s); }
    }
    function advance(dir) {
      if (busy) return; busy = true;
      const d = typeof dir === 'number' ? dir : 1;
      const fin = () => { busy = false; idx++; if (idx >= deck.length) return learnDone(pool, knew, total); show(); };
      if (G) G.to(card, { x: d * 170, rotation: d * 8, opacity: 0, duration: 0.38, ease: 'power2.in', onComplete: fin });
      else fin();
    }
    // Lernart „Auswählen": k = gewählte Antwort, -1 = „Weiß ich nicht"
    function choose(k) {
      if (answered || busy) return;
      answered = true;
      const s = deck[idx], ri = opts.findIndex(o => o.base === s.base), ok = k === ri;
      const btns = $$('[data-k]', zone);
      btns.forEach((b, j) => { b.disabled = true; b.classList.add(j === ri ? 'is-right' : j === k ? 'is-wrong' : 'is-dim'); });
      settle(ok);
      if (ok) {
        S.ok();
        if (G) G.fromTo(btns[ri], { scale: 0.95 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, .4)' });
      } else {
        S.no();
        try { navigator.vibrate && navigator.vibrate([30, 40, 30]); } catch (err) { /* egal */ }
        if (k >= 0 && G) G.fromTo(btns[k], { x: -12 }, { x: 0, duration: 0.7, ease: 'elastic.out(1.2, .25)' });
      }
      setTimeout(() => { if (answered && !flipped) setFlip(true); }, ok ? 380 : 700);
      $('.learn-actions', zone).innerHTML = `<button class="btn btn-primary btn-next">${idx + 1 >= deck.length ? 'Runde beenden' : 'Weiter'} ${arrow(90)}</button>`;
      const nb = $('.btn-next', zone);
      nb.addEventListener('click', advance);
      nb.focus({ preventScroll: true });
    }
    // Lernart „Karteikarte": selbst einschätzen
    function rate(ok) {
      if (busy) return;
      settle(ok);
      if (ok) S.ok(); else S.tock();
      advance(ok ? 1 : -1);
    }
    card.addEventListener('click', () => {
      if (busy) return;
      if (mode === 'pick' && !answered) {
        if (G) G.fromTo($('.fc-hint', card), { scale: 1.2, color: '#f5c400' }, { scale: 1, color: '#6f7672', duration: 0.7, ease: 'power2.out', clearProps: 'transform,color' });
        return;
      }
      setFlip(!flipped);
    });
    $$('.seg-btn', app).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.mode === mode || busy) return;
      mode = b.dataset.mode; store.learnMode = mode; save();
      if (answered) advance(); else show();
    }));
    keyHandler = e => {
      if (mode === 'pick') {
        if (!answered && /^[1-4]$/.test(e.key)) { const k = +e.key - 1; if (k < opts.length) choose(k); }
        else if (answered && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) { e.preventDefault(); advance(); }
      } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlip(!flipped); }
      else if (e.key === '1') rate(false);
      else if (e.key === '2') rate(true);
    };
    show();
  }
  function learnDone(pool, knew, total) {
    keyHandler = null; S.done();
    app.innerHTML = `
      <section class="summary">
        <p class="eyebrow" data-in>Runde geschafft · ${esc(pool.label)}</p>
        <div class="score" data-in><span class="score-n">${knew}</span><span class="score-of">/ ${total}</span></div>
        <p class="verdict" data-in>${knew === total ? 'Alles auf Anhieb gewusst – stark!' : 'Gut gemacht. Was noch wackelt, kommt beim nächsten Mal wieder.'}</p>
        <div class="row" data-in>
          <button class="btn btn-primary again">Nächste Runde ${arrow(90)}</button>
          <a class="btn btn-ghost" href="#/quiz/${encodeURIComponent(pool.key)}">Jetzt abfragen</a>
          <a class="btn btn-ghost" href="#/">Startseite</a>
        </div>
      </section>`;
    $('.again', app).addEventListener('click', route);
    enter();
  }

  /* ---------- Quiz ---------- */
  function weighted(bs, n) {
    return bs.map(b => ({ b, k: Math.pow(Math.random(), 1 / (Math.pow(6 - lvl(b), 2) * (EX[b] ? 1.5 : 1))) }))
      .sort((a, z) => z.k - a.k).slice(0, n).map(o => o.b);
  }
  function distractors(s, n) {
    const used = new Set([s.base]), names = new Set([norm(s.name)]), out = [];
    const e = ex(s);
    const sim = e && Array.isArray(e.aehnlich) ? e.aehnlich.map(String).filter(b => BASES.has(b)) : [];
    const sameSec = s.section ? baseList.filter(b => rep(b).section === s.section) : [];
    const sameCat = CAT_BASES[s.cat] || [];
    const tiers = lvl(s.base) >= 2
      ? [shuffle(sim), shuffle(sameSec), shuffle(sameCat), shuffle(baseList)]
      : [shuffle(sim).slice(0, 1), shuffle(sameCat), shuffle(baseList)];
    for (const tier of tiers) {
      for (const b of tier) {
        if (out.length >= n) return out;
        if (used.has(b)) continue;
        const r = rep(b);
        if (!r || names.has(norm(r.name))) continue;
        used.add(b); names.add(norm(r.name)); out.push(r);
      }
    }
    return out;
  }
  function makeQ(b) {
    const s = pick(BASES.get(b));
    return { s, type: Math.random() < 0.6 ? 'name' : 'sign', opts: shuffle([s, ...distractors(s, 3)]) };
  }
  function quizSession(key) {
    const pool = findPool(key);
    const N = Math.min(10, pool.bases.length);
    const qs = weighted(pool.bases, N).map(makeQ);
    const res = [], wrong = [];
    let qi = 0, streak = 0, right = 0, locked = false;
    app.innerHTML = `
      <div class="sess-top" data-in>
        <a class="back" href="#/quiz">${arrow(-90)}<span>${esc(pool.label)}</span></a>
        <span class="welle" title="Grüne Welle: richtige Antworten in Folge"><span class="ampel"><i></i><i></i><i></i></span><b class="welle-n">0</b></span>
      </div>
      <div class="steps" data-in style="--n:${N}">${'<i></i>'.repeat(N)}</div>
      <div class="q" data-in></div>`;
    const qEl = $('.q', app);
    function show() {
      const q = qs[qi]; locked = false;
      qEl.innerHTML = (q.type === 'name'
        ? `<div class="stage"><span class="pole" aria-hidden="true"></span>${sign(q.s, { eager: true, alt: 'Gesuchtes Verkehrszeichen' })}</div><p class="q-prompt">Was bedeutet dieses Zeichen?</p>`
        : `<p class="q-prompt">Welches Schild ist das?</p><div class="plate-wrap"><div class="name-plate">${esc(q.s.name)}</div></div>`)
        + `<div class="answers ${q.type === 'sign' ? 'img-mode' : ''}">${q.opts.map((o, k) => q.type === 'name'
          ? `<button class="ans" data-k="${k}"><span class="k">${k + 1}</span><span class="t">${esc(o.name)}</span></button>`
          : `<button class="ans-img" data-k="${k}" aria-label="Antwort ${k + 1}"><span class="k">${k + 1}</span>${sign(o, { eager: true, alt: '' })}</button>`).join('')}</div>
        <div class="feedback" hidden aria-live="polite"></div>`;
      $$('.steps i', app).forEach((el, j) => el.classList.toggle('cur', j === qi));
      $$('[data-k]', qEl).forEach(b => b.addEventListener('click', () => answer(+b.dataset.k)));
      if (G) {
        const sg = $('.stage .sign', qEl);
        if (sg) G.fromTo(sg, { rotationY: -110, opacity: 0, transformPerspective: 900 }, { rotationY: 0, opacity: 1, duration: 1.3, ease: 'elastic.out(1, .65)' });
        const plate = $('.name-plate', qEl);
        if (plate) G.fromTo(plate, { rotationX: -90, opacity: 0, transformPerspective: 900, transformOrigin: '50% 0%' }, { rotationX: 0, opacity: 1, duration: 1.1, ease: 'elastic.out(1, .6)' });
        G.fromTo($$('[data-k]', qEl), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out', stagger: 0.06, delay: 0.15, clearProps: 'transform,opacity' });
      }
      S.flip();
      setTimeout(() => flash($('.stage .sign', qEl)), 520);
    }
    function answer(k) {
      if (locked) return; locked = true;
      const q = qs[qi], ri = q.opts.findIndex(o => o.base === q.s.base), ok = k === ri;
      const btns = $$('[data-k]', qEl);
      btns.forEach((b, j) => { b.disabled = true; b.classList.add(j === ri ? 'is-right' : j === k ? 'is-wrong' : 'is-dim'); });
      grade(q.s.base, ok); res[qi] = ok;
      const st = $$('.steps i', app)[qi]; st.classList.remove('cur'); st.classList.add(ok ? 'ok' : 'bad');
      if (ok) { right++; streak++; if (streak > store.best) { store.best = streak; save(); } addKm(0.5); S.ok(); }
      else { streak = 0; wrong.push(q.s); S.no(); try { navigator.vibrate && navigator.vibrate([30, 40, 30]); } catch (e) { /* egal */ } }
      const a = $('.welle .ampel', app); a.classList.toggle('g', ok); a.classList.toggle('r', !ok);
      const wn = $('.welle-n', app); wn.textContent = streak;
      if (G) {
        G.fromTo(wn, { scale: 1.7 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
        if (ok) G.fromTo(btns[ri], { scale: 0.95 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, .4)' });
        else G.fromTo(btns[k], { x: -12 }, { x: 0, duration: 0.7, ease: 'elastic.out(1.2, .25)' });
      }
      if (ok) flash($('.stage .sign', qEl));
      const e = ex(q.s), chosen = q.opts[k];
      const fb = $('.feedback', qEl);
      fb.className = 'feedback ' + (ok ? 'good' : 'bad');
      fb.innerHTML = `
        <p class="fb-title">${ok ? pick(streak >= 3 ? ['Grüne Welle!', 'Läuft!', `${streak} in Folge!`] : ['Richtig!', 'Genau!', 'Sauber!']) : pick(['Knapp daneben.', 'Fast!', 'Nicht ganz.'])}</p>
        <p class="fb-name">${ok ? '' : 'Richtig ist: '}<b>${esc(q.s.name)}</b> <span class="muted">· Zeichen ${esc(q.s.id)}</span></p>
        ${!ok && chosen ? `<p class="fb-chosen">Dein Tipp war: ${esc(chosen.name)} <span class="muted">(Zeichen ${esc(chosen.id)})</span></p>` : ''}
        ${e ? `<p class="fb-text">${esc(e.kurz)}</p>` : ''}
        ${e && e.merk && !ok ? `<p class="merk"><b>Merkhilfe</b>${esc(e.merk)}</p>` : ''}
        <div class="fb-actions"><button class="btn btn-primary fb-next">${qi < N - 1 ? 'Weiter' : 'Zur Auswertung'} ${arrow(90)}</button></div>`;
      fb.hidden = false;
      if (G) G.fromTo(fb, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out' });
      $('.fb-next', fb).addEventListener('click', next);
      setTimeout(() => {
        const r = fb.getBoundingClientRect();
        if (r.bottom > innerHeight) fb.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'end' });
        $('.fb-next', fb).focus({ preventScroll: true });
      }, 90);
    }
    function next() { qi++; if (qi >= N) return done(); window.scrollTo(0, 0); show(); }
    function done() {
      keyHandler = null; S.done();
      const pct = N ? right / N : 0;
      const verdict = pct === 1 ? 'Fehlerfrei. So fährt man in die Prüfung.'
        : pct >= 0.8 ? 'Stark – fast schon prüfungsreif.'
        : pct >= 0.5 ? 'Guter Weg. Die Wackelkandidaten kommen jetzt öfter dran.'
        : 'Kein Stress – genau dafür üben wir. Die kniffligen kommen gleich wieder.';
      app.innerHTML = `
        <section class="summary">
          <p class="eyebrow" data-in>Auswertung · ${esc(pool.label)}</p>
          <div class="score" data-in><span class="score-n">0</span><span class="score-of">/ ${N}</span></div>
          <p class="verdict" data-in>${verdict}</p>
          <div class="ampel-row" data-in>${res.map(ok => `<span class="ampel h" data-ok="${ok ? 1 : 0}"><i></i><i></i><i></i></span>`).join('')}</div>
          <p class="km-gain" data-in>+${fmtKm(right * 0.5)} km · beste Grüne Welle: ${store.best}</p>
          <div class="row" data-in>
            <button class="btn btn-primary again">Nochmal ${arrow(90)}</button>
            <a class="btn btn-ghost" href="#/">Startseite</a>
          </div>
          ${wrong.length ? `<h2 class="section-label" data-in>Nochmal anschauen</h2>
          <div class="review-list" data-in>${wrong.map(s => `<button class="review-item" data-id="${esc(s.id)}">${sign(s, { alt: '' })}<span><b>${esc(s.name)}</b>${ex(s) ? `<small>${esc(ex(s).kurz)}</small>` : ''}</span></button>`).join('')}</div>` : ''}
        </section>`;
      $('.again', app).addEventListener('click', route);
      $$('.review-item', app).forEach(b => b.addEventListener('click', () => openSheet(b.dataset.id)));
      const n = $('.score-n', app), o = { v: 0 };
      if (G) G.to(o, { v: right, duration: 1.2, ease: 'power2.out', delay: 0.3, onUpdate: () => { n.textContent = Math.round(o.v); } });
      else n.textContent = right;
      $$('.ampel-row .ampel', app).forEach((el, j) => setTimeout(() => { el.classList.add(el.dataset.ok === '1' ? 'g' : 'r'); if (el.dataset.ok === '1') S.tick(); }, 600 + j * 150));
      window.scrollTo(0, 0);
      enter();
    }
    keyHandler = e => {
      if (!locked && /^[1-4]$/.test(e.key)) { const k = +e.key - 1; if (k < qs[qi].opts.length) answer(k); }
      else if (locked && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) { e.preventDefault(); next(); }
    };
    if (!N) return noData();
    show();
  }

  /* ---------- Schilderwald (Sammlung) ---------- */
  function wald() {
    const st = stats();
    app.innerHTML = `
      <header class="wald-head" data-in>
        <div><h1 class="page-title">Schilderwald</h1>
        <p class="page-sub">${ALL.length} Zeichen · ${st.known} sicher. Grau heißt: noch unbekannt. Was du kannst, leuchtet.</p></div>
        <label class="search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
        <input class="search" type="search" placeholder="Suchen: Name oder Nummer" aria-label="Zeichen suchen" autocomplete="off"></label>
      </header>
      <div class="chips wald-filter" data-in>
        <button class="chip" aria-pressed="true" data-f="">Alle</button>
        ${CATS.map(c => `<button class="chip" aria-pressed="false" data-f="${c.key}">${c.label}</button>`).join('')}
      </div>
      <div class="wald-body">${CATS.map(c => {
        const list = ALL.filter(s => s.cat === c.key), cs = stats(CAT_BASES[c.key]);
        return `<section class="wald-sec" data-cat="${c.key}"><h2>${c.label}<span>${cs.known} / ${cs.total} sicher</span></h2>
          <div class="wald-grid">${list.map(s => `<button class="tile l${lvl(s.base)}" data-id="${esc(s.id)}" data-q="${esc(norm(s.id + ' ' + s.name))}" title="${esc(s.name)}">${sign(s, { alt: s.name })}<span class="tile-nr">${esc(s.id)}</span></button>`).join('')}</div></section>`;
      }).join('')}
        <p class="wald-empty" hidden>Kein Zeichen gefunden. Versuch es mit einer Nummer, z.&nbsp;B. „205“.</p>
      </div>`;
    let cat = '', q = '';
    const apply = () => {
      let any = false;
      $$('.wald-sec', app).forEach(sec => {
        let vis = 0;
        if (cat && sec.dataset.cat !== cat) { sec.hidden = true; return; }
        $$('.tile', sec).forEach(t => { const show = !q || t.dataset.q.includes(q); t.hidden = !show; if (show) vis++; });
        sec.hidden = !vis; if (vis) any = true;
      });
      $('.wald-empty', app).hidden = any;
    };
    let tmr = 0;
    $('.search', app).addEventListener('input', e => { clearTimeout(tmr); tmr = setTimeout(() => { q = norm(e.target.value); apply(); }, 120); });
    $$('.wald-filter .chip', app).forEach(b => b.addEventListener('click', () => {
      cat = b.dataset.f; $$('.wald-filter .chip', app).forEach(x => x.setAttribute('aria-pressed', String(x === b))); apply();
    }));
    $('.wald-body', app).addEventListener('click', e => { const t = e.target.closest('.tile'); if (t) openSheet(t.dataset.id); });
    if (G) G.from($$('.tile', app).slice(0, 48), { opacity: 0, y: 14, scale: 0.92, duration: 0.5, ease: 'power3.out', stagger: 0.012, delay: 0.25 });
  }

  /* ---------- Detail-Blatt ---------- */
  const sheet = $('.sheet'), panel = $('.sheet-panel');
  function openSheet(id) {
    const s = byId.get(id); if (!s) return;
    const e = ex(s), L = lvl(s.base);
    const variants = (BASES.get(s.base) || []).filter(v => v.id !== s.id);
    const sims = e && Array.isArray(e.aehnlich) ? e.aehnlich.map(String).map(rep).filter(Boolean) : [];
    panel.innerHTML = `
      <div class="grabber" aria-hidden="true"></div>
      <button class="icon-btn close" aria-label="Schließen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="sheet-hero">${sign(s, { eager: true })}</div>
      <p class="fc-nr">Zeichen ${esc(s.id)} · ${esc(catLabel(s.cat))}${s.section ? ' · ' + esc(s.section) : ''}</p>
      <h2 class="sheet-name">${esc(s.name)}</h2>
      ${e ? `<p class="sheet-kurz">${esc(e.kurz)}</p>` : ''}
      ${e && e.merk ? `<p class="merk"><b>Merkhilfe</b>${esc(e.merk)}</p>` : ''}
      <div class="lvl"><span class="lvl-label">Lernstand</span><span class="lvl-meter">${[1, 2, 3, 4, 5].map(n => `<i class="${L >= n ? 'on' : ''}"></i>`).join('')}</span><span>${LVL[L]}</span></div>
      ${sims.length ? `<h3 class="mini-label">Nicht verwechseln mit</h3><div class="similar">${sims.map(v => `<button data-id="${esc(v.id)}" title="${esc(v.name)}">${sign(v)}<span>${esc(v.name)}</span></button>`).join('')}</div>` : ''}
      ${variants.length ? `<h3 class="mini-label">Varianten</h3><div class="similar">${variants.slice(0, 12).map(v => `<button data-id="${esc(v.id)}" title="${esc(v.name)}">${sign(v)}<span>${esc(v.name)}</span></button>`).join('')}</div>` : ''}`;
    const wasHidden = sheet.hidden;
    sheet.hidden = false;
    document.body.classList.add('no-scroll');
    $('.close', panel).addEventListener('click', () => closeSheet());
    $$('.similar button', panel).forEach(b => b.addEventListener('click', () => openSheet(b.dataset.id)));
    if (G) {
      if (wasHidden) {
        G.fromTo('.sheet-bg', { opacity: 0 }, { opacity: 1, duration: 0.3 });
        G.fromTo(panel, { yPercent: 100 }, { yPercent: 0, duration: 0.6, ease: 'expo.out' });
      }
      G.fromTo($('.sheet-hero .sign', panel), { rotationY: -100, opacity: 0, transformPerspective: 900 }, { rotationY: 0, opacity: 1, duration: 1.2, ease: 'elastic.out(1, .65)', delay: wasHidden ? 0.15 : 0 });
    }
    panel.scrollTop = 0;
    setTimeout(() => flash($('.sheet-hero .sign', panel)), 600);
    S.flip();
  }
  function closeSheet(instant) {
    if (sheet.hidden) return;
    const fin = () => { sheet.hidden = true; document.body.classList.remove('no-scroll'); };
    if (!G || instant) return fin();
    G.to('.sheet-bg', { opacity: 0, duration: 0.25 });
    G.to(panel, { yPercent: 100, duration: 0.35, ease: 'power2.in', onComplete: fin });
  }
  $('.sheet-bg').addEventListener('click', () => closeSheet());

  /* ---------- Start ---------- */
  renderSound();
  renderOdo(false);
  route();
})();
