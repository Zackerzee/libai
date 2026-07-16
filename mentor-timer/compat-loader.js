(function () {
  var VERSION = "20260716-compact-large-card-v1";
  var started = false;

  function hasForceCompat() {
    return /(?:\?|&)forceCompat=1(?:&|$)/.test(window.location.search || "");
  }

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      window.setTimeout(fn, 0);
      return;
    }
    if (document.addEventListener) {
      document.addEventListener("DOMContentLoaded", fn, false);
    } else if (document.attachEvent) {
      document.attachEvent("onreadystatechange", function () {
        if (document.readyState === "complete") fn();
      });
    }
  }

  function bootCompat(reason) {
    if (window.LIBMS_TIMER_APP_READY || started) return;
    started = true;
    window.LIBMS_TIMER_COMPAT_REASON = reason || "timeout";

    var script = document.createElement("script");
    script.src = "/mentor-timer/compat-app.js?v=" + VERSION;
    script.async = true;
    script.onload = function () {
      if (window.LIBMS_TIMER_COMPAT_BOOT) {
        window.LIBMS_TIMER_COMPAT_BOOT(window.LIBMS_TIMER_COMPAT_REASON);
      }
    };
    script.onerror = function () {
      var app = document.getElementById("app");
      if (app) {
        app.innerHTML =
          '<div class="app-shell"><header class="app-header"><div class="brand-block">' +
          '<p class="brand-kicker">LIBMS PERLER TIMER</p>' +
          '<h1 class="brand-title">✨ 时里白造物创意手作体验空间 ✨</h1>' +
          '<p class="brand-subtitle">计时器加载失败，请刷新页面或更换浏览器。</p>' +
          "</div></header></div>";
      }
    };
    document.head.appendChild(script);
  }

  window.LIBMS_TIMER_BOOT_COMPAT = bootCompat;
  window.LIBMS_TIMER_FORCE_COMPAT = hasForceCompat();

  if (window.addEventListener) {
    window.addEventListener(
      "error",
      function (event) {
        var file = event && event.filename ? event.filename : "";
        if (/vue\.global\.prod\.js|mentor-timer\/app\.js/.test(file)) {
          window.setTimeout(function () {
            bootCompat("script-error");
          }, 0);
        }
      },
      true
    );
  }

  onReady(function () {
    if (window.LIBMS_TIMER_FORCE_COMPAT) {
      bootCompat("forced");
      return;
    }
    window.setTimeout(function () {
      if (!window.LIBMS_TIMER_APP_READY) {
        bootCompat("modern-timeout");
      }
    }, 3000);
  });
})();
