/* Landing page: the theme toggle, shared with the app through the same
   localStorage key, so switching here also switches the app. */
(function () {
    'use strict';
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var root = document.documentElement;

    function apply(theme) {
        root.setAttribute('data-theme', theme);
        btn.querySelector('.tt-icon').textContent = theme === 'dark' ? '☼' : '☾';
        btn.querySelector('.tt-label').textContent = theme === 'dark' ? 'Light' : 'Dark';
        btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#1A1E23' : '#F2F0E8');
    }

    apply(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        try { localStorage.setItem('avinox-theme', next); } catch (e) { /* not persisted */ }
    });
})();
