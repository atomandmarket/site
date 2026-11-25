// The Atom & The Market — static site generator.
//
//   node build.mjs              build the public site into dist/ (drafts excluded)
//   node build.mjs --drafts     include articles with `draft: true`
//   node build.mjs --watch      rebuild on every change in content/ and static/
//
// Articles: content/technologies/*.md (front matter + Markdown body).
// Drafts:   content/drafts/*.md — shown only with --drafts, never uploaded.
// Fixed texts: content/site.yml.
// Also writes newsletter/<slug>.html (to paste into beehiiv) and newsletter/<slug>-linkedin.txt.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import YAML from "yaml";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.join(ROOT, "content");
const ARTICLES = path.join(CONTENT, "technologies");
const DRAFTS = path.join(CONTENT, "drafts");
const STATIC = path.join(ROOT, "static");
const DIST = path.join(ROOT, "dist");
const NEWSLETTER = path.join(ROOT, "newsletter");

const args = new Set(process.argv.slice(2));
const INCLUDE_DRAFTS = args.has("--drafts");
const WATCH = args.has("--watch");

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtLong = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtShort = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const rfc822 = (d) => new Date(d + "T08:00:00Z").toUTCString();
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };

class ContentError extends Error {}

// ---------------------------------------------------------------- loading

function loadSite() {
  return YAML.parse(fs.readFileSync(path.join(CONTENT, "site.yml"), "utf8"));
}

function parseArticle(file, site) {
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const name = path.basename(file);
  if (!m) throw new ContentError(`${name}: missing front matter (the block between --- lines at the top).`);
  let fm;
  try { fm = YAML.parse(m[1]) || {}; } catch (e) { throw new ContentError(`${name}: front matter is not valid YAML — ${e.message}`); }
  const body = m[2].trim();

  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(typeof fm.title === "string" && fm.title.trim(), "title is missing");
  need(/^\d{4}-\d{2}-\d{2}$/.test(String(fm.date ?? "")), "date must look like 2026-12-02");
  need(typeof fm.sector === "string" && fm.sector.trim(), "sector is missing");
  need(typeof fm.summary === "string" && fm.summary.trim(), "summary is missing (one line shown in lists)");
  need(Array.isArray(fm.who_should_care) && fm.who_should_care.length > 0, "who_should_care needs at least one entry");
  const src = fm.source || {};
  need(src.authors, "source.authors is missing");
  need(src.title, "source.title is missing");
  need(src.year, "source.year is missing");
  need(src.doi || src.url, "source needs a doi or a url");
  need(site.verdicts[fm.verdict], `verdict must be one of: ${Object.keys(site.verdicts).join(", ")}`);
  need(fm.verdict === "hype" || fm.horizon, "horizon is missing (e.g. 3–7 years)");
  const sc = fm.scorecard || {};
  for (const c of site.criteria) {
    const e = sc[c.key];
    if (!e) { errors.push(`scorecard.${c.key} is missing`); continue; }
    need(Number.isInteger(e.score) && e.score >= 1 && e.score <= 5, `scorecard.${c.key}.score must be a whole number from 1 to 5`);
    need(typeof e.why === "string" && e.why.trim(), `scorecard.${c.key}.why is missing`);
  }
  if (fm.score_override != null) {
    const o = fm.score_override;
    need(typeof o.score === "number" && o.score >= 0 && o.score <= 10, "score_override.score must be a number from 0 to 10");
    need(typeof o.why === "string" && o.why.trim(), "score_override.why is missing");
  }
  need(body.length > 0, "the article text (below the front matter) is empty");
  if (errors.length) throw new ContentError(`${name}:\n  - ${errors.join("\n  - ")}`);

  const computed = Math.round((site.criteria.reduce((s, c) => s + sc[c.key].score, 0) / site.criteria.length) * 2 * 10) / 10;
  const slug = name.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const words = body.split(/\s+/).length;
  return {
    ...fm,
    date: String(fm.date),
    slug,
    url: `/technologies/${slug}/`,
    body,
    html: marked.parse(body),
    computedScore: computed,
    score: fm.score_override ? fm.score_override.score : computed,
    readMin: Math.max(1, Math.round(words / 220)),
    draft: fm.draft === true,
  };
}

function loadArticles(site) {
  const list = (dir) => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_template")).map((f) => path.join(dir, f))
    : [];
  // content/drafts/ is never uploaded (see .gitignore): everything there is a draft.
  const files = [...list(ARTICLES).map((f) => [f, false]), ...(INCLUDE_DRAFTS ? list(DRAFTS).map((f) => [f, true]) : [])];
  const errors = [];
  const items = [];
  for (const [f, isDraft] of files) {
    try { const a = parseArticle(f, site); if (isDraft) a.draft = true; items.push(a); }
    catch (e) { if (e instanceof ContentError) errors.push(e.message); else throw e; }
  }
  if (errors.length) throw new ContentError(errors.join("\n\n"));
  const slugs = new Map();
  for (const a of items) {
    if (slugs.has(a.slug)) throw new ContentError(`Two articles produce the same address /technologies/${a.slug}/ — rename one file.`);
    slugs.set(a.slug, a);
  }
  return items.filter((a) => INCLUDE_DRAFTS || !a.draft).sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------- partials

let SITE, CSS_V;

const verdictLabel = (v) => SITE.verdicts[v].label;
const tag = (v, extra = "") => `<span class="tag t-${v}">${esc(verdictLabel(v))}${extra}</span>`;
const bars = (n) => `<span class="bar">${[1, 2, 3, 4, 5].map((i) => `<i${i <= n ? ' class="on"' : ""}></i>`).join("")}</span>`;
const fmtScore = (s) => s.toFixed(1);

const NAV = [
  ["about", "/about/", "About"],
  ["technologies", "/technologies/", "Technologies"],
  ["author", "/author/", "Author"],
];
const NUMERALS = ["I", "II", "III", "IV", "V"];
const nav = (current) => `<nav>${NAV.map(([k, href, label]) => `<a href="${href}"${k === current ? ' aria-current="page"' : ""}>${label}</a>`).join("")}<a class="cta" href="#subscribe">Subscribe →</a></nav>`;

const topbar = (current) => `
<div class="topbar">
  <div class="wrap">
    <a href="/"><img src="/assets/wordmark.webp" alt="${esc(SITE.title)}" width="812" height="178"></a>
    ${nav(current)}
  </div>
</div>`;

function subscribeForm() {
  if (SITE.beehiiv?.embed) return `<div class="subscribe-embed">${SITE.beehiiv.embed}</div>`;
  return `<form class="subscribe" action="${esc(SITE.beehiiv.subscribe_url)}" method="get" target="_blank" rel="noopener">
      <input type="email" name="email" placeholder="you@company.com" aria-label="Email address" required>
      <button type="submit">Subscribe</button>
    </form>`;
}

const subBand = () => `
<div class="sub-band" id="subscribe">
  <div class="wrap">
    <p>${esc(SITE.subscribe_band)}</p>
    ${subscribeForm()}
  </div>
</div>`;

const footer = () => `
<footer>
  <div class="wrap">
    <div>© ${new Date().getFullYear()} ${esc(SITE.title)} · Not investment advice.</div>
    <div class="links">
      <a href="/about/">About</a>
      <a href="/technologies/">Technologies</a>
      <a href="/author/">Author</a>
      <a href="${esc(SITE.linkedin)}" rel="me">LinkedIn</a>
      <a href="/about/#contact">Contact</a>
      <a href="/feed.xml">RSS</a>
    </div>
  </div>
</footer>`;

function layout({ title, description, urlPath, image, type = "website", body, extraHead = "" }) {
  const fullTitle = title ? `${title} — ${SITE.title}` : SITE.title;
  const canonical = SITE.url.replace(/\/$/, "") + urlPath;
  const img = SITE.url.replace(/\/$/, "") + (image || "/assets/og-default.jpg");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="${esc(SITE.title)}">
<meta property="og:title" content="${esc(title || SITE.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.title)}" href="/feed.xml">
<link rel="stylesheet" href="/style.css?v=${CSS_V}">
${extraHead}
</head>
<body>
${body}
</body>
</html>
`;
}

function findRow(a) {
  return `
      <a class="find" href="${a.url}">
        <div>
          <h3>${esc(a.title)}</h3>
          <p class="use">${esc(a.summary)}</p>
          <div class="src">${a.draft ? "Draft · " : ""}${esc(a.sector)} · ${fmtShort(a.date)}</div>
        </div>
        <div class="for">
          <div class="k">Who should care</div>
          <div class="chips">${a.who_should_care.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>
        </div>
        <div class="ready">
          <div class="k">Readiness</div>
          <div class="score">${fmtScore(a.score)}<small>/10</small></div>
          ${tag(a.verdict)}
        </div>
      </a>`;
}

function readinessCard(a, { why = true, titleLink = false } = {}) {
  const hz = a.horizon ? `<span class="hz">Horizon ${esc(a.horizon)}</span>` : "";
  return `
        <div class="card">
          ${titleLink ? `<div class="card-title"><a href="${a.url}">${esc(a.title)}</a></div><div class="card-sub">Latest readiness card</div>` : ""}
          <div class="card-top">
            <div class="big">${fmtScore(a.score)}<small> /10</small></div>
            <div class="v">${tag(a.verdict)}${hz}</div>
          </div>
          ${SITE.criteria.map((c) => {
            const e = a.scorecard[c.key];
            return `<div class="axis"><span class="name">${esc(c.name)}</span>${bars(e.score)}<span class="n">${e.score}</span>${why ? `<span class="why">${esc(e.why)}</span>` : ""}</div>`;
          }).join("\n          ")}
          ${a.score_override && why ? `<p class="override">Score adjusted from ${fmtScore(a.computedScore)}: ${esc(a.score_override.why)}</p>` : ""}
          <div class="card-note">The score is the average of the five criteria, on a scale of 10.</div>
        </div>`;
}

function criteriaCard() {
  return `
        <div class="card">
          <div class="card-title">The five criteria</div>
          <div class="card-sub">Each scored from 1 to 5</div>
          <div style="margin-top:14px">
          ${SITE.criteria.map((c) => `<div class="axis"><span class="name">${esc(c.name)}</span>${bars(0)}<span class="n"></span><span class="q">${esc(c.question)}</span></div>`).join("\n          ")}
          </div>
          <div class="card-note">The score is the average of the five criteria, on a scale of 10.</div>
        </div>`;
}

function sourceLine(src) {
  const link = src.url || `https://doi.org/${src.doi}`;
  const linkText = src.doi ? `doi.org/${src.doi}` : link.replace(/^https?:\/\//, "");
  const journal = src.journal ? `, <i>${esc(src.journal)}</i>` : "";
  return { html: `${esc(src.authors)}, “${esc(src.title)}”${journal} (${esc(src.year)}). <a href="${esc(link)}" rel="noopener">${esc(linkText)}</a>`, link, linkText };
}

function refMeta(src) {
  const bits = [src.peer_reviewed === false ? "Preprint" : src.peer_reviewed ? "Peer-reviewed" : null, src.open_access ? "Open access" : null].filter(Boolean);
  return bits.join(" · ");
}

// ---------------------------------------------------------------- pages

function homePage(items) {
  const latest = items.slice(0, 5);
  const au = SITE.author;
  const body = `
<div class="band">
  <header class="home-header"><div class="wrap">${nav("home")}</div></header>
  <div class="wrap hero" id="subscribe">
    <h1 class="sr">${esc(SITE.title)}</h1>
    <img src="/assets/logo.webp" alt="${esc(SITE.title)}" width="1536" height="1024">
    <p>${esc(SITE.home.intro)}</p>
    ${subscribeForm()}
    <div class="fine">${esc(SITE.home.subscribe_note)}</div>
  </div>
</div>

<main>
  <section id="finds">
    <div class="wrap">
      <div class="section-head">
        <h2 class="label">Latest technologies</h2>
        ${items.length ? `<a href="/technologies/">All technologies →</a>` : ""}
      </div>
      ${latest.length ? latest.map(findRow).join("") : `<p class="empty-note">${esc(SITE.home.empty)}</p>`}
    </div>
  </section>

  <section id="author">
    <div class="wrap">
      <h2 class="label">The author</h2>
      <div class="author">
        <img class="portrait" src="${esc(au.photo)}" alt="${esc(au.name)}" width="900" height="900">
        <div>
          <h3>${esc(au.name)}</h3>
          <div class="role">${esc(au.role)}</div>
          <p class="bio">${esc(au.short_bio)}</p>
          <div class="facts">${au.facts.map(([b, t]) => `<span><b>${esc(b)}</b> ${esc(t)}</span>`).join("")}</div>
          <a class="more" href="/author/">More about ${esc(au.name.split(" ")[0])} →</a>
        </div>
      </div>
    </div>
  </section>

  <section id="readiness">
    <div class="wrap method">
      <div>
        <h2 class="label">Industrial readiness</h2>
        <p>${esc(SITE.home.readiness_intro)}</p>
        <div class="legend">
          ${Object.entries(SITE.verdicts).map(([k, v]) => `<div>${tag(k)}<span>${esc(v.text)}</span></div>`).join("\n          ")}
        </div>
      </div>
      ${items.length ? readinessCard(items[0], { why: false, titleLink: true }) : criteriaCard()}
    </div>
  </section>
</main>
${subBand().replace('id="subscribe"', 'id="subscribe-bottom"')}
${footer()}`;
  return layout({ title: "", description: SITE.description, urlPath: "/", body });
}

function archivePage(items) {
  const sectors = [...new Set(items.map((a) => a.sector))].sort();
  const audiences = [...new Set(items.flatMap((a) => a.who_should_care))].sort();
  const rows = items.map((a) => {
    const text = [a.title, a.summary, a.sector, ...a.who_should_care].join(" ").toLowerCase();
    return findRow(a).replace('<a class="find"', `<a class="find" data-sector="${esc(a.sector)}" data-verdict="${a.verdict}" data-care="${esc(a.who_should_care.join("|"))}" data-date="${a.date}" data-score="${a.score}" data-text="${esc(text)}"`);
  }).join("");
  const body = `
${topbar("technologies")}
<main>
  <div class="wrap page-head">
    <h1 class="label">Technologies</h1>
    <p class="intro">${esc(SITE.archive_intro)}</p>
  </div>
  <div class="wrap">
    ${items.length ? `
    <div class="filters" role="search">
      <div class="frow">
        <input class="search" id="q" type="search" placeholder="Search technologies, materials, sectors…" aria-label="Search">
        <select id="sector" aria-label="Sector"><option value="">All sectors</option>${sectors.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
        <select id="care" aria-label="Who should care"><option value="">Who should care: all</option>${audiences.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      </div>
      <div class="frow">
        <div class="pills" id="verdicts" aria-label="Verdict">
          <button class="pill" data-v="" aria-pressed="true">All verdicts</button>
          ${Object.entries(SITE.verdicts).map(([k, v]) => `<button class="pill" data-v="${k}" aria-pressed="false"><span class="dot d-${k}"></span>${esc(v.label)}</button>`).join("\n          ")}
        </div>
        <div class="spacer"></div>
        <select id="sort" aria-label="Sort"><option value="date">Newest first</option><option value="score">Highest readiness</option></select>
      </div>
    </div>
    <div class="count" id="count" aria-live="polite">${items.length} ${items.length === 1 ? "technology" : "technologies"}</div>
    <div class="list" id="list">${rows}</div>
    <div class="no-results" id="none" hidden>No technologies match these filters.<br><button class="reset" id="reset">Clear filters</button></div>
    ` : `<p class="empty-note" style="padding-bottom:80px">${esc(SITE.home.empty)}</p>`}
  </div>
</main>
${subBand()}
${footer()}
<script>
(() => {
  const list = document.getElementById("list"); if (!list) return;
  const rows = [...list.children], total = rows.length;
  const st = { q: "", sector: "", care: "", verdict: "", sort: "date" };
  const $ = (id) => document.getElementById(id);
  function apply() {
    const q = st.q.trim().toLowerCase();
    const shown = rows.filter((r) => {
      const ok = (!st.sector || r.dataset.sector === st.sector) &&
        (!st.care || r.dataset.care.split("|").includes(st.care)) &&
        (!st.verdict || r.dataset.verdict === st.verdict) &&
        (!q || r.dataset.text.includes(q));
      r.hidden = !ok; return ok;
    });
    const sorted = [...rows].sort(st.sort === "score" ? (a, b) => b.dataset.score - a.dataset.score : (a, b) => b.dataset.date.localeCompare(a.dataset.date));
    sorted.forEach((r) => list.appendChild(r));
    $("count").textContent = (shown.length === total ? total : shown.length + " of " + total) + (total === 1 ? " technology" : " technologies");
    $("none").hidden = shown.length > 0;
  }
  $("q").addEventListener("input", (e) => { st.q = e.target.value; apply(); });
  $("sector").addEventListener("change", (e) => { st.sector = e.target.value; apply(); });
  $("care").addEventListener("change", (e) => { st.care = e.target.value; apply(); });
  $("sort").addEventListener("change", (e) => { st.sort = e.target.value; apply(); });
  $("verdicts").addEventListener("click", (e) => {
    const b = e.target.closest(".pill"); if (!b) return;
    st.verdict = b.dataset.v;
    document.querySelectorAll("#verdicts .pill").forEach((p) => p.setAttribute("aria-pressed", p === b));
    apply();
  });
  $("reset").addEventListener("click", () => {
    Object.assign(st, { q: "", sector: "", care: "", verdict: "" });
    $("q").value = ""; $("sector").value = ""; $("care").value = "";
    document.querySelectorAll("#verdicts .pill").forEach((p) => p.setAttribute("aria-pressed", p.dataset.v === ""));
    apply();
  });
})();
</script>`;
  return layout({ title: "Technologies", description: "Every technology covered by The Atom & The Market, with its industrial readiness score.", urlPath: "/technologies/", body });
}

function articlePage(a) {
  const src = sourceLine(a.source);
  const meta = refMeta(a.source);
  const au = SITE.author;
  const ld = {
    "@context": "https://schema.org", "@type": "Article",
    headline: a.title, description: a.summary, datePublished: a.date,
    author: { "@type": "Person", name: au.name, url: SITE.url + "/author/" },
    publisher: { "@type": "Organization", name: SITE.title, logo: { "@type": "ImageObject", url: SITE.url + "/assets/og-default.jpg" } },
    mainEntityOfPage: SITE.url + a.url,
    citation: src.link,
  };
  const body = `
${topbar("technologies")}
<main>
  <article>
    <div class="wrap">
      <div class="read center art-head">
        <div class="crumb"><a href="/technologies/">Technologies</a> / ${esc(a.sector)}</div>
        <div class="label">${esc(a.sector)}</div>
        <h1>${esc(a.title)}</h1>
        <div class="ref">
          <div class="k">Source</div>
          ${src.html}
          ${meta ? `<div class="ref-meta">${meta}</div>` : ""}
        </div>
        ${a.disclosure ? `<p class="disclosure"><b>Disclosure.</b> ${esc(a.disclosure)}</p>` : ""}
        <div class="care">
          <div class="label">Who should care</div>
          <div class="chips">${a.who_should_care.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>
        </div>
        <div class="byline">
          <img src="${esc(au.photo_small)}" alt="" width="160" height="160">
          <div>
            <div class="who"><a href="/author/">${esc(au.name)}</a></div>
            <div class="when">${a.draft ? "DRAFT · " : ""}${fmtLong(a.date)} · ${a.readMin} min read</div>
          </div>
        </div>
      </div>

      <div class="read center glance">
        <div class="left">
          <span class="score">${fmtScore(a.score)}<small>/10</small></span>
          ${tag(a.verdict)}
          ${a.horizon ? `<span class="hz">Horizon ${esc(a.horizon)}</span>` : ""}
        </div>
        <a href="#readiness">Readiness card ↓</a>
      </div>

      <div class="read center body">
${a.html}
      </div>
    </div>

    <section class="readiness" id="readiness">
      <div class="wrap">
        <div class="read center">
          <h2 class="label">Industrial readiness</h2>
          ${readinessCard(a)}
        </div>
      </div>
    </section>

    <div class="wrap">
      <div class="read center art-foot">
        ${a.corrections ? `<p style="margin-bottom:10px"><b>Correction.</b> ${esc(a.corrections)}</p>` : ""}
        <p>${esc(SITE.disclaimer)} Spotted an error? <a href="/about/#contact">Write to me</a>.</p>
      </div>
    </div>
  </article>
</main>
${subBand()}
${footer()}`;
  return layout({
    title: a.title, description: a.summary, urlPath: a.url, type: "article", body,
    extraHead: `<meta property="article:published_time" content="${a.date}">${a.draft ? '\n<meta name="robots" content="noindex">' : ""}\n<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  });
}

function aboutPage() {
  const ab = SITE.about, au = SITE.author;
  const body = `
${topbar("about")}
<main>
  <section class="first">
    <div class="wrap">
      <div class="read">
        <h1 class="label">About</h1>
        <p class="lead">${esc(ab.lead)}</p>
        <div class="prose">${ab.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
        <a class="written-by" href="/author/">
          <img src="${esc(au.photo_small)}" alt="" width="160" height="160">
          <span><span class="k">Written by</span><b>${esc(au.name)}</b><span class="more">${esc(au.role)} →</span></span>
        </a>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2 class="label">Principles</h2>
      <div class="principles">
        ${ab.principles.map((p) => `<div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section id="contact">
    <div class="wrap">
      <h2 class="label">Contact</h2>
      <div class="contact">
        <div><h3>${esc(ab.contact[0].title)}</h3><p>${esc(ab.contact[0].text)}</p></div>
        <div><h3>${esc(ab.contact[1].title)}</h3><p><a href="mailto:${esc(SITE.contact_email)}">${esc(SITE.contact_email)}</a><br>${esc(ab.contact[1].text)}</p></div>
      </div>
    </div>
  </section>
</main>
${subBand()}
${footer()}`;
  return layout({ title: "About", description: ab.lead, urlPath: "/about/", body });
}

function authorPage() {
  const au = SITE.author;
  const ld = {
    "@context": "https://schema.org", "@type": "Person",
    name: au.name, jobTitle: au.role, url: SITE.url + "/author/",
    image: SITE.url + au.photo, sameAs: [SITE.linkedin],
  };
  const body = `
${topbar("author")}
<main>
  <section class="first" id="author">
    <div class="wrap">
      <h1 class="label">Author</h1>
      <div class="author big">
        <img class="portrait" src="${esc(au.photo)}" alt="${esc(au.name)}" width="900" height="900">
        <div>
          <h2 class="name">${esc(au.name)}</h2>
          <div class="role">${esc(au.role_long)}</div>
          <div class="bio">${au.bio.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
          <div class="links"><a href="${esc(SITE.linkedin)}" rel="me">LinkedIn →</a><a href="/about/#contact">Contact →</a></div>
        </div>
      </div>
    </div>
  </section>

  <section id="how">
    <div class="wrap">
      <h2 class="label">How I work</h2>
      <div class="steps">
        ${au.how_i_work.map((s, i) => `<div><div class="n">${NUMERALS[i]}</div><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p></div>`).join("\n        ")}
      </div>
    </div>
  </section>
</main>
${subBand()}
${footer()}`;
  return layout({
    title: au.name, description: au.short_bio, urlPath: "/author/", type: "profile", body,
    image: "/assets/og-default.jpg",
    extraHead: `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  });
}

function notFoundPage() {
  const body = `
${topbar("")}
<main><div class="wrap notfound"><h1 class="label" style="display:inline-block">Page not found</h1><p>This page does not exist. Try the <a href="/technologies/">list of technologies</a> or the <a href="/">homepage</a>.</p></div></main>
${footer()}`;
  return layout({ title: "Page not found", description: SITE.description, urlPath: "/404.html", body, extraHead: '<meta name="robots" content="noindex">' });
}

function feed(items) {
  const base = SITE.url.replace(/\/$/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(SITE.title)}</title>
  <link>${base}/</link>
  <description>${esc(SITE.description)}</description>
  <language>en</language>
  <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>
${items.filter((a) => !a.draft).map((a) => `  <item>
    <title>${esc(a.title)}</title>
    <link>${base}${a.url}</link>
    <guid>${base}${a.url}</guid>
    <pubDate>${rfc822(a.date)}</pubDate>
    <category>${esc(a.sector)}</category>
    <description>${esc(`${a.summary} Readiness ${fmtScore(a.score)}/10 — ${verdictLabel(a.verdict)}.`)}</description>
  </item>`).join("\n")}
</channel>
</rss>
`;
}

function sitemap(items) {
  const base = SITE.url.replace(/\/$/, "");
  const urls = ["/", "/about/", "/technologies/", "/author/", ...items.filter((a) => !a.draft).map((a) => a.url)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join("\n")}
</urlset>
`;
}

// ---------------------------------------------------------------- newsletter exports

function newsletterHtml(a) {
  const base = SITE.url.replace(/\/$/, "");
  const src = sourceLine(a.source);
  const meta = refMeta(a.source);
  const p = 'style="font-size:16px;line-height:1.6;margin:0 0 16px"';
  const crit = SITE.criteria.map((c) => {
    const e = a.scorecard[c.key];
    return `<li style="margin:0 0 8px"><strong>${esc(c.name)} ${"●".repeat(e.score)}${"○".repeat(5 - e.score)} ${e.score}/5</strong> — ${esc(e.why)}</li>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Newsletter — ${esc(a.title)}</title></head>
<body style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:680px;margin:32px auto;padding:0 20px;color:#1f1f1f">
<div style="background:#fff4ee;border:1px solid #f0d5c8;border-radius:8px;padding:14px 18px;font-size:14px;margin-bottom:28px">
  <strong>How to use:</strong> select everything below the line (from the title down), copy, and paste into a new beehiiv post.
  In beehiiv, set the post to <em>email only</em> and use the title as subject line.
</div>
<hr style="border:0;border-top:2px dashed #ccc;margin:0 0 28px">

<h1 style="font-size:28px;line-height:1.2;margin:0 0 14px">${esc(a.title)}</h1>
<p style="font-size:14px;line-height:1.5;color:#6b6b6b;margin:0 0 10px"><strong>Source:</strong> ${src.html}${meta ? ` · ${meta}` : ""}</p>
<p style="font-size:14px;line-height:1.5;color:#6b6b6b;margin:0 0 10px"><strong>Who should care:</strong> ${a.who_should_care.map(esc).join(" · ")}</p>
<p style="font-size:14px;margin:0 0 24px"><strong>Readiness ${fmtScore(a.score)}/10 · ${esc(verdictLabel(a.verdict))}</strong>${a.horizon ? ` · Horizon ${esc(a.horizon)}` : ""}</p>
${a.disclosure ? `<p ${p}><em>Disclosure: ${esc(a.disclosure)}</em></p>` : ""}
${a.html.replace(/<p>/g, `<p ${p}>`)}
<h2 style="font-size:20px;margin:32px 0 12px">Industrial readiness: ${fmtScore(a.score)}/10 · ${esc(verdictLabel(a.verdict))}</h2>
<ul style="padding-left:20px;font-size:15px;line-height:1.5">
${crit}
</ul>
<p ${p}><a href="${base}${a.url}">Read and share it on atomandmarket.com →</a></p>
<p style="font-size:12px;color:#a3a3a3">${esc(SITE.disclaimer)}</p>
</body></html>
`;
}

function linkedinText(a) {
  const base = SITE.url.replace(/\/$/, "");
  return `${a.title}

${a.summary}

Who should care: ${a.who_should_care.join(", ")}.

Industrial readiness: ${fmtScore(a.score)}/10 — ${verdictLabel(a.verdict)}${a.horizon ? ` (horizon ${a.horizon})` : ""}.
${SITE.criteria.map((c) => `• ${c.name} ${a.scorecard[c.key].score}/5 — ${a.scorecard[c.key].why}`).join("\n")}

Source: ${a.source.authors}, "${a.source.title}"${a.source.journal ? `, ${a.source.journal}` : ""} (${a.source.year}).

Full analysis (link for the first comment): ${base}${a.url}
`;
}

// ---------------------------------------------------------------- build

function build() {
  const t0 = Date.now();
  SITE = loadSite();
  const items = loadArticles(SITE);
  CSS_V = crypto.createHash("md5").update(fs.readFileSync(path.join(STATIC, "style.css"))).digest("hex").slice(0, 8);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(STATIC, DIST, { recursive: true });
  write(path.join(DIST, "index.html"), homePage(items));
  write(path.join(DIST, "technologies", "index.html"), archivePage(items));
  write(path.join(DIST, "about", "index.html"), aboutPage());
  write(path.join(DIST, "author", "index.html"), authorPage());
  write(path.join(DIST, "404.html"), notFoundPage());
  for (const a of items) write(path.join(DIST, "technologies", a.slug, "index.html"), articlePage(a));
  write(path.join(DIST, "feed.xml"), feed(items));
  write(path.join(DIST, "sitemap.xml"), sitemap(items));
  write(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE.url.replace(/\/$/, "")}/sitemap.xml\n`);

  for (const a of items) {
    write(path.join(NEWSLETTER, `${a.slug}.html`), newsletterHtml(a));
    write(path.join(NEWSLETTER, `${a.slug}-linkedin.txt`), linkedinText(a));
  }

  const drafts = items.filter((a) => a.draft).length;
  console.log(`Built ${items.length} article(s)${drafts ? ` (${drafts} draft)` : ""} in ${Date.now() - t0} ms → dist/`);
}

function safeBuild() {
  try { build(); return true; }
  catch (e) {
    if (e instanceof ContentError) console.error(`\nContent error — nothing was published:\n\n${e.message}\n`);
    else console.error(e);
    return false;
  }
}

const ok = safeBuild();
if (WATCH) {
  let timer;
  const trigger = () => { clearTimeout(timer); timer = setTimeout(safeBuild, 150); };
  fs.watch(CONTENT, { recursive: true }, trigger);
  fs.watch(STATIC, { recursive: true }, trigger);
  console.log("Watching content/ and static/ for changes…");
} else if (!ok) {
  process.exit(1);
}
