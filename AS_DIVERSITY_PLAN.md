# AS Diversity Analysis — Feature Plan

> **Branch:** `claude/add-as-diversity-analysis-rc6Ne`
> **Status:** In Progress
> **Last Updated:** 2026-02-15

This document tracks everything about the AS Diversity Analysis feature — the plan,
progress, data inventory, ideas, and architecture decisions. It exists so that any
future conversation can pick up exactly where we left off, and so the feature can
be cleanly reverted if needed.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Revert Strategy](#2-revert-strategy)
3. [Files Modified / Created](#3-files-modified--created)
4. [Todo List](#4-todo-list)
5. [Architecture & Design](#5-architecture--design)
6. [Data Inventory — What's Available Per Peer](#6-data-inventory)
7. [Database Schema](#7-database-schema)
8. [AS Aggregation — What We Compute](#8-as-aggregation)
9. [UI Components](#9-ui-components)
10. [Interaction Model](#10-interaction-model)
11. [Ideas & Future Enhancements](#11-ideas--future-enhancements)
12. [Existing Patterns to Reuse](#12-existing-patterns-to-reuse)
13. [Technical Notes](#13-technical-notes)

---

## 1. Overview

**What:** A new "AS Diversity" view that sits alongside the existing Peer Map view,
toggled via a tab in the top bar. It visualizes how connected peers are distributed
across Autonomous Systems (ASes) — answering the question "am I too concentrated
on a single hosting provider / ISP?"

**Why:** AS diversity is a meaningful metric for Bitcoin node health. If 60% of your
peers are on Hetzner, that's a single point of failure. This view makes that visible
at a glance.

**How it works (user perspective):**

1. Donut chart is **always visible** in the upper-right corner of the map (no toggle needed)
2. Hover any AS segment → compact 3-line tooltip + animated lines from donut to peer nodes
3. Click any AS segment → detail panel slides in from right, **pushes** the map/donut/peer list over, filters peer table, dims non-matching peers
4. Click again / X / Escape → deselects, everything reverts

**UI Restructuring (v2 layout):**
- **Topbar:** Logo+Version (left) | Flight deck network chips (center) | Update countdown, status msg, status dots, sync status, time, gear (right)
- **Map area:** BTC price centered at top (larger), map controls centered below it, left overlay stays, AS donut in upper-right
- **Peer panel handle:** PEER LIST + filters (left) | Connect, Banned, NODE-INFO, MBCORE-DB, FIT, arrow, gear (right)
- **Right overlay removed** — all items moved to topbar or peer panel
- **Status dots (Internet/Running):** Just dots side-by-side, hover for info text
- **Map Settings:** Gear icon in topbar right, opens the existing advanced display panel

---

## 2. Revert Strategy

All AS Diversity code is isolated into **separate files** to keep the diff clean
and make reverting trivial.

### New files (delete to revert):
- `web/static/js/as-diversity.js` — All AS Diversity JS logic
- `web/static/css/as-diversity.css` — All AS Diversity CSS
- `AS_DIVERSITY_PLAN.md` — This file

### Modified files (minimal, clearly marked changes):
- `web/templates/bitindex.html` — Adds:
  - Two `<script>` / `<link>` tags for the new files
  - Flight deck moved to topbar center section
  - Status items (update countdown, status msg, dots, sync, gear) in topbar right
  - AS diversity container in map upper-right (always visible, no toggle)
  - AS detail panel div (slide-in, pushes content)
  - Peer panel buttons: NODE-INFO, MBCORE-DB, FIT (renamed), arrow toggle
  - Removed: right overlay, view toggle, "Hide Table" text
- `web/static/js/bitapp.js` — Adds:
  - A thin integration layer (~50-80 lines) that:
    - Calls `ASDiversity.update()` from `fetchPeers()` (always, no toggle check)
    - Provides map line drawing hooks (drawAsLines from donut position)
    - Wires topbar gear → advanced display panel
    - Wires peer panel NODE-INFO/MBCORE-DB buttons
    - Removes right overlay positioning logic
  - All integration points are marked with `// [AS-DIVERSITY]` comments
- `web/static/css/bitstyle.css` — Adds:
  - Topbar center section for flight deck
  - New topbar-right elements (countdown group, status msg, dots group, sync status, gear)
  - Repositioned BTC price bar (larger font, top: 52px)
  - Map controls repositioned (centered below BTC price)
  - Right overlay hidden (display: none)
  - Flight deck inline styles (no longer fixed positioned)

### To fully revert:
```bash
# Delete new files
rm web/static/js/as-diversity.js
rm web/static/css/as-diversity.css
rm AS_DIVERSITY_PLAN.md

# Then revert the modified files to their pre-feature state
git checkout main -- web/templates/bitindex.html
git checkout main -- web/static/js/bitapp.js
```

---

## 3. Files Modified / Created

| File | Action | Purpose |
|------|--------|---------|
| `web/static/js/as-diversity.js` | **NEW** | All AS diversity logic (aggregation, donut, tooltips, panel) ~885 lines |
| `web/static/css/as-diversity.css` | **NEW** | All AS diversity styling + detail panel push effect ~519 lines |
| `web/templates/bitindex.html` | **EDIT** | Restructured topbar (flight deck center, status right), donut container, peer panel buttons |
| `web/static/js/bitapp.js` | **EDIT** | Integration hooks + new button wiring + gear icon (~80 lines, marked `[AS-DIVERSITY]`) |
| `web/static/css/bitstyle.css` | **EDIT** | Topbar center, new right elements, repositioned BTC price + map controls, right overlay removed |
| `AS_DIVERSITY_PLAN.md` | **NEW** | This document |

---

## 4. Todo List

### Phase 1 — Core Feature (COMPLETE)
- [x] Codebase exploration & data inventory
- [x] Write this plan document
- [x] Create `as-diversity.js` with AS aggregation logic
- [x] Create `as-diversity.css` with all styling
- [x] Add shell HTML to `bitindex.html` (containers, script/css tags)
- [x] Build SVG donut chart component (260px, 3D effect, drop shadows)
- [x] Build diversity score calculation (HHI-based, 0-10)
- [x] Build compact hover tooltip (3 lines max)
- [x] Build AS detail slide-in panel (right side, pushes content)
- [x] Add integration hooks in `bitapp.js` (marked with `[AS-DIVERSITY]`)
- [x] Wire click: filter peer list + highlight map + open panel
- [x] Wire hover: draw lines from donut to AS peers on canvas
- [x] Wire Escape / X / re-click to deselect
- [x] Selection persistence (lines stay on mouse leave when clicked)
- [x] Others panel lists all individual ASes

### Phase 1b — UI Restructuring (COMPLETE)
- [x] Move flight deck to topbar center
- [x] Move status items to topbar right (countdown, status msg, dots, sync, time, gear)
- [x] Remove right overlay (everything moved to topbar/peer panel)
- [x] Remove view toggle (donut always visible in upper-right of map)
- [x] Move map controls below BTC price (centered)
- [x] Enlarge BTC price font
- [x] Add NODE-INFO, MBCORE-DB buttons to peer panel handle
- [x] Rename Auto-fit → FIT, Hide Table → arrow only
- [x] Detail panel pushes content instead of overlaying
- [x] Donut: 260px, 3D look, opacity effect (0.88 → 1 on hover)
- [x] Internet/Running dots: just dots, hover for info
- [x] Gear icon in topbar → opens advanced display settings

### Phase 2 — UX Refinements (COMPLETE)
- [x] Fix gear icon → wire to primary Map Settings popup, not advanced display
- [x] Fix tooltip z-index (was behind detail panel, bumped to 300+)
- [x] Center legend under donut
- [x] Add "Provider Diversity" title above donut with hover tooltip ("Autonomous System Provider Diversity Analysis")
- [x] Add score hover tooltip explaining what the number means
- [x] Add color-coded quality word BELOW the score (Excellent/Good/Moderate/Poor/Critical)
- [x] Edge case: grey out donut when only private network peers (no AS data)
- [x] Donut center updates when AS selected (shows AS name + count + pct)
- [x] Click empty map space → deselect AS, close panel, clear filters
- [x] Fan out lines to co-located peers (curved paths, dots stay in place)
- [x] Rework network filter badges to radio-then-additive model
- [x] Visibility toggles moved to gear settings (Diversity/Price/Stats)

### Phase 2b — Visual & Settings Polish (COMPLETE)
- [x] Donut title redesign: "PEER PROVIDER" (logo-primary, line 1) + "Diversity" (logo-accent, line 2)
- [x] Score layout: SCORE: heading → big number (42px) → quality word → peer count
- [x] Selected AS center: peer count heading → AS name (18px) → pct → AS number
- [x] Bump all font sizes: legend 11px, quality 11px, labels 10px
- [x] Remove endpoint dot jitter from fanning, lines converge on same dot
- [x] Line fan spread proportional to distance (up to 35% of line length, max 100px)
- [x] Loading state: "Locating N peers..." when >10% peers still geolocating
- [x] Close AS detail panel when clicking peer list handle
- [x] Peer list visible rows setting in Map Settings popup
- [x] Defunct Show/Hide items replaced with Diversity Score, Bitcoin Price, System Stats
- [x] Display Settings popup title → "Map Settings"
- [x] Title moved closer to donut (container gap 2px, negative margin)
- [x] Legend hidden by default, revealed on hover over donut area, stays on AS selection
- [x] Legend items centered under donut (auto width instead of 100%)
- [x] Line origins from legend dots (when visible) instead of donut center
- [x] Panel z-index stacking: peer panel / AS panel — last-clicked goes on top
- [x] Peer panel click (expand or body) → peers on top; AS panel click → AS on top

### Phase 2c — Advanced Display + Final Polish (COMPLETE)
- [x] Title renamed "SERVICE PROVIDER" / "Diversity" (from "Peer Provider")
- [x] Title spacing tightened: container gap 0, margin-bottom -6px, line-height 1.1
- [x] Advanced Display: new "Service Provider Diversity" section (below Theme, above Peer Effects)
- [x] Line Thickness slider (0-100, maps 0.3-4px, default=30)
- [x] Line Fanning slider (0-100, controls curve spread 0-70%, default=50)
- [x] Both sliders saved/restored with Permanent Save, reset with Reset
- [x] Footer: added Session Save button (blue, closes panel after feedback) alongside Reset + Permanent Save
- [x] Light theme confirmed still looks good

### Phase 3 — Polish (if time permits)
- [ ] Dropdown in donut center for searching all ASes
- [ ] Smooth segment transitions when peer data updates
- [ ] Keyboard navigation (arrow keys through segments)
- [ ] Mobile-friendly adjustments (if ever needed)
- [ ] Multi-peer dot click: show list of all peers at that location

---

## TODO — Repo & Documentation (README, Topics, About, PR)

### Repo Topics
**Current:** `python linux real-time canvas dashboard bitcoin geolocation tor cryptocurrency cjdns geoip network-visualization i2p world-map bitcoin-core bitcoin-node bitcoin-cli fastapi node-monitoring bitcoin-peers`

**Candidates to remove (making room for new ones):**
- `cjdns` — very niche, few people search for this
- `geoip` — redundant with `geolocation`
- `fastapi` — implementation detail, not a feature users search for

**New topics to add:**
- `network-security` — broad, highly searchable, describes the diversity analysis angle
- `peer-diversity` — descriptive of the new feature, human-readable
- `autonomous-system` — technical but correct, for people who know what they're looking for
- `isp-analysis` — bridges the gap between technical jargon and what people understand ("is my node too dependent on one ISP?")

**Proposed final set (20 topics):**
`python linux real-time canvas dashboard bitcoin geolocation tor cryptocurrency network-visualization i2p world-map bitcoin-core bitcoin-node bitcoin-cli node-monitoring bitcoin-peers network-security peer-diversity autonomous-system`

### Repo About Description
**Current:** "Real-time Bitcoin Core dashboard with a live geolocated peer map, GUI, system auto-detection, mempool statistics, and peer management tools. Connects, disconnects, and bans peers directly. Peer locations derived from a maintained database and free IP geolocation APIs. Runs locally with zero configuration."

**Proposed rewrite (emphasize diversity + plain language):**
"Real-time Bitcoin Core dashboard with a live geolocated peer map, service provider diversity analysis, and full peer management. Visualizes how your peers are distributed across internet service providers and hosting companies to identify single points of failure. Connects, disconnects, and bans peers directly. Features dark and light themes, mempool statistics, and system auto-detection. Peer locations from a maintained database and free geolocation APIs. Zero configuration."

### README Rewrite Plan
The README needs a complete overhaul. The map looks totally different now. Key sections:

1. **Hero section** — New screenshot(s) showing the full dashboard with donut, lines, dark theme
2. **What is this?** — One-paragraph plain-English explanation. Mention: peer map, service provider diversity donut, peer management, mempool stats. Avoid unexplained jargon.
3. **Features list** — Organized by category:
   - **Peer Map:** Real-time geolocated canvas map, pan/zoom, network filters, peer tooltips
   - **Service Provider Diversity:** Donut chart showing AS distribution, diversity score (0-10), concentration risk per provider, interactive detail panel with per-provider stats (peers, ping, traffic, software versions, countries), animated lines from donut to peers on map
   - **Peer Management:** Connect/disconnect/ban peers, peer table with sorting/filtering, ban list management
   - **System Monitoring:** CPU/RAM, mempool stats, block height, BTC price, network status
   - **Customization:** Dark/light/custom themes, advanced display (land/ocean/border colors, peer effects, line thickness/fanning), map settings (update frequency, visibility toggles, peer row limits)
4. **Screenshots** — Multiple: dark theme overview, light theme, AS selected with lines, detail panel, peer table, advanced display panel
5. **Quick Start** — Installation/run instructions (existing content, just refreshed)
6. **How It Works** — Brief technical explanation: Bitcoin Core RPC, geolocation pipeline, AS aggregation client-side, canvas rendering
7. **Configuration** — Environment vars, CLI flags if any
8. **Tech Stack** — Python/FastAPI backend, vanilla JS/Canvas frontend, SQLite geo cache, ip-api.com

### PR Description Notes
When this branch is merged, the PR should cover:
- **Summary:** Added service provider diversity analysis — a donut chart showing how peers are distributed across autonomous systems (ISPs/hosting providers), with a diversity score, concentration risk warnings, interactive detail panel, and animated map lines
- **What changed:** New files (as-diversity.js, as-diversity.css), modified topbar/peer panel layout, new Advanced Display sliders, Map Settings overhaul, panel z-stacking
- **Screenshots:** Dark theme, light theme, AS selected, detail panel, advanced display
- **Testing notes:** Works with 0 peers (no-data state), private-only peers (grey state), loading state (>10% pending geo), all themes, panel overlap behavior

---

## 5. Architecture & Design

### View Toggle
- Location: Inside `#topbar .topbar-left`, after the version badge
- HTML: Two styled tab links, one active at a time
- Toggling hides/shows the flight deck vs AS diversity container
- Body class `as-diversity-active` controls which view is visible

### Donut Chart
- Pure SVG, ~160px diameter, positioned top-center (replaces flight deck area)
- Top 8 ASes by peer count, then "Others" bucket
- Each segment colored from a curated 9-color palette
- Center text: diversity score (e.g., "7.2 / 10")
- Center is clickable → opens a searchable AS dropdown

### Hover Tooltip
- Small, compact, 3 lines max:
  ```
  AS24940 · Hetzner Online GmbH
  12 peers (18.2%) · Hosting
  ⚠ Moderate Concentration
  ```
- Positioned near cursor, same pattern as existing `showTooltip()`
- Canvas draws animated lines from node center to all peers of that AS

### AS Detail Panel
- Slides in from right edge, ~320px wide
- Uses existing modal CSS patterns (`.modal-section-title`, `.modal-row`, etc.)
- Positioned: `right: 0`, `top: 46px` (below topbar), `bottom: 368px` (above peer panel)
- Z-index: 260 (above most UI, below modals)
- Close: X button, Escape key, or click selected segment again
- Opening the panel also:
  - Filters the peer table to only show that AS's peers
  - Dims non-matching peers on the canvas
  - Draws lines from your node to matching peers

### Panel Sections
1. **Header** — AS number, org name, hosting type, percentage bar, risk level
2. **Peers** — Total, inbound/outbound, connection type breakdown
3. **Performance** — Avg duration, avg ping, total data sent/recv
4. **Software** — Version distribution (e.g., "Satoshi:27.0 — 10 peers")
5. **Countries** — Country distribution with flags/codes
6. **Services** — Service flag combinations

---

## 6. Data Inventory

### Per-Peer Fields Available (35 total from `/api/peers`)

**Identity & Connection:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `id` | number | `42` | Peer ID from Bitcoin Core |
| `network` | string | `"ipv4"` | One of: ipv4, ipv6, onion, i2p, cjdns |
| `ip` | string | `"185.220.101.42"` | Extracted IP |
| `port` | number | `8333` | Extracted port |
| `addr` | string | `"185.220.101.42:8333"` | Full address |
| `direction` | string | `"IN"` or `"OUT"` | Connection direction |
| `connection_type` | string | `"outbound-full-relay"` | Full type name |
| `connection_type_abbrev` | string | `"OFR"` | Abbreviated |
| `conntime` | number | `1707912345` | Connection start (unix) |
| `conntime_fmt` | string | `"2d4h"` | Formatted duration |
| `version` | number | `70016` | Protocol version |
| `subver` | string | `"/Satoshi:27.0.0/"` | Client software |
| `services` | array | `["NETWORK","WITNESS"]` | Service flag names |
| `services_abbrev` | string | `"N L W C"` | Abbreviated services |
| `in_addrman` | boolean | `true` | In Bitcoin's addrman |

**Traffic:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `bytessent` | number | `142800000` | Bytes sent to this peer |
| `bytesrecv` | number | `89300000` | Bytes received from peer |
| `bytessent_fmt` | string | `"142.8 MB"` | Formatted |
| `bytesrecv_fmt` | string | `"89.3 MB"` | Formatted |
| `ping_ms` | number | `32.5` | Ping latency in ms |

**Geolocation:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `lat` | number | `48.1351` | Latitude |
| `lon` | number | `11.5820` | Longitude |
| `city` | string | `"Munich"` | City name |
| `region` | string | `"BY"` | Region/state code |
| `regionName` | string | `"Bavaria"` | Region full name |
| `country` | string | `"Germany"` | Country name |
| `countryCode` | string | `"DE"` | ISO 3166 country code |
| `continent` | string | `"Europe"` | Continent name |
| `continentCode` | string | `"EU"` | Continent code |
| `timezone` | string | `"Europe/Berlin"` | IANA timezone |
| `location` | string | `"Munich, Bavaria"` | Formatted |
| `location_status` | string | `"ok"` | ok / pending / private / unavailable |

**Organization / ASN:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `isp` | string | `"Hetzner Online GmbH"` | ISP name |
| `org` | string | `"Hetzner Online GmbH"` | Organization |
| `as` | string | `"AS24940 Hetzner..."` | ASN string (number + name) |
| `asname` | string | `"HETZNER-AS"` | Short AS identifier |

**Flags:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `mobile` | boolean | `false` | Mobile network? |
| `proxy` | boolean | `false` | VPN/proxy? |
| `hosting` | boolean | `true` | Datacenter/hosting? |

---

## 7. Database Schema

**Database:** SQLite at `data/geo.db`
**Table:** `geo_cache`

```sql
CREATE TABLE IF NOT EXISTS geo_cache (
    ip            TEXT PRIMARY KEY,
    continent     TEXT,
    continentCode TEXT,
    country       TEXT,
    countryCode   TEXT,
    region        TEXT,
    regionName    TEXT,
    city          TEXT,
    district      TEXT,
    zip           TEXT,
    lat           REAL,
    lon           REAL,
    timezone      TEXT,
    utc_offset    INTEGER,
    currency      TEXT,
    isp           TEXT,
    org           TEXT,
    as_info       TEXT,       -- "AS24940 Hetzner Online GmbH" (number + name)
    asname        TEXT,       -- "HETZNER-AS" (short identifier)
    mobile        INTEGER DEFAULT 0,
    proxy         INTEGER DEFAULT 0,
    hosting       INTEGER DEFAULT 0,
    last_updated  INTEGER     -- Unix timestamp
);

-- Indexes:
CREATE INDEX idx_geo_country ON geo_cache(countryCode);
CREATE INDEX idx_geo_updated ON geo_cache(last_updated);
```

**Key ASN columns:**
- `as_info` → exposed to frontend as `peer.as` (e.g., `"AS24940 Hetzner Online GmbH"`)
- `asname` → exposed to frontend as `peer.asname` (e.g., `"HETZNER-AS"`)

**Data source:** ip-api.com (free tier, rate limited to 1 req/1.5s)

---

## 8. AS Aggregation — What We Compute

All computation happens **client-side in JavaScript** from the `lastPeers` array.
No backend changes needed.

### Per-AS Computed Fields

```javascript
{
    asNumber: "AS24940",              // Extracted from peer.as
    asName: "Hetzner Online GmbH",   // Extracted from peer.as (after number)
    asShort: "HETZNER-AS",           // From peer.asname
    color: "#...",                    // Assigned from palette

    // Counts
    peerCount: 12,
    percentage: 18.2,
    inboundCount: 8,
    outboundCount: 4,

    // Connection type breakdown
    fullRelayCount: 4,
    blockOnlyCount: 6,
    inboundTypeCount: 2,             // inbound connection_type
    manualCount: 0,

    // Performance averages
    avgPingMs: 32.5,
    avgDurationSecs: 389000,
    avgDurationFmt: "4d 12h",
    totalBytesSent: 142800000,
    totalBytesRecv: 89300000,
    totalBytesSentFmt: "142.8 MB",
    totalBytesRecvFmt: "89.3 MB",

    // Software distribution
    versions: [
        { subver: "/Satoshi:27.0.0/", count: 10 },
        { subver: "/Satoshi:25.0.0/", count: 2 },
    ],

    // Country distribution
    countries: [
        { code: "DE", name: "Germany", count: 10 },
        { code: "FI", name: "Finland", count: 2 },
    ],

    // Service flag distribution
    servicesCombos: [
        { abbrev: "N L W C", count: 8 },
        { abbrev: "N L W", count: 4 },
    ],

    // Flags
    isHosting: true,                 // majority of peers have hosting=true
    hostingLabel: "Cloud/Hosting",   // or "Residential", "Mixed"

    // Risk assessment
    riskLevel: "moderate",           // "low", "moderate", "high", "critical"
    riskLabel: "Moderate Concentration",

    // Peer references
    peerIds: [1, 5, 12, ...],       // For filtering and map highlighting
}
```

### Diversity Score Formula

```
Score = (1 - HHI) * 10

Where HHI = Σ(share_i²)  (Herfindahl-Hirschman Index)
share_i = peer_count_of_AS_i / total_peers
```

| Score | Label | Color |
|-------|-------|-------|
| 8-10 | Excellent diversity | Green |
| 6-8 | Good diversity | Light green |
| 4-6 | Moderate — could improve | Yellow/warn |
| 2-4 | Poor — too concentrated | Orange |
| 0-2 | Critical — single AS dominance | Red |

### Concentration Risk Per-AS

| % of peers | Risk Level | Label |
|------------|------------|-------|
| < 15% | Low | — (no warning shown) |
| 15-30% | Moderate | Moderate Concentration |
| 30-50% | High | High Concentration |
| > 50% | Critical | Critical — Dominates Network |

---

## 9. UI Components

### A. View Toggle (in topbar)

```html
<div class="as-view-toggle">
    <button class="as-vt-btn active" data-view="map">Peer Map</button>
    <button class="as-vt-btn" data-view="as">AS Diversity</button>
</div>
```

### B. Donut Chart Container

```html
<div id="as-diversity-container" class="as-diversity-container hidden">
    <svg id="as-donut" class="as-donut" viewBox="0 0 200 200"></svg>
    <div id="as-donut-center" class="as-donut-center">
        <div class="as-score-value">7.2</div>
        <div class="as-score-label">DIVERSITY</div>
    </div>
    <div id="as-legend" class="as-legend"></div>
</div>
```

### C. Hover Tooltip

```html
<div id="as-tooltip" class="as-tooltip hidden"></div>
```

### D. Detail Panel

```html
<div id="as-detail-panel" class="as-detail-panel hidden">
    <div class="as-detail-header">...</div>
    <div class="as-detail-body">...</div>
</div>
```

---

## 10. Interaction Model

### State Machine

```
IDLE
  │
  ├─ hover segment/legend → HOVERING (show tooltip + lines)
  │   └─ leave → IDLE (hide tooltip + lines)
  │
  └─ click segment/legend → SELECTED (open panel + filter + highlight)
      │
      ├─ hover different segment → show tooltip over panel (lines update)
      │
      ├─ click same segment → IDLE (close panel, unfilter, unhighlight)
      ├─ click different segment → SELECTED (switch to that AS)
      ├─ click X button → IDLE
      ├─ press Escape → IDLE
      └─ click outside → IDLE
```

### Map Integration

**Hover:**
- Draw semi-transparent lines from map center to each peer of hovered AS
- Lines use the AS's assigned color
- Non-hovered peers keep normal rendering

**Selected:**
- Dim all peers NOT in the selected AS (reduce opacity to ~0.2)
- Draw prominent lines to selected AS's peers
- Selected AS's peers render at full brightness

---

## 11. Ideas & Future Enhancements

### Near-term
- **Searchable dropdown** in donut center — type to find any AS
- **AS history** — track AS distribution over time (would need backend)
- **Export** — copy AS diversity report to clipboard
- **Keyboard nav** — arrow keys to cycle through segments

### Medium-term
- **Country diversity** — same donut concept but grouped by country
- **ISP diversity** — similar view using ISP field instead of AS
- **Hosting ratio** — what % of peers are datacenter vs residential
- **Network diversity overlay** — AS diversity per network type (IPv4 vs Tor etc.)

### Long-term
- **Peer recommendation** — suggest adding manual peers to improve diversity
- **Historical trends** — graph diversity score over days/weeks
- **Alert thresholds** — notify when diversity drops below threshold
- **Comparison** — compare your diversity against network averages

---

## 12. Existing Patterns to Reuse

### CSS Variables (from bitstyle.css `:root`)
```css
--bg-void: #06080c;
--bg-deep: #0a0e14;
--bg-surface: #111820;
--bg-raised: #19202b;
--text-primary: #e6edf3;
--text-secondary: #8b949e;
--text-muted: #6e7681;
--accent: #58a6ff;
--ok: #3fb950;
--warn: #d29922;
--err: #f85149;
--title-accent: #e8c547;
--section-color: #b0b8c4;
--font-ui: 'Inter', ...;
--font-data: 'SF Mono', ...;
--transition: 0.2s ease;
--radius: 6px;
```

### Modal HTML Pattern
```javascript
// All modals follow this exact pattern:
const overlay = document.createElement('div');
overlay.className = 'modal-overlay';
overlay.innerHTML = `
    <div class="modal-box">
        <div class="modal-header">
            <span class="modal-title">TITLE</span>
            <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">...</div>
    </div>`;
document.body.appendChild(overlay);
```

### Section Title Pattern
```html
<div class="modal-section-title">SECTION NAME</div>
<div class="modal-row">
    <span class="modal-label">Label</span>
    <span class="modal-val">Value</span>
</div>
```

### Tooltip Row Pattern
```javascript
function ttRow(label, value) {
    if (!value) return '';
    return `<div class="tt-row"><span class="tt-label">${label}</span><span class="tt-val">${value}</span></div>`;
}
```

### Z-Index Layers
```
50  — map overlays (left, right)
80  — peer panel
85  — btc price, map controls
90  — flight deck
100 — topbar
200 — tooltips
250 — popups, settings
260 — advanced panel  ← AS detail panel goes here
300 — modals (topmost)
```

---

## 13. Technical Notes

### Data Flow
1. `fetchPeers()` in bitapp.js fetches `/api/peers` every 10s
2. Response is stored in `lastPeers[]` (raw) and `nodes[]` (canvas-ready)
3. Integration hook calls `ASDiversity.update(lastPeers)` after each fetch
4. AS module aggregates, re-renders donut, updates panel if open
5. All computation is O(n) where n = peer count (typically 30-125 peers)

### No Backend Changes Required
Everything is computed client-side from existing peer data. The `as` and `asname`
fields are already present in the API response. No new endpoints needed.

### Browser Compatibility
Same as existing app — modern browsers with ES6+ support. SVG for donut,
CSS custom properties, backdrop-filter, flexbox.

### Performance
- Donut SVG is lightweight (~10 path elements)
- Aggregation runs once per 10s poll (trivial cost)
- Detail panel content is built once on open, not continuously
- Canvas line drawing for hover/selection reuses existing render loop

---

*End of plan document.*
