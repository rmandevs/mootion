(function () {
  'use strict';

  var root = document.documentElement;
  var KEY = 'mootion-theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Theme: follow the system until the visitor picks one, then remember it.
  function current() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return mq && mq.matches ? 'dark' : 'light';
  }

  var toggle = document.getElementById('theme-toggle');

  function label() {
    if (!toggle) return;
    var next = current() === 'dark' ? 'light' : 'dark';
    toggle.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    toggle.setAttribute('title', 'Switch to ' + next + ' theme');
  }

  function flip() {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    label();
  }

  if (toggle) toggle.addEventListener('click', flip);
  var shotToggle = document.getElementById('shot-toggle');
  if (shotToggle) shotToggle.addEventListener('click', flip);
  if (mq && mq.addEventListener) mq.addEventListener('change', label);
  label();

  // Copy buttons.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.copy'), function (btn) {
    btn.addEventListener('click', function () {
      var src = document.querySelector(btn.getAttribute('data-copy'));
      if (!src) return;
      var done = function (word) {
        btn.textContent = word;
        btn.classList.toggle('copied', word === 'Copied');
        clearTimeout(btn._t);
        btn._t = setTimeout(function () {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 1800);
      };
      copyText(src.textContent.trim()).then(
        function () { done('Copied'); },
        function () { done('Press ctrl+c'); }
      );
    });
  });

  // Expand or collapse all feature toggles.
  var expand = document.getElementById('expand-all');
  var toggles = document.querySelectorAll('#toggles details');

  function syncExpand() {
    if (!expand) return;
    var allOpen = Array.prototype.every.call(toggles, function (d) { return d.open; });
    expand.textContent = allOpen ? 'Collapse all' : 'Expand all';
    expand.setAttribute('aria-expanded', allOpen ? 'true' : 'false');
  }

  if (expand) {
    expand.addEventListener('click', function () {
      var open = expand.getAttribute('aria-expanded') !== 'true';
      Array.prototype.forEach.call(toggles, function (d) { d.open = open; });
      syncExpand();
    });
    Array.prototype.forEach.call(toggles, function (d) {
      d.addEventListener('toggle', syncExpand);
    });
    syncExpand();
  }

  // The message from Sage. On wide screens it pops up once in the corner, like
  // in the app. On narrow screens it stays in the page flow and covers nothing.
  var toast = document.getElementById('toast');
  var close = document.getElementById('toast-close');

  if (toast) {
    var hideTimer = null;
    var dismiss = function () {
      clearTimeout(hideTimer);
      toast.classList.remove('show');
      setTimeout(function () { toast.hidden = true; }, reduce ? 0 : 260);
    };
    var arm = function () {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        if (toast.matches(':hover') || toast.contains(document.activeElement)) { arm(); return; }
        if (window.matchMedia('(min-width: 900px)').matches) dismiss();
      }, 12000);
    };
    if (close) close.addEventListener('click', dismiss);
    setTimeout(function () {
      toast.classList.add('show');
      arm();
    }, 2600);
  }
})();
