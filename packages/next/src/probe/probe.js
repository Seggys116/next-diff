// Injected into the previewed page. No network; postMessage only, with a per-pane token.
(function () {
  "use strict";
  var C = window.__RBD;
  if (!C) return;
  // Act only when the diff app is the parent frame, except the devtools build, whose previews are two frames deep.
  if (window.parent === window || (window.parent !== window.top && !C.nested)) return;

  var doc = document;
  var parentWin = window.parent;
  var snapVersion = 0;
  var registry = {};

  function post(type, data) {
    try {
      // The viewer's own origin; "*" only when it isn't known.
      parentWin.postMessage({ rbd: 1, pane: C.pane, token: C.token, type: type, data: data }, C.parent || "*");
    } catch (e) {}
  }

  function realUrl() {
    return C.target + location.pathname + location.search + location.hash;
  }

  try {
    // Stop sites from caching/serving their own copies through a SW.
    if (window.ServiceWorkerContainer) {
      ServiceWorkerContainer.prototype.register = function () {
        return Promise.reject(new Error("Service workers are disabled in diff previews"));
      };
    }
  } catch (e) {}

  try {
    // Point the dev server's HMR socket at the real host; the preview host is not where the socket lives.
    var NativeWS = window.WebSocket;
    var tgt = new URL(C.target);
    if (NativeWS) {
      var WrappedWS = function (url, protocols) {
        try {
          var u = new URL(url, location.href);
          if (u.host === location.host) {
            u.protocol = tgt.protocol === "https:" ? "wss:" : "ws:";
            u.host = tgt.host;
            url = u.toString();
          }
        } catch (e) {}
        return protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
      };
      WrappedWS.prototype = NativeWS.prototype;
      ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) {
        WrappedWS[k] = NativeWS[k];
      });
      window.WebSocket = WrappedWS;
    }
  } catch (e) {}

  // Overlay scrollbars so both panes share a layout width.
  try {
    var hide = doc.createElement("style");
    hide.setAttribute("data-rbd", "");
    hide.textContent = "html{scrollbar-width:none!important}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}";
    (doc.head || doc.documentElement).appendChild(hide);
  } catch (e) {}

  // If the page sets no background, paint the browser canvas colour here; a backing layer in the app flashes white while the frame resizes.
  var canvasStyle = null;
  function clearPaint(cs) {
    if (!cs) return true;
    var c = cs.backgroundColor;
    var clear = !c || c === "transparent" || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c);
    return clear && (!cs.backgroundImage || cs.backgroundImage === "none");
  }
  function ensureCanvasBg() {
    try {
      var root = doc.documentElement;
      if (!root) return;
      // Judge the page's own styles: switch our rule off while measuring.
      if (canvasStyle) canvasStyle.disabled = true;
      var bare = clearPaint(getComputedStyle(root)) && (!doc.body || clearPaint(getComputedStyle(doc.body)));
      if (bare) {
        if (canvasStyle) {
          canvasStyle.disabled = false;
        } else {
          canvasStyle = doc.createElement("style");
          canvasStyle.setAttribute("data-rbd", "");
          canvasStyle.textContent = "html{background-color:Canvas}";
          (doc.head || root).appendChild(canvasStyle);
        }
      } else if (canvasStyle) {
        canvasStyle.remove();
        canvasStyle = null;
      }
    } catch (e) {}
  }

  /** The page's favicon, as a URL on the real site (not the preview host). */
  function iconUrl() {
    try {
      var links = doc.querySelectorAll('link[rel~="icon" i], link[rel="apple-touch-icon" i]');
      var best = null;
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        if (!l.getAttribute("href")) continue;
        var rel = (l.getAttribute("rel") || "").toLowerCase();
        var media = l.getAttribute("media") || "";
        // Prefer a plain "icon", then the light-scheme one, then anything else.
        var score = (rel.indexOf("apple") < 0 ? 4 : 0) + (media && /dark/.test(media) ? 0 : 2) + (/svg|png/.test(l.getAttribute("type") || "") ? 1 : 0);
        if (!best || score > best.score) best = { href: l.getAttribute("href"), score: score };
      }
      var u = new URL(best ? best.href : "/favicon.ico", location.href);
      if (u.origin === location.origin) return C.target + u.pathname + u.search;
      return u.href;
    } catch (e) {
      return "";
    }
  }

  function metaContent(key, max) {
    var el = doc.querySelector('meta[property="' + key + '" i], meta[name="' + key + '" i]');
    return el ? clip(norm(el.getAttribute("content")), max || 500) : "";
  }

  /** Resolve a head URL onto the real site. The preview host is not where the asset lives. */
  function absOnSite(href) {
    if (!href) return "";
    try {
      var u = new URL(href, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      if (u.origin === location.origin) return C.target + u.pathname + u.search + u.hash;
      return u.href;
    } catch (e) {
      return "";
    }
  }

  function pageHead() {
    var canon = "";
    try {
      var link = doc.querySelector('link[rel~="canonical" i]');
      if (link) canon = absOnSite(link.getAttribute("href"));
    } catch (e) {}
    return {
      title: clip(norm(doc.title), 300),
      description: metaContent("description"),
      canonical: clip(canon, 2000),
      robots: clip(metaContent("robots"), 200),
      keywords: clip(metaContent("keywords"), 400),
      author: clip(metaContent("author"), 200),
      lang: clip(norm(doc.documentElement ? doc.documentElement.lang : ""), 32),
      og: {
        title: clip(metaContent("og:title"), 300),
        description: metaContent("og:description"),
        image: absOnSite(metaContent("og:image", 2000)) || absOnSite(metaContent("og:image:secure_url", 2000)),
        imageAlt: clip(metaContent("og:image:alt"), 300),
        url: absOnSite(metaContent("og:url", 2000)),
        type: clip(metaContent("og:type"), 64),
        siteName: clip(metaContent("og:site_name"), 120),
      },
      twitter: {
        card: clip(metaContent("twitter:card"), 64),
        title: clip(metaContent("twitter:title"), 300),
        description: metaContent("twitter:description"),
        image: absOnSite(metaContent("twitter:image", 2000)) || absOnSite(metaContent("twitter:image:src", 2000)),
      },
    };
  }

  function announceNav() {
    post("nav", { url: realUrl(), title: doc.title || "", icon: iconUrl(), head: pageHead() });
  }
  try {
    ["pushState", "replaceState"].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(function () {
          announceNav();
          snapshotSoon(500);
        }, 0);
        return r;
      };
    });
    window.addEventListener("popstate", function () {
      announceNav();
      snapshotSoon(500);
    });
    window.addEventListener("hashchange", announceNav);
  } catch (e) {}

  var expectY = null;
  var expectT = 0;

  function scroller() {
    return doc.scrollingElement || doc.documentElement;
  }
  function docHeight() {
    var s = scroller();
    return Math.max(s.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
  }
  function metrics() {
    return {
      y: scroller().scrollTop,
      h: docHeight(),
      vh: window.innerHeight,
      vw: window.innerWidth,
    };
  }

  window.addEventListener(
    "scroll",
    function () {
      if (hlFollow) positionHighlights();
      var m = metrics();
      if (expectY !== null && Math.abs(m.y - expectY) < 1.5 && performance.now() - expectT < 500) {
        expectY = null;
        m.user = false;
      } else {
        m.user = true;
      }
      post("scroll", m);
    },
    { passive: true },
  );

  function scrollToY(y) {
    var s = scroller();
    var max = Math.max(0, docHeight() - window.innerHeight);
    y = Math.max(0, Math.min(max, y));
    if (Math.abs(s.scrollTop - y) < 0.5) return;
    try {
      window.scrollTo({ top: y, left: 0, behavior: "instant" });
    } catch (e) {
      window.scrollTo(0, y);
    }
    expectY = s.scrollTop;
    expectT = performance.now();
  }

  var SKIP = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1,
    BASE: 1, DATALIST: 1, OPTION: 1, OPTGROUP: 1, COLGROUP: 1, COL: 1, MAP: 1, AREA: 1,
    PARAM: 1, SOURCE: 1, TRACK: 1,
  };
  var INLINE = {
    A: 1, SPAN: 1, B: 1, I: 1, EM: 1, STRONG: 1, SMALL: 1, SUB: 1, SUP: 1, CODE: 1,
    MARK: 1, ABBR: 1, TIME: 1, LABEL: 1, U: 1, S: 1, CITE: 1, Q: 1, KBD: 1, VAR: 1,
    SAMP: 1, DFN: 1, BDI: 1, BDO: 1, DEL: 1, INS: 1, FONT: 1, BIG: 1, TT: 1, WBR: 1,
    BR: 1, IMG: 1, PICTURE: 1,
  };
  var LANDMARK = {
    HEADER: "header", NAV: "nav", MAIN: "main", SECTION: "section", FOOTER: "footer",
    ASIDE: "aside", ARTICLE: "article", FORM: "form",
  };
  var ROLE_LANDMARK = {
    banner: "header", navigation: "nav", main: "main", contentinfo: "footer",
    complementary: "aside", search: "search", form: "form", region: "section",
  };
  var MAX_BLOCKS = 2500;
  var MAX_ELEMENTS = 14000;

  function norm(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }
  function clip(s, n) {
    return s.length > n ? s.slice(0, n) : s;
  }
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function isSvg(el) {
    return el.namespaceURI === "http://www.w3.org/2000/svg" && el.tagName.toLowerCase() === "svg";
  }

  var seen = 0;
  function scan(el, depth, ctx) {
    if (seen++ > MAX_ELEMENTS) return null;
    var tag = el.tagName;
    if (SKIP[tag]) return null;
    if (el.hidden) return null;
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (e) {
      return null;
    }
    if (cs.display === "none") return null;
    var vis = cs.visibility === "visible" || cs.visibility === "";
    var fixed = ctx.fixed || cs.position === "fixed";
    var sticky = ctx.sticky || cs.position === "sticky";
    var info = {
      el: el, tag: tag, cs: cs, depth: depth, fixed: fixed, sticky: sticky,
      text: "", inlineOnly: true, selfInline: false, children: [], leaf: null, vis: vis,
      links: 0, linkChars: 0,
    };
    var ownInline = !!INLINE[tag] || cs.display === "inline";
    if (cs.display === "inline-block" || cs.display === "inline-flex") ownInline = ownInline || !el.children.length;
    info.selfInline = ownInline;

    if (isSvg(el)) {
      info.leaf = "svg";
      info.selfInline = true;
      return info;
    }
    if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED" || tag === "PICTURE") {
      info.leaf = tag.toLowerCase();
      info.selfInline = tag === "IMG" || tag === "PICTURE";
      if (tag === "PICTURE") {
        var im = el.querySelector("img");
        if (im) info.el = im;
        info.leaf = "img";
      }
      return info;
    }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") return null;
      info.leaf = "input";
      info.selfInline = false;
      info.text = norm(el.getAttribute("placeholder") || el.value || el.getAttribute("aria-label") || (type === "submit" || type === "button" ? el.value : ""));
      return info;
    }

    var kids = el.childNodes;
    var childCtx = { fixed: fixed, sticky: sticky };
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) {
        var t = n.data;
        if (t && /\S/.test(t)) info.text += (info.text ? " " : "") + t;
      } else if (n.nodeType === 1) {
        var ci = scan(n, depth + 1, childCtx);
        if (!ci) continue;
        info.children.push(ci);
        info.links += ci.links;
        info.linkChars += ci.linkChars;
        if (ci.text) info.text += (info.text ? " " : "") + ci.text;
        if (!ci.selfInline || !ci.inlineOnly) info.inlineOnly = false;
        if (ci.leaf && ci.leaf !== "img" && ci.leaf !== "svg") info.inlineOnly = false;
      }
    }
    info.text = norm(info.text);
    if (tag === "A") {
      info.links = 1;
      info.linkChars = info.text.length;
    }
    return info;
  }

  function firstFamily(ff) {
    return (ff || "").split(",")[0].replace(/["']/g, "").trim();
  }
  // Computed colours can come back as lab() / oklch() / color(); normalise to rgb(a).
  var colorCache = {};
  var colorCtx = null;
  function rgb(c) {
    if (!c || c === "transparent") return "rgba(0, 0, 0, 0)";
    if (/^rgba?\(/.test(c)) return c;
    if (colorCache[c]) return colorCache[c];
    var out = c;
    try {
      if (!colorCtx) {
        var cv = doc.createElement("canvas");
        cv.width = cv.height = 1;
        colorCtx = cv.getContext("2d", { willReadFrequently: true });
      }
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillStyle = "#000";
      colorCtx.fillStyle = c;
      colorCtx.fillRect(0, 0, 1, 1);
      var d = colorCtx.getImageData(0, 0, 1, 1).data;
      out = "rgba(" + d[0] + ", " + d[1] + ", " + d[2] + ", " + Math.round((d[3] / 255) * 100) / 100 + ")";
    } catch (e) {}
    colorCache[c] = out;
    return out;
  }

  function styleOf(cs, withBg) {
    var s = {
      c: rgb(cs.color),
      fs: cs.fontSize,
      fw: cs.fontWeight,
      ff: firstFamily(cs.fontFamily),
      ta: cs.textAlign,
    };
    if (cs.textTransform && cs.textTransform !== "none") s.tt = cs.textTransform;
    if (cs.letterSpacing && cs.letterSpacing !== "normal" && cs.letterSpacing !== "0px") s.ls = cs.letterSpacing;
    var bg = rgb(cs.backgroundColor);
    if (bg && bg !== "rgba(0, 0, 0, 0)") s.bg = bg;
    var br = cs.borderRadius;
    if (br && br !== "0px") s.br = br;
    if (withBg && cs.backgroundImage && cs.backgroundImage !== "none") s.bi = 1;
    return s;
  }

  function describeEl(el) {
    var parts = [];
    var cur = el;
    for (var i = 0; i < 3 && cur && cur.nodeType === 1 && cur !== doc.body; i++) {
      var p = cur.tagName.toLowerCase();
      if (cur.id) p += "#" + cur.id;
      else if (typeof cur.className === "string" && cur.className.trim()) p += "." + cur.className.trim().split(/\s+/)[0];
      parts.unshift(p);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  var sx = 0;
  var sy = 0;
  function rectOf(el, range) {
    var r = (range || el).getBoundingClientRect();
    return { x: Math.round((r.left + sx) * 10) / 10, y: Math.round((r.top + sy) * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  }

  function bgUrl(cs) {
    var m = /url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage || "");
    return m ? m[1] : null;
  }
  function normSrc(src) {
    if (!src) return "";
    if (src.indexOf("data:") === 0) return "data:" + hash(src);
    try {
      var u = new URL(src, location.href);
      var path = u.pathname;
      // Next.js image optimiser keeps the real URL in ?url=
      if (/\/_next\/image/.test(path) && u.searchParams.get("url")) {
        path = u.searchParams.get("url");
        try { path = new URL(path, location.href).pathname; } catch (e) {}
      }
      return path.toLowerCase();
    } catch (e) {
      return String(src).toLowerCase();
    }
  }

  var blocks;
  var nextId;

  function push(info, kind, extra, rangeOrNull, ctx) {
    if (blocks.length >= MAX_BLOCKS) return null;
    var el = info.el;
    var r = rectOf(el, rangeOrNull);
    var id = nextId++;
    var b = {
      id: id,
      kind: kind,
      tag: el.tagName.toLowerCase(),
      x: r.x, y: r.y, w: r.w, h: r.h,
      reg: ctx.region,
      fixed: !!info.fixed,
      sticky: !!info.sticky,
      depth: info.depth,
      path: describeEl(el),
    };
    for (var k in extra) b[k] = extra[k];
    blocks.push(b);
    registry[id] = { el: el, range: rangeOrNull || null, follow: !!(info.fixed || info.sticky) };
    return b;
  }

  function headingLevel(info) {
    var m = /^H([1-6])$/.exec(info.tag);
    if (m) return +m[1];
    var role = info.el.getAttribute("role");
    if (role === "heading") return +(info.el.getAttribute("aria-level") || 2);
    return 0;
  }

  function emitText(info, ctx) {
    var el = info.el;
    var text = clip(info.text, 600);
    if (!text) return;
    var tag = info.tag;
    var kind = "text";
    var lvl = headingLevel(info);
    if (lvl) kind = "heading";
    else if (tag === "LI") kind = "list-item";
    else if (tag === "A") kind = "link";
    else if (tag === "BUTTON" || el.getAttribute("role") === "button") kind = "button";
    else {
      var fs = parseFloat(info.cs.fontSize) || 16;
      if (fs >= 28 && text.length < 140 && (tag === "DIV" || tag === "SPAN" || tag === "P")) {
        kind = "heading";
        lvl = fs >= 44 ? 1 : 2;
      }
    }
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    var extra = { text: text, st: styleOf(info.cs, false) };
    if (lvl) extra.lvl = lvl;
    var anchor = tag === "A" ? el : el.querySelector ? el.querySelector("a[href]") : null;
    if (anchor) {
      try {
        extra.href = new URL(anchor.getAttribute("href"), location.href).pathname;
      } catch (e) {}
    }
    push(info, kind, extra, null, ctx);
  }

  function emitLeaf(info, ctx) {
    var el = info.el;
    var cs = info.cs;
    var r = el.getBoundingClientRect();
    var kind = info.leaf;
    if (kind === "img") {
      if (r.width < 24 && r.height < 24) return;
      var src = el.currentSrc || el.getAttribute("src") || "";
      push(info, "image", { src: normSrc(src), raw: clip(src, 300), alt: norm(el.getAttribute("alt")), nw: el.naturalWidth || 0, nh: el.naturalHeight || 0, st: styleOf(cs, false) }, null, ctx);
    } else if (kind === "svg") {
      if (r.width < 40 && r.height < 40) return;
      var markup = "";
      try { markup = clip(el.innerHTML, 4000); } catch (e) {}
      push(info, "graphic", { src: "svg:" + hash(markup), alt: norm(el.getAttribute("aria-label") || (el.querySelector("title") || {}).textContent), st: styleOf(cs, false) }, null, ctx);
    } else if (kind === "video" || kind === "canvas" || kind === "iframe" || kind === "object" || kind === "embed") {
      if (r.width < 40 || r.height < 24) return;
      var s2 = el.currentSrc || el.getAttribute("src") || el.getAttribute("data") || "";
      push(info, "media", { src: kind + ":" + normSrc(s2), raw: clip(s2, 300), alt: norm(el.getAttribute("title") || el.getAttribute("aria-label")), st: styleOf(cs, false) }, null, ctx);
    } else if (kind === "input") {
      if (r.width < 8 || r.height < 8) return;
      var type = (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
      push(info, "input", { text: clip(info.text, 200), alt: type, st: styleOf(cs, false) }, null, ctx);
    }
  }

  function regionTag(info) {
    if (LANDMARK[info.tag]) {
      // <section>/<form> only count with some identity, <header>/<footer> inside article are fine either way
      return LANDMARK[info.tag];
    }
    var role = info.el.getAttribute("role");
    return role && ROLE_LANDMARK[role] ? ROLE_LANDMARK[role] : null;
  }

  function labelFor(info, startIndex) {
    var el = info.el;
    var l = el.getAttribute("aria-label");
    if (l) return clip(norm(l), 80);
    var lb = el.getAttribute("aria-labelledby");
    if (lb) {
      var t = doc.getElementById(lb.split(/\s+/)[0]);
      if (t) return clip(norm(t.textContent), 80);
    }
    for (var i = startIndex; i < blocks.length; i++) {
      if (blocks[i].kind === "heading") return clip(blocks[i].text, 80);
    }
    if (info.el.id) return "#" + info.el.id;
    return "";
  }

  function visit(info, ctx) {
    if (blocks.length >= MAX_BLOCKS) return;
    if (!info.vis && !info.children.length) return;

    if (info.leaf) {
      if (info.vis) emitLeaf(info, ctx);
      return;
    }

    var landmark = regionTag(info);
    // A run of several links (nav bars, footers) is a set of links, not one sentence.
    var linkRun = info.links >= 2 && info.linkChars > info.text.length * 0.6;
    var isText = info.text && info.inlineOnly && info.vis && !landmark && !linkRun;

    // Visible background imagery (hero shots, cards) counts as media.
    if (info.vis && !isText) {
      var u = bgUrl(info.cs);
      if (u) {
        var rr = info.el.getBoundingClientRect();
        if (rr.width >= 80 && rr.height >= 60) {
          push(info, "image", { src: normSrc(u), raw: clip(u, 300), alt: "", bg: 1, st: styleOf(info.cs, true) }, null, ctx);
        }
      }
    }

    if (isText) {
      emitText(info, ctx);
      return;
    }

    var childCtx = ctx;
    var regionBlock = null;
    var startIndex = blocks.length;
    if (landmark && info.vis) {
      var rr2 = info.el.getBoundingClientRect();
      if (rr2.width > 40 && rr2.height > 16) {
        regionBlock = push(info, "region", { text: "", rt: landmark, st: styleOf(info.cs, true) }, null, ctx);
        if (regionBlock) childCtx = { region: regionBlock.id };
      }
    }

    var kids = info.children;
    var hasBlockChild = false;
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].selfInline || !kids[i].inlineOnly) hasBlockChild = true;
    }

    // Loose text directly inside a container that also holds block children.
    if (hasBlockChild && info.vis) {
      var nodes = info.el.childNodes;
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        if (n.nodeType === 3 && /\S/.test(n.data)) {
          try {
            var range = doc.createRange();
            range.selectNodeContents(n);
            var rb = range.getBoundingClientRect();
            if (rb.width >= 2 && rb.height >= 2) {
              var fake = { el: info.el, tag: info.tag, depth: info.depth + 1, fixed: info.fixed, sticky: info.sticky };
              push(fake, "text", { text: clip(norm(n.data), 400), st: styleOf(info.cs, false) }, range, childCtx);
            }
          } catch (e) {}
        }
      }
    }

    for (var k = 0; k < kids.length; k++) visit(kids[k], childCtx);

    if (regionBlock) regionBlock.text = labelFor(info, startIndex);
  }

  function extract() {
    var t0 = performance.now();
    seen = 0;
    registry = {};
    blocks = [];
    nextId = 1;
    var s = scroller();
    sx = s.scrollLeft || window.pageXOffset || 0;
    sy = s.scrollTop || window.pageYOffset || 0;
    var root = doc.body;
    if (!root) return null;
    var info;
    try {
      info = scan(root, 0, { fixed: false, sticky: false });
    } catch (e) {
      info = null;
    }
    if (info) {
      var rootCtx = { region: 0 };
      // body itself is never a block; start at its children.
      for (var i = 0; i < info.children.length; i++) visit(info.children[i], rootCtx);
      if (!info.children.length && info.text) visit(info, rootCtx);
    }
    snapVersion++;
    var out = {
      v: snapVersion,
      url: realUrl(),
      title: doc.title || "",
      icon: iconUrl(),
      head: pageHead(),
      lang: doc.documentElement.lang || "",
      docH: docHeight(),
      vw: window.innerWidth,
      vh: window.innerHeight,
      y: sy,
      ms: Math.round(performance.now() - t0),
      truncated: blocks.length >= MAX_BLOCKS,
      blocks: blocks,
    };
    return out;
  }

  var snapTimer = null;
  var lastSnap = 0;
  var havePainted = false;

  function takeSnapshot() {
    snapTimer = null;
    ensureCanvasBg();
    var snap;
    try {
      snap = extract();
    } catch (e) {
      post("warn", { message: String(e && e.message) });
      return;
    }
    if (!snap) return;
    lastSnap = performance.now();
    havePainted = true;
    // Block ids restart every snapshot; keep the boxes on screen until the app resends.
    hlItems = [];
    hlFollow = false;
    post("snapshot", snap);
    positionHighlights();
  }

  // In the devtools viewer the page is local, so the settle delays before a read are cut to well under half.
  var SETTLE = C.nested ? 0.35 : 1;
  function snapshotSoon(ms) {
    clearTimeout(snapTimer);
    var gap = 700 * SETTLE;
    var since = performance.now() - lastSnap;
    snapTimer = setTimeout(takeSnapshot, Math.max((ms || 600) * SETTLE, since < gap ? gap - since : 0));
  }

  var hlRoot = null;
  var hlItems = [];
  var hlVersion = 0;
  var hlFollow = false;
  var hlRaf = 0;
  var HL_COLORS = {
    added: ["rgba(52,211,153,.07)", "rgba(52,211,153,.85)"],
    removed: ["rgba(251,113,133,.07)", "rgba(251,113,133,.85)"],
    changed: ["rgba(251,191,36,.07)", "rgba(251,191,36,.85)"],
    restyled: ["rgba(167,139,250,.07)", "rgba(167,139,250,.85)"],
    moved: ["rgba(56,189,248,.07)", "rgba(56,189,248,.85)"],
  };

  function ensureHlRoot() {
    if (hlRoot && hlRoot.isConnected) return hlRoot;
    hlRoot = doc.createElement("div");
    hlRoot.id = "__rbd-hl";
    hlRoot.setAttribute("aria-hidden", "true");
    hlRoot.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
    var style = doc.createElement("style");
    style.textContent =
      "@keyframes __rbd-flash{0%{box-shadow:0 0 0 0 var(--rbd-glow)}100%{box-shadow:0 0 0 14px transparent}}" +
      "#__rbd-hl>div{position:absolute;box-sizing:border-box;border-radius:4px;transition:opacity .35s ease;opacity:0}" +
      "#__rbd-hl>div[data-on]{opacity:1}" +
      "#__rbd-hl>div[data-active]{border-width:2px!important;animation:__rbd-flash .9s ease-out 1;background:transparent!important}";
    hlRoot.appendChild(style);
    (doc.documentElement || doc.body).appendChild(hlRoot);
    return hlRoot;
  }

  function clearHighlights() {
    hlItems = [];
    hlFollow = false;
    if (hlRoot) {
      var nodes = hlRoot.querySelectorAll("div");
      for (var i = nodes.length - 1; i >= 0; i--) nodes[i].remove();
    }
  }

  function setHighlights(items, version) {
    if (version !== snapVersion) {
      // Snapshot moved on; the app will resend after the next diff.
      return;
    }
    hlVersion = version;
    var root = ensureHlRoot();
    var pool = {};
    var spare = [];
    var existing = root.querySelectorAll("div");
    for (var i = 0; i < existing.length; i++) {
      var key = existing[i].getAttribute("data-k");
      if (key && !pool[key]) pool[key] = existing[i];
      else spare.push(existing[i]);
    }
    hlItems = [];
    var used = [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var ids = [];
      var list = it.ids && it.ids.length ? it.ids : [it.id];
      for (var q = 0; q < list.length; q++) if (registry[list[q]]) ids.push(list[q]);
      if (!ids.length) continue;
      var colors = HL_COLORS[it.kind] || HL_COLORS.changed;
      var k2 = it.kind + (it.dashed ? "d" : "s") + ":" + ids.join(",");
      var d = pool[k2];
      if (d) pool[k2] = null;
      else d = spare.pop() || doc.createElement("div");
      d.setAttribute("data-k", k2);
      d.style.background = it.dashed ? "transparent" : colors[0];
      d.style.border = "1px " + (it.dashed ? "dashed " : "solid ") + colors[1];
      d.style.setProperty("--rbd-glow", colors[1].replace(/,\.85\)/, ",.35)"));
      if (it.active) {
        if (!d.hasAttribute("data-active")) d.setAttribute("data-active", "1");
      } else d.removeAttribute("data-active");
      if (!d.parentNode) root.appendChild(d);
      used.push(d);
      var follow = false;
      for (var f = 0; f < ids.length; f++) if (registry[ids[f]].follow) follow = true;
      hlItems.push({ ids: ids, node: d, active: !!it.active, follow: follow });
      if (follow) hlFollow = true;
    }
    for (var key2 in pool) if (pool[key2] && pool[key2].parentNode) pool[key2].remove();
    for (var sp = 0; sp < spare.length; sp++) if (used.indexOf(spare[sp]) < 0) spare[sp].remove();
    positionHighlights();
    requestAnimationFrame(function () {
      for (var k = 0; k < hlItems.length; k++) hlItems[k].node.setAttribute("data-on", "1");
    });
  }

  var posRaf = 0;
  function positionHighlights() {
    // Coalesce: many callers (scroll, resize, mutations, timers) land in the same frame.
    if (posRaf) return;
    posRaf = requestAnimationFrame(function () {
      posRaf = 0;
      layoutHighlights();
    });
  }

  function layoutHighlights() {
    if (!hlItems.length) return;
    var s = scroller();
    var ox = s.scrollLeft || window.pageXOffset || 0;
    var oy = s.scrollTop || window.pageYOffset || 0;
    var pad = 3;
    var i;
    var k;

    // Read every rect first, then write: interleaving forces a re-layout per box.
    var boxes = new Array(hlItems.length);
    for (i = 0; i < hlItems.length; i++) {
      var it = hlItems[i];
      var l = Infinity;
      var t = Infinity;
      var r = -Infinity;
      var bt = -Infinity;
      for (k = 0; k < it.ids.length; k++) {
        var reg = registry[it.ids[k]];
        if (!reg || !reg.el.isConnected) continue;
        var rc = (reg.range || reg.el).getBoundingClientRect();
        if (rc.width < 1 && rc.height < 1) continue;
        if (rc.left < l) l = rc.left;
        if (rc.top < t) t = rc.top;
        if (rc.right > r) r = rc.right;
        if (rc.bottom > bt) bt = rc.bottom;
      }
      boxes[i] = l === Infinity ? null : [l, t, r, bt];
    }
    for (i = 0; i < hlItems.length; i++) {
      var n = hlItems[i].node;
      var bx = boxes[i];
      if (!bx) {
        n.style.display = "none";
        continue;
      }
      var f = hlItems[i].follow;
      n.style.display = "";
      n.style.position = f ? "fixed" : "absolute";
      n.style.transform = "translate(" + (bx[0] + (f ? 0 : ox) - pad) + "px," + (bx[1] + (f ? 0 : oy) - pad) + "px)";
      n.style.left = "0";
      n.style.top = "0";
      n.style.width = bx[2] - bx[0] + pad * 2 + "px";
      n.style.height = bx[3] - bx[1] + pad * 2 + "px";
    }
  }

  // Layout keeps moving after a snapshot (lazy images, fonts, accordions): re-sync gently.
  setInterval(function () {
    if (hlItems.length && !document.hidden) positionHighlights();
  }, 1200);

  var warming = false;
  function warmup() {
    if (warming) return;
    warming = true;
    var startY = scroller().scrollTop;
    var step = Math.max(200, Math.round(window.innerHeight * 0.8));
    var y = 0;
    post("warmup", { state: "start" });
    (function tick() {
      var max = Math.max(0, docHeight() - window.innerHeight);
      if (y >= max) {
        setTimeout(function () {
          scrollToY(startY);
          warming = false;
          post("warmup", { state: "done" });
          snapshotSoon(500);
        }, 350);
        return;
      }
      y += step;
      scrollToY(y);
      post("warmup", { state: "progress", p: Math.min(1, y / Math.max(1, max)) });
      setTimeout(tick, 110);
    })();
  }

  doc.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      var best = 0;
      var bestEl = null;
      if (t && t.nodeType === 1 && !(hlRoot && hlRoot.contains(t))) {
        for (var id in registry) {
          var el = registry[id].el;
          if (!el || !el.isConnected || !el.contains(t)) continue;
          if (!bestEl || bestEl.contains(el)) {
            best = +id;
            bestEl = el;
          }
        }
      }
      post("pick", { id: best, v: snapVersion });
    },
    true,
  );

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.rbd !== 1 || d.token !== C.token || e.source !== parentWin) return;
    try {
      switch (d.type) {
        case "scrollTo":
          scrollToY(d.y);
          break;
        case "highlights":
          setHighlights(d.items || [], d.v);
          break;
        case "clearHighlights":
          clearHighlights();
          break;
        case "snapshot":
          snapshotSoon(50);
          break;
        case "warmup":
          warmup();
          break;
        case "ping":
          post("scroll", Object.assign(metrics(), { user: false }));
          break;
      }
    } catch (err) {}
  });

  function hello() {
    ensureCanvasBg();
    post("hello", {
      url: realUrl(),
      title: doc.title || "",
      icon: iconUrl(),
      status: C.status,
      head: pageHead(),
    });
    post("scroll", Object.assign(metrics(), { user: false }));
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", hello, { once: true });
  } else {
    hello();
  }

  function onLoad() {
    ensureCanvasBg();
    post("loaded", { title: doc.title || "" });
    var fonts = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    fonts.then(function () {
      snapshotSoon(500);
    });
    announceNav();
  }
  window.addEventListener("load", onLoad);
  // Injected after the page finished loading (devtools adds the probe from inside the developer's own page).
  if (doc.readyState === "complete") setTimeout(onLoad, 0);
  // Don't wait forever for pages with endless network activity.
  setTimeout(function () {
    if (!havePainted) snapshotSoon(100);
  }, 5500);

  try {
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var t = list[i].target;
        if (hlRoot && (t === hlRoot || (hlRoot.contains && hlRoot.contains(t)))) return;
      }
      if (havePainted) snapshotSoon(900);
      positionHighlights();
    });
    var startMo = function () {
      mo.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    };
    if (doc.documentElement) startMo();
  } catch (e) {}

  try {
    var ro = new ResizeObserver(function () {
      var m = metrics();
      post("scroll", Object.assign(m, { user: false }));
      positionHighlights();
    });
    var attachRo = function () {
      if (doc.documentElement) ro.observe(doc.documentElement);
      if (doc.body) ro.observe(doc.body);
    };
    if (doc.body) attachRo();
    else doc.addEventListener("DOMContentLoaded", attachRo, { once: true });
  } catch (e) {}

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      snapshotSoon(250);
      post("scroll", Object.assign(metrics(), { user: false }));
    }, 150);
  });

  doc.addEventListener(
    "load",
    function (e) {
      var t = e.target;
      if (t && t.tagName === "IMG" && havePainted) snapshotSoon(900);
    },
    true,
  );

  // Links that would open new windows or leave the app stay inside the frame.
  doc.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[target]") : null;
      if (a && /^_(blank|top|parent)$/.test(a.getAttribute("target") || "")) {
        a.setAttribute("target", "_self");
      }
    },
    true,
  );
})();
