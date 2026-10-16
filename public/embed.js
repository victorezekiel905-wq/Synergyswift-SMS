/*
 * EduClass Fusion website widgets. Put this on any page of the school's site
 * (WordPress, Wix, Squarespace, plain HTML):
 *
 *   <div data-educlass="news" data-school="your-school"></div>
 *   <script src="https://YOUR-APP/embed.js" async></script>
 *
 * Widgets: news (latest posts, click to read), events (upcoming), apply (the
 * admissions form), enquire (the enquiry form). Options: data-limit="5",
 * data-color="#1d5ddb". The widgets keep their own styles (shadow DOM), so
 * the site's theme does not break them.
 */
(function () {
  var script = document.currentScript || document.querySelector('script[src*="embed.js"]');
  var base = script ? new URL(script.src).origin : "";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var day = function (iso) { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; } };
  var when = function (iso) { try { return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

  function css(color) {
    return "<style>:host{all:initial;display:block;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}"
      + "ul{list-style:none;margin:0;padding:0}li{padding:12px 0;border-bottom:1px solid #e2e8f0}li:last-child{border:0}"
      + "a,button.t{color:" + color + ";font-weight:600;text-decoration:none;background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left}"
      + "a:hover,button.t:hover{text-decoration:underline}.m{font-size:12px;color:#64748b;margin-top:2px}.s{font-size:14px;margin-top:4px;color:#334155}"
      + ".b{white-space:pre-wrap;font-size:14px;line-height:1.6;margin-top:8px}img{max-width:100%;border-radius:8px;margin-top:8px}.e{color:#64748b;font-size:14px}</style>";
  }

  function frame(el, kind, school) {
    var f = document.createElement("iframe");
    f.src = base + "/" + kind + "/" + encodeURIComponent(school) + "?embed=1";
    f.title = kind === "apply" ? "Admissions application" : "Enquiry form";
    f.style.cssText = "width:100%;border:0;min-height:600px;display:block";
    f.setAttribute("loading", "lazy");
    el.appendChild(f);
    window.addEventListener("message", function (e) {
      if (e.origin !== base || !e.data || e.data.type !== "educlass:height" || e.source !== f.contentWindow) return;
      f.style.height = Math.max(300, Number(e.data.height) || 600) + 20 + "px";
    });
  }

  function list(el, kind, school, limit, color) {
    var root = el.attachShadow ? el.attachShadow({ mode: "open" }) : el;
    root.innerHTML = css(color) + '<p class="e">Loading…</p>';
    fetch(base + "/api/public/" + encodeURIComponent(school) + "/" + kind + "?limit=" + limit)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var items = j[kind] || [];
        if (!items.length) { root.innerHTML = css(color) + '<p class="e">' + (kind === "news" ? "No news yet." : "No upcoming events.") + "</p>"; return; }
        root.innerHTML = css(color) + "<ul>" + items.map(function (n) {
          return kind === "news"
            ? '<li><button class="t" data-post="' + esc(n.slug) + '">' + esc(n.title) + '</button><div class="m">' + esc(day(n.published_at)) + "</div>" + (n.summary ? '<div class="s">' + esc(n.summary) + "</div>" : "") + '<div class="x"></div></li>'
            : "<li><strong>" + esc(n.title) + '</strong><div class="m">' + esc(when(n.starts_at)) + (n.location ? " · " + esc(n.location) : "") + "</div>" + (n.description ? '<div class="s">' + esc(n.description) + "</div>" : "") + "</li>";
        }).join("") + "</ul>";
        if (kind !== "news") return;
        root.querySelectorAll("button[data-post]").forEach(function (b) {
          b.addEventListener("click", function () {
            var box = b.parentNode.querySelector(".x");
            if (box.innerHTML) { box.innerHTML = ""; return; }
            box.innerHTML = '<p class="e">Loading…</p>';
            fetch(base + "/api/public/" + encodeURIComponent(school) + "/news?post=" + encodeURIComponent(b.getAttribute("data-post")))
              .then(function (r) { return r.json(); })
              .then(function (p) { var post = p.post || {}; box.innerHTML = (post.image_url ? '<img alt="" src="' + esc(post.image_url) + '">' : "") + '<div class="b">' + esc(post.body || "") + "</div>"; })
              .catch(function () { box.innerHTML = '<p class="e">Could not load this post.</p>'; });
          });
        });
      })
      .catch(function () { root.innerHTML = css(color) + '<p class="e">Could not load ' + kind + ".</p>"; });
  }

  function mount() {
    document.querySelectorAll("[data-educlass]:not([data-educlass-ready])").forEach(function (el) {
      el.setAttribute("data-educlass-ready", "1");
      var kind = el.getAttribute("data-educlass"), school = el.getAttribute("data-school");
      if (!school) return;
      var limit = Math.min(50, Math.max(1, Number(el.getAttribute("data-limit")) || 5));
      var color = /^#[0-9a-f]{3,8}$/i.test(el.getAttribute("data-color") || "") ? el.getAttribute("data-color") : "#1d5ddb";
      if (kind === "apply" || kind === "enquire") frame(el, kind, school);
      else if (kind === "news" || kind === "events") list(el, kind, school, limit, color);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
