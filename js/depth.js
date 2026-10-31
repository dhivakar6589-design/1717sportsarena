/* ============================================================
   1717 Sports Arena — 3D depth driver
   Writes the custom properties that css/depth.css reads:
     --px --py --sy   hero photo pan + scroll drift
     --nx --ny        hero content drift
     --bx --by        page depth field drift
     --gx --gy        whole-plane tilt (facilities, rates, details)
     --rx --ry        per-card tilt (news, reviews, my bookings)

   No dependencies. Everything is optional: if this file fails to
   run, or the visitor is on touch / reduced motion, the depth
   layer simply holds its resting state.
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;

  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fineMQ = window.matchMedia('(hover: hover) and (pointer: fine)');

  var PLANE_SELECTOR = '.card-grid, .rates-grid, .details-grid';
  var CARD_SELECTOR = '.news-card, .review-item, .my-booking-card';

  /* degrees of tilt, per surface */
  var PLANE_MAX = [
    ['.rates-grid', 5.0],
    ['.card-grid', 4.0],
    ['.details-grid', 3.2]
  ];
  var CARD_MAX = 7;

  var HERO_PARALLAX_X = 18;
  var HERO_PARALLAX_Y = 12;
  var HERO_CONTENT_X = -13;
  var HERO_CONTENT_Y = -9;
  var HERO_SCROLL_DRIFT = 0.08;   /* hero photo drifts up to 40px on scroll */
  var HERO_SCROLL_CAP = 500;
  var FIELD_X = -20;
  var FIELD_Y = -16;
  var FIELD_SCROLL_DRIFT = 0.05;
  var FIELD_SCROLL_CAP = 2000;

  var EASE = 0.12;
  var SETTLED = 0.04;
  var IDLE_MS = 1200;

  var engaged = [];
  var raf = 0;
  var lastMove = 0;

  var pointerX = 0;
  var pointerY = 0;
  var smoothX = 0;
  var smoothY = 0;

  /* ---------- helpers ---------- */

  function running() {
    return !reduceMQ.matches && fineMQ.matches && window.innerWidth > 900;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* avoids redundant style writes, which would recalc every frame */
  function setVar(el, name, value) {
    var cache = el.__depthVars || (el.__depthVars = {});
    if (cache[name] === value) return;
    cache[name] = value;
    el.style.setProperty(name, value);
  }

  function maxFor(el) {
    for (var i = 0; i < PLANE_MAX.length; i++) {
      if (el.matches(PLANE_MAX[i][0])) return PLANE_MAX[i][1];
    }
    return 3.5;
  }

  function find(list, el) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].el === el) return list[i];
    }
    return null;
  }

  function engage(el, isCard) {
    var existing = find(engaged, el);
    if (existing) {
      existing.inside = true;
      return;
    }
    engaged.push({
      el: el,
      card: isCard,
      inside: true,
      max: isCard ? CARD_MAX : maxFor(el),
      rx: 0,
      ry: 0,
      live: false
    });
    el.classList.add('is-tilting');
    kick();
  }

  function disengageAll() {
    for (var i = 0; i < engaged.length; i++) engaged[i].inside = false;
  }

  function release(entry) {
    entry.el.classList.remove('is-tilting');
    setVar(entry.el, entry.card ? '--rx' : '--gx', '0deg');
    setVar(entry.el, entry.card ? '--ry' : '--gy', '0deg');
  }

  /* ---------- pointer ---------- */

  function onPointerMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    lastMove = Date.now();
    kick();
  }

  function onPointerOver(e) {
    if (!running()) return;
    var el = e.target instanceof Element ? e.target : null;
    if (!el || !el.closest) return;
    var card = el.closest(CARD_SELECTOR);
    if (card) { engage(card, true); return; }
    var plane = el.closest(PLANE_SELECTOR);
    if (plane) engage(plane, false);
  }

  function onPointerOut(e) {
    /* pointer leaving the window entirely */
    if (!e.relatedTarget) { disengageAll(); return; }
    var card = e.target instanceof Element && e.target.closest
      ? e.target.closest(CARD_SELECTOR) : null;
    var plane = e.target instanceof Element && e.target.closest
      ? e.target.closest(PLANE_SELECTOR) : null;
    var el = card || plane;
    if (!el) return;
    /* moving between children of the same card is not a departure */
    if (el.contains(e.relatedTarget)) return;
    var entry = find(engaged, el);
    if (entry) entry.inside = false;
  }

  function onScroll() {
    lastMove = Date.now();
    kick();
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /* ---------- frame ---------- */

  function frame() {
    raf = 0;
    if (!running()) {
      reset();
      return;
    }

    var i, e, r, half, nx, ny, targetX, targetY;
    var heroLive = window.scrollY < window.innerHeight * 1.15;

    smoothX += (clamp(pointerX / window.innerWidth * 2 - 1, -1, 1) - smoothX) * EASE;
    smoothY += (clamp(pointerY / window.innerHeight * 2 - 1, -1, 1) - smoothY) * EASE;

    /* --- read phase: measure everything before touching any style --- */
    for (i = 0; i < engaged.length; i++) {
      e = engaged[i];
      e.live = false;
      if (!e.el.isConnected) continue;
      r = e.el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      /* wide boards respond along their width, tall boards clamp so a
         full-height grid still tilts on Y */
      half = Math.max(140, Math.min(r.width, r.height) / 2);
      nx = clamp((pointerX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      ny = clamp((pointerY - (r.top + r.height / 2)) / half, -1, 1);
      e.nx = nx;
      e.ny = ny;
      e.live = r.bottom > -80 && r.top < window.innerHeight + 80;
    }

    /* --- write phase --- */
    for (i = engaged.length - 1; i >= 0; i--) {
      e = engaged[i];

      if (e.inside && e.live) {
        /* pointer right lifts the right edge; pointer up lifts the top */
        targetX = -e.ny * e.max;
        targetY = e.nx * e.max;
      } else {
        targetX = 0;
        targetY = 0;
      }

      e.rx += (targetX - e.rx) * EASE;
      e.ry += (targetY - e.ry) * EASE;

      if (!e.el.isConnected) {
        engaged.splice(i, 1);
        continue;
      }

      setVar(e.el, e.card ? '--rx' : '--gx', e.rx.toFixed(3) + 'deg');
      setVar(e.el, e.card ? '--ry' : '--gy', e.ry.toFixed(3) + 'deg');

      if (!e.inside && Math.abs(e.rx) < SETTLED && Math.abs(e.ry) < SETTLED) {
        release(e);
        engaged.splice(i, 1);
      }
    }

    if (heroLive) {
      setVar(root, '--px', (smoothX * HERO_PARALLAX_X).toFixed(2) + 'px');
      setVar(root, '--py', (smoothY * HERO_PARALLAX_Y).toFixed(2) + 'px');
      setVar(root, '--nx', (smoothX * HERO_CONTENT_X).toFixed(2) + 'px');
      setVar(root, '--ny', (smoothY * HERO_CONTENT_Y).toFixed(2) + 'px');
    }

    var drift = Math.min(window.scrollY, FIELD_SCROLL_CAP) * FIELD_SCROLL_DRIFT;
    setVar(root, '--bx', (smoothX * FIELD_X).toFixed(2) + 'px');
    setVar(root, '--by', (smoothY * FIELD_Y - drift).toFixed(2) + 'px');
    setVar(root, '--sy',
      (Math.min(window.scrollY, HERO_SCROLL_CAP) * HERO_SCROLL_DRIFT).toFixed(2) + 'px');

    var busy = engaged.length > 0 ||
      Math.abs(smoothX) > 0.002 || Math.abs(smoothY) > 0.002;
    if (busy || Date.now() - lastMove < IDLE_MS) kick();
  }

  function reset() {
    for (var i = 0; i < engaged.length; i++) release(engaged[i]);
    engaged.length = 0;
    smoothX = 0;
    smoothY = 0;
    ['--px', '--py', '--nx', '--ny', '--bx', '--by', '--sy'].forEach(function (name) {
      setVar(root, name, '0px');
    });
  }

  /* ---------- wire up ---------- */

  function init() {
    /* listeners are always attached; running() gates at runtime so a
       viewport resize back to desktop still picks the depth up */
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });
    document.addEventListener('pointerover', onPointerOver, { passive: true });
    document.addEventListener('pointerout', onPointerOut, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('blur', disengageAll);
    /* a mid-flight media query change must not strand a tilted board */
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', reset);
    if (fineMQ.addEventListener) fineMQ.addEventListener('change', reset);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
