/* ============================================================
   MBCore vNext — Canvas World Map with Real Bitcoin Peers
   Interaction Stabilization Pass
   ============================================================
   - Fetches real peers from the existing MBCoreServer backend
   - Renders them on a canvas world map (no Leaflet)
   - Private/overlay networks (Tor, I2P, CJDNS) placed in Antarctica
   - Visual peer lifecycle: arrival bloom → age brightness → fade-out
   - Inbound vs outbound peers have distinct pulse rhythms
   - Long-lived peers glow bright & steady; fresh peers dim & nervous
   - Rich hover tooltip with identity, location, network, performance
   - Collapsible bottom panel with full peer table
   - Bidirectional highlight: hover map node ↔ table row
   - Click table row → center map on that peer
   - Peer actions: disconnect, ban (24h)
   - Network badge click-to-filter + hover stats popover
   - Horizontal world wrapping (seamless pan)
   - Vertical lock at zoom 1, vertical clamping at all zooms
   - Antarctica annotation for private network peers
   ============================================================ */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const CFG = {
        pollInterval: 10000,       // ms between /api/peers fetches
        infoPollInterval: 15000,   // ms between /api/info fetches
        nodeRadius: 3,             // base circle radius in px
        glowRadius: 14,            // outer glow radius in px
        fadeInDuration: 800,       // ms for opacity fade-in
        fadeOutDuration: 1500,     // ms for disconnected node fade-out
        minZoom: 1,
        maxZoom: 18,
        zoomStep: 1.15,
        panSmooth: 0.12,           // smoothing factor for view interpolation
        gridSpacing: 30,           // degrees between grid lines
        coastlineWidth: 1.0,

        // ── Arrival bloom (first ~5 seconds) ──
        arrivalDuration: 5000,     // ms — how long the arrival phase lasts
        arrivalRingMaxRadius: 28,  // px — expanding ring max radius
        arrivalRingDuration: 1200, // ms — how long the ring expansion takes
        arrivalPulseSpeed: 0.006,  // fast energetic pulse during arrival

        // ── Connection age -> brightness & steadiness ──
        ageBrightnessMin: 0.35,    // floor opacity for brand-new peers
        ageBrightnessMax: 1.0,     // ceiling opacity for veteran peers
        ageRampSeconds: 3600,      // seconds to go from min to max brightness (1 hour)

        // ── Pulse behaviour by direction ──
        // Base rates — new peers get additional "nervousness" on top
        pulseSpeedInbound: 0.0014,   // slower, calm breathing for inbound
        pulseSpeedOutbound: 0.0026,  // faster, sharper pulse for outbound
        pulseDepthInbound: 0.32,     // gentle but visible amplitude for inbound
        pulseDepthOutbound: 0.48,    // more pronounced for outbound
        // Nervousness: young peers pulse faster, veterans are steady
        nervousnessMax: 0.003,     // extra pulse speed added to young peers
        nervousnessRampSec: 1800,  // seconds for nervousness to decay to zero (30 min)

        // ── Fade-out ──
        fadeOutEase: 2.0,          // exponent for ease-out curve
    };

    // ═══════════════════════════════════════════════════════════
    // NETWORK COLOURS (match bitstyle.css --net-* variables)
    // ═══════════════════════════════════════════════════════════

    const NET_COLORS = {
        ipv4:  { r: 227, g: 179, b: 65  },   // gold
        ipv6:  { r: 240, g: 113, b: 120 },   // coral
        onion: { r: 74,  g: 158, b: 255 },   // sky blue (Tor)
        i2p:   { r: 139, g: 92,  b: 246 },   // purple
        cjdns: { r: 210, g: 168, b: 255 },   // lavender
    };
    // Fallback colour for unknown network types
    const NET_COLOR_UNKNOWN = { r: 120, g: 130, b: 140 };

    // Map internal network names to display-friendly labels
    const NET_DISPLAY = {
        ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS',
    };

    // ═══════════════════════════════════════════════════════════
    // ANTARCTICA RESEARCH STATIONS
    // Private/overlay peers get placed here (same stations as v5)
    // ═══════════════════════════════════════════════════════════

    const ANTARCTICA_STATIONS = [
        { lat: -67.6020, lon: 62.8730  },  // Mawson Station
        { lat: -68.5760, lon: 77.9670  },  // Davis Station
        { lat: -66.2810, lon: 110.5280 },  // Casey Station
        { lat: -66.6630, lon: 140.0010 },  // Dumont d'Urville
        { lat: -69.0050, lon: 39.5800  },  // Syowa Station
        { lat: -70.6670, lon: 11.6330  },  // Novolazarevskaya
        { lat: -70.7500, lon: -8.2500  },  // Neumayer Station
        { lat: -70.4500, lon: -2.8420  },  // SANAE IV Station
    ];

    // Cache so each peer always lands on the same Antarctica spot
    const antarcticaCache = {};

    // ═══════════════════════════════════════════════════════════
    // CANVAS & VIEW STATE
    // ═══════════════════════════════════════════════════════════

    const canvas = document.getElementById('worldmap');
    const ctx = canvas.getContext('2d');
    let W, H;  // canvas logical dimensions (CSS pixels)

    // Current view (smoothly interpolated each frame)
    let view = { x: 0, y: 0, zoom: 1 };
    // Target view (set instantly by user input, view lerps toward it)
    let targetView = { x: 0, y: 0, zoom: 1 };

    // Mouse drag state
    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let dragViewStart = { x: 0, y: 0 };

    // ═══════════════════════════════════════════════════════════
    // NODE STATE
    // Nodes are built from /api/peers responses.
    // Each node has animation metadata (spawnTime, fadeOutStart).
    // ═══════════════════════════════════════════════════════════

    let nodes = [];          // currently visible + fading-out nodes
    let knownPeerIds = {};   // id -> true, tracks which peers we've seen
    let lastPeers = [];      // raw API response for table rendering
    let highlightedPeerId = null;  // peer ID highlighted via map↔table interaction

    // Network filter: Set of enabled network keys. When ALL networks are enabled, equivalent to "All".
    const ALL_NETS = new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);
    let enabledNets = new Set(ALL_NETS);  // start with all enabled

    /** Check if all networks are enabled (= "All" state) */
    function isAllNetsEnabled() {
        for (const n of ALL_NETS) {
            if (!enabledNets.has(n)) return false;
        }
        return true;
    }

    /** Check if a node passes the current network filter */
    function passesNetFilter(netKey) {
        return enabledNets.has(netKey);
    }

    // ═══════════════════════════════════════════════════════════
    // WORLD GEOMETRY STATE
    // Land polygons, lake polygons, borders, and cities loaded
    // from static assets. Each layer appears at different zoom levels.
    // ═══════════════════════════════════════════════════════════

    let worldPolygons = [];
    let lakePolygons = [];
    let borderLines = [];      // country border line strings
    let stateLines = [];       // state/province border line strings
    let cityPoints = [];       // { n: name, p: population, c: [lon,lat] }
    let countryLabels = [];    // { n: name, c: [lon,lat] } — country centroids (English)
    let stateLabels = [];      // { n: name, c: [lon,lat] } — state/province centroids (English)
    let worldReady = false;
    let lakesReady = false;
    let bordersReady = false;
    let statesReady = false;
    let citiesReady = false;
    let countryLabelsReady = false;
    let stateLabelsReady = false;

    // Zoom thresholds for progressive detail layers
    // Country borders render at ALL zoom levels (no threshold)
    // Label hierarchy: countries first → states → cities
    const ZOOM_SHOW_COUNTRY_LABELS = 1.5;  // country names appear (medium zoom)
    const ZOOM_SHOW_STATES         = 3.0;  // state/province borders appear
    const ZOOM_SHOW_STATE_LABELS   = 4.0;  // state/province names (after countries visible)
    const ZOOM_SHOW_CITIES_MAJOR   = 6.0;  // cities > 5M population
    const ZOOM_SHOW_CITIES_LARGE   = 8.0;  // cities > 1M population
    const ZOOM_SHOW_CITIES_MED     = 10.0; // cities > 300K population
    const ZOOM_SHOW_CITIES_ALL     = 12.0; // all cities

    // DOM references
    const clockEl = document.getElementById('clock');
    const tooltipEl = document.getElementById('node-tooltip');
    const antNote = document.getElementById('antarctica-note');
    let hoveredNode = null;
    let pinnedNode = null;  // Tooltip pins when user clicks a node or table row

    // ═══════════════════════════════════════════════════════════
    // PULSE ON CHANGE — Number animation system
    // Ported from legacy dashboard.js with all 4 modes
    // ═══════════════════════════════════════════════════════════

    const prevValues = {};  // elementId -> previous numeric value

    function pulseOnChange(elementId, newValue, mode) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const numNew = parseFloat(String(newValue).replace(/[^0-9.\-]/g, ''));
        if (isNaN(numNew)) { prevValues[elementId] = null; return; }
        const prev = prevValues[elementId];
        prevValues[elementId] = numNew;
        if (prev === null || prev === undefined) return;
        if (numNew === prev) return;
        const up = numNew > prev;
        const allClasses = ['pulse-up','pulse-down','pulse-up-long','pulse-down-long','pulse-white','price-up','price-down','price-pulse-up','price-pulse-down'];
        allClasses.forEach(c => el.classList.remove(c));
        void el.offsetWidth;  // force reflow
        if (mode === 'white') {
            el.classList.add('pulse-white');
            setTimeout(() => el.classList.remove('pulse-white'), 1500);
        } else if (mode === 'long') {
            el.classList.add(up ? 'pulse-up-long' : 'pulse-down-long');
            setTimeout(() => el.classList.remove('pulse-up-long','pulse-down-long'), 5000);
        } else if (mode === 'persistent') {
            el.classList.add(up ? 'price-pulse-up' : 'price-pulse-down');
            setTimeout(() => {
                el.classList.remove('price-pulse-up','price-pulse-down');
                el.classList.add(up ? 'price-up' : 'price-down');
            }, 2000);
        } else {
            el.classList.add(up ? 'pulse-up' : 'pulse-down');
            setTimeout(() => el.classList.remove('pulse-up','pulse-down'), 1500);
        }
        return up ? 1 : -1;
    }

    function showDeltaIndicator(parentEl, delta) {
        if (!parentEl || delta === 0) return;
        const existing = parentEl.querySelector('.delta-indicator');
        if (existing) existing.remove();
        const span = document.createElement('span');
        span.className = 'delta-indicator ' + (delta > 0 ? 'delta-up' : 'delta-down');
        span.textContent = (delta > 0 ? '+' : '') + delta;
        parentEl.appendChild(span);
        setTimeout(() => span.remove(), 2500);
    }

    // ═══════════════════════════════════════════════════════════
    // BTC SUPPORT ADDRESS — Selectable text (no click handler)
    // ═══════════════════════════════════════════════════════════
    // Address is plain selectable text — users can highlight and copy manually.

    // ═══════════════════════════════════════════════════════════
    // FLIGHT DECK — Toggle + Network stats
    // ═══════════════════════════════════════════════════════════

    const flightDeck = document.getElementById('flight-deck');
    const fdToggle = document.getElementById('fd-toggle');
    if (fdToggle && flightDeck) {
        fdToggle.addEventListener('click', () => {
            flightDeck.classList.toggle('collapsed');
            fdToggle.textContent = flightDeck.classList.contains('collapsed') ? '\u25B4' : '\u25BE';
        });
    }

    // Previous flight deck counts for delta indicators
    const fdPrevCounts = {};

    // Cached flight deck counts for tooltip use
    let fdCachedCounts = { ipv4: {in:0,out:0}, ipv6: {in:0,out:0}, onion: {in:0,out:0}, i2p: {in:0,out:0}, cjdns: {in:0,out:0} };

    function updateFlightDeck(peerNodes) {
        const counts = { ipv4: {in:0,out:0}, ipv6: {in:0,out:0}, onion: {in:0,out:0}, i2p: {in:0,out:0}, cjdns: {in:0,out:0} };
        for (const n of peerNodes) {
            if (!n.alive) continue;
            const net = n.net || 'ipv4';
            if (!counts[net]) continue;
            if (n.direction === 'IN') counts[net].in++;
            else counts[net].out++;
        }
        fdCachedCounts = counts;
        const netMap = { ipv4:'ipv4', ipv6:'ipv6', onion:'tor', i2p:'i2p', cjdns:'cjdns' };
        for (const [net, label] of Object.entries(netMap)) {
            const c = counts[net];
            const inEl = document.getElementById(`fd-${label}-in`);
            const outEl = document.getElementById(`fd-${label}-out`);
            if (inEl) {
                const oldIn = fdPrevCounts[`${net}-in`] || 0;
                inEl.textContent = c.in;
                if (oldIn !== c.in && fdPrevCounts[`${net}-in`] !== undefined) {
                    pulseOnChange(`fd-${label}-in`, c.in);
                    showDeltaIndicator(inEl.parentElement, c.in - oldIn);
                }
                fdPrevCounts[`${net}-in`] = c.in;
            }
            if (outEl) {
                const oldOut = fdPrevCounts[`${net}-out`] || 0;
                outEl.textContent = c.out;
                if (oldOut !== c.out && fdPrevCounts[`${net}-out`] !== undefined) {
                    pulseOnChange(`fd-${label}-out`, c.out);
                    showDeltaIndicator(outEl.parentElement, c.out - oldOut);
                }
                fdPrevCounts[`${net}-out`] = c.out;
            }
            // Green/red dot indicator (enabled = has peers, disabled = no peers)
            const dotEl = document.getElementById(`fd-${label}-dot`);
            if (dotEl) {
                const total = c.in + c.out;
                if (total > 0) {
                    dotEl.className = 'fd-net-dot enabled';
                } else {
                    dotEl.className = 'fd-net-dot disabled';
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FLIGHT DECK HOVER TOOLTIPS — Detailed network info on hover
    // ═══════════════════════════════════════════════════════════

    const fdTooltipEl = document.getElementById('fd-tooltip');

    // Friendly names and descriptions for each network
    const FD_NET_INFO = {
        ipv4:  { full: 'Public IPv4 network', label: 'Public IPv4', isOverlay: false },
        ipv6:  { full: 'Public IPv6 network', label: 'Public IPv6', isOverlay: false },
        onion: { full: 'Tor onion routing network', label: 'Tor onion routing network', isOverlay: true },
        i2p:   { full: 'I2P anonymous network', label: 'I2P anonymous network', isOverlay: true },
        cjdns: { full: 'CJDNS encrypted mesh network', label: 'CJDNS encrypted mesh network', isOverlay: true },
    };

    // Map data-net attributes back to internal net keys
    const FD_NET_KEY_MAP = { ipv4: 'ipv4', ipv6: 'ipv6', onion: 'onion', i2p: 'i2p', cjdns: 'cjdns' };

    function buildFdTooltip(netKey) {
        const info = FD_NET_INFO[netKey];
        if (!info) return '';
        const c = fdCachedCounts[netKey] || { in: 0, out: 0 };
        const total = c.in + c.out;
        const isEnabled = total > 0;

        // Get score for ipv4/ipv6
        let scoreVal = null;
        if (!info.isOverlay) {
            const scoreEl = document.getElementById(`fd-${netKey === 'onion' ? 'tor' : netKey}-score`);
            if (scoreEl) scoreVal = scoreEl.textContent;
        }

        let html = '<div class="fdt-title">';
        if (isEnabled) {
            html += `${info.full} <span class="fdt-status-enabled">(Enabled)</span>`;
        } else {
            html += `${info.label} <span class="fdt-status-disabled">(Disabled)</span>`;
        }
        html += '</div>';

        html += `<div class="fdt-row">Inbound: ${c.in} peers</div>`;
        html += `<div class="fdt-row">Outbound: ${c.out} peers</div>`;

        if (info.isOverlay) {
            html += '<div class="fdt-row-muted">Overlay network (no reliable local score)</div>';
        } else if (scoreVal) {
            html += `<div class="fdt-row">Local Bitcoin Core Network Score: ${scoreVal}</div>`;
        }

        if (isEnabled) {
            if (info.isOverlay) {
                html += '<div class="fdt-row-muted">Appears to be properly configured</div>';
            }
        } else {
            html += '<div class="fdt-warn">This network is either disabled, or not currently connected.<br>Please check your settings in Bitcoin Core</div>';
        }

        return html;
    }

    // Attach hover listeners to all flight deck chips
    document.querySelectorAll('.fd-net-chip').forEach(chip => {
        chip.addEventListener('mouseenter', () => {
            const netKey = chip.dataset.net;
            if (!fdTooltipEl) return;
            const html = buildFdTooltip(netKey);
            if (!html) return;
            fdTooltipEl.innerHTML = html;
            fdTooltipEl.classList.remove('hidden');
            // Position below the chip
            const rect = chip.getBoundingClientRect();
            fdTooltipEl.style.left = rect.left + 'px';
            fdTooltipEl.style.top = (rect.bottom + 6) + 'px';
        });
        chip.addEventListener('mouseleave', () => {
            if (fdTooltipEl) fdTooltipEl.classList.add('hidden');
        });
    });

    // ═══════════════════════════════════════════════════════════
    // MINIMIZE BUTTON — Toggle peer panel collapsed state
    // ═══════════════════════════════════════════════════════════

    const minimizeBtn = document.getElementById('btn-minimize');
    const mapControlsEl = document.getElementById('map-controls');

    /** Reposition map controls above the peer panel (expanded or collapsed) + footer */
    function repositionMapControls() {
        if (!mapControlsEl) return;
        const panel = document.getElementById('peer-panel');
        if (!panel) return;
        const panelRect = panel.getBoundingClientRect();
        const panelHeight = window.innerHeight - panelRect.top;
        // 28px footer + panel visible height + 8px margin
        mapControlsEl.style.bottom = (panelHeight + 28 + 8) + 'px';
    }

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById('peer-panel');
            if (panel) {
                panel.classList.toggle('collapsed');
                const isCollapsed = panel.classList.contains('collapsed');
                minimizeBtn.innerHTML = isCollapsed ? 'Show Table &#9650;' : 'Hide Table &#9660;';
                // Reposition map controls after transition
                setTimeout(repositionMapControls, 350);
            }
        });
    }

    // Initial positioning of map controls
    setTimeout(repositionMapControls, 100);

    // ═══════════════════════════════════════════════════════════
    // BTC PRICE STATE
    // ═══════════════════════════════════════════════════════════

    let btcCurrency = 'USD';
    let btcPriceInterval = 10;  // seconds
    let lastBtcPrice = null;
    let btcPriceTimer = null;

    // ═══════════════════════════════════════════════════════════
    // CURRENCY SELECTOR DROPDOWN
    // ═══════════════════════════════════════════════════════════

    const CURRENCIES = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','CNY','HKD','SGD'];
    let currencyDropdownEl = null;

    const currCodeEl = document.getElementById('mo-btc-currency');
    if (currCodeEl) {
        currCodeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currencyDropdownEl) { closeCurrencyDropdown(); return; }
            openCurrencyDropdown();
        });
    }

    function openCurrencyDropdown() {
        closeCurrencyDropdown();
        const dd = document.createElement('div');
        dd.className = 'currency-dropdown';
        dd.id = 'currency-dropdown';
        let html = '<div class="curr-title">Select Currency</div><div class="curr-grid">';
        for (const c of CURRENCIES) {
            html += `<button class="curr-btn${c === btcCurrency ? ' active' : ''}" data-curr="${c}">${c}</button>`;
        }
        html += '</div>';
        html += `<div class="curr-freq"><span>Update every</span><input type="number" id="curr-freq-input" value="${btcPriceInterval}" min="5" max="99"><span>sec</span></div>`;
        dd.innerHTML = html;
        document.body.appendChild(dd);
        currencyDropdownEl = dd;

        // Position near the currency code element
        const rect = currCodeEl.getBoundingClientRect();
        dd.style.left = Math.max(8, rect.left - 60) + 'px';
        dd.style.top = (rect.bottom + 6) + 'px';

        dd.querySelectorAll('.curr-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btcCurrency = btn.dataset.curr;
                currCodeEl.textContent = btcCurrency;
                dd.querySelectorAll('.curr-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                fetchInfo();
            });
        });

        const freqInput = document.getElementById('curr-freq-input');
        if (freqInput) {
            freqInput.addEventListener('change', () => {
                const v = clamp(parseInt(freqInput.value) || 10, 5, 99);
                freqInput.value = v;
                btcPriceInterval = v;
                // Restart info poll with new interval
                if (btcPriceTimer) clearInterval(btcPriceTimer);
                btcPriceTimer = setInterval(fetchInfo, btcPriceInterval * 1000);
            });
        }

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeCurrencyOnOutside);
        }, 0);
    }

    function closeCurrencyOnOutside(e) {
        if (currencyDropdownEl && !currencyDropdownEl.contains(e.target) && e.target !== currCodeEl) {
            closeCurrencyDropdown();
        }
    }

    function closeCurrencyDropdown() {
        if (currencyDropdownEl) {
            currencyDropdownEl.remove();
            currencyDropdownEl = null;
        }
        document.removeEventListener('click', closeCurrencyOnOutside);
    }

    // ═══════════════════════════════════════════════════════════
    // MEMPOOL MODAL
    // ═══════════════════════════════════════════════════════════

    function openMempoolModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'mempool-modal';
        overlay.innerHTML = `<div class="modal-box"><div class="modal-header"><span class="modal-title">Mempool Info</span><button class="modal-close" id="mempool-close">&times;</button></div><div class="modal-body" id="mempool-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        document.getElementById('mempool-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        fetch(`/api/mempool?currency=${btcCurrency}`).then(r => r.json()).then(data => {
            const body = document.getElementById('mempool-body');
            if (!body) return;
            if (data.error) { body.innerHTML = `<div style="color:var(--err)">${data.error}</div>`; return; }
            const mp = data.mempool;
            if (!mp) { body.innerHTML = '<div style="color:var(--text-muted)">No data</div>'; return; }
            const price = data.btc_price || 0;
            let html = '';
            html += `<div class="modal-row"><span class="modal-label">Pending Transactions</span><span class="modal-val modal-val-highlight">${(mp.size || 0).toLocaleString()}</span></div>`;
            html += `<div class="modal-row"><span class="modal-label">Data Size</span><span class="modal-val">${((mp.bytes || 0) / 1e6).toFixed(2)} MB</span></div>`;
            html += `<div class="modal-row"><span class="modal-label">Memory Usage</span><span class="modal-val">${((mp.usage || 0) / 1e6).toFixed(2)} MB</span></div>`;
            const totalFeesBTC = mp.total_fee || 0;
            const totalFeesFiat = price ? ` ($${(totalFeesBTC * price).toFixed(2)})` : '';
            html += `<div class="modal-row"><span class="modal-label">Total Fees</span><span class="modal-val">${totalFeesBTC.toFixed(8)} BTC${totalFeesFiat}</span></div>`;
            html += `<div class="modal-row"><span class="modal-label">Max Mempool Size</span><span class="modal-val">${((mp.maxmempool || 0) / 1e6).toFixed(0)} MB</span></div>`;
            if (mp.mempoolminfee != null) {
                const satVb = (mp.mempoolminfee * 1e8 / 1000).toFixed(2);
                html += `<div class="modal-row"><span class="modal-label">Min Accepted Fee</span><span class="modal-val">${satVb} sat/vB</span></div>`;
            }
            if (mp.minrelaytxfee != null) {
                const satVb = (mp.minrelaytxfee * 1e8 / 1000).toFixed(2);
                html += `<div class="modal-row"><span class="modal-label">Min Relay Fee</span><span class="modal-val">${satVb} sat/vB</span></div>`;
            }
            if (mp.incrementalrelayfee != null) {
                const satVb = (mp.incrementalrelayfee * 1e8 / 1000).toFixed(2);
                html += `<div class="modal-row"><span class="modal-label">RBF Increment</span><span class="modal-val">${satVb} sat/vB</span></div>`;
            }
            if (mp.unbroadcastcount != null) {
                const cls = mp.unbroadcastcount === 0 ? 'modal-val-ok' : 'modal-val-highlight';
                html += `<div class="modal-row"><span class="modal-label">Unbroadcast Txs</span><span class="modal-val ${cls}">${mp.unbroadcastcount}</span></div>`;
            }
            if (mp.fullrbf != null) {
                const cls = mp.fullrbf ? 'modal-val-ok' : 'modal-val-warn';
                html += `<div class="modal-row"><span class="modal-label">Full RBF</span><span class="modal-val ${cls}">${mp.fullrbf ? 'Enabled' : 'Disabled'}</span></div>`;
            }
            body.innerHTML = html;
        }).catch(err => {
            const body = document.getElementById('mempool-body');
            if (body) body.innerHTML = `<div style="color:var(--err)">Error: ${err.message}</div>`;
        });
    }

    // ═══════════════════════════════════════════════════════════
    // BLOCKCHAIN MODAL
    // ═══════════════════════════════════════════════════════════

    function openBlockchainModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'blockchain-modal';
        overlay.innerHTML = `<div class="modal-box"><div class="modal-header"><span class="modal-title">Blockchain Info</span><button class="modal-close" id="blockchain-close">&times;</button></div><div class="modal-body" id="blockchain-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        document.getElementById('blockchain-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        fetch('/api/blockchain').then(r => r.json()).then(data => {
            const body = document.getElementById('blockchain-body');
            if (!body) return;
            if (data.error) { body.innerHTML = `<div style="color:var(--err)">${data.error}</div>`; return; }
            const bc = data.blockchain;
            if (!bc) { body.innerHTML = '<div style="color:var(--text-muted)">No data</div>'; return; }
            let html = '';
            html += `<div class="modal-row"><span class="modal-label">Chain</span><span class="modal-val modal-val-highlight">${bc.chain || '—'}</span></div>`;
            html += `<div class="modal-row"><span class="modal-label">Block Height</span><span class="modal-val modal-val-ok">${(bc.blocks || 0).toLocaleString()}</span></div>`;
            if (bc.headers) {
                const pct = bc.blocks && bc.headers ? ((bc.blocks / bc.headers) * 100).toFixed(2) : '100';
                html += `<div class="modal-row"><span class="modal-label">Sync Progress</span><span class="modal-val">${bc.blocks.toLocaleString()} / ${bc.headers.toLocaleString()} (${pct}%)</span></div>`;
            }
            if (bc.bestblockhash) {
                const short = bc.bestblockhash.substring(0, 20) + '...';
                html += `<div class="modal-row"><span class="modal-label">Best Block Hash</span><span class="modal-val" title="${bc.bestblockhash}">${short}</span></div>`;
            }
            if (bc.difficulty) {
                const diff = parseFloat(bc.difficulty);
                const humanDiff = diff > 1e12 ? (diff / 1e12).toFixed(2) + 'T' : diff.toLocaleString();
                html += `<div class="modal-row"><span class="modal-label">Difficulty</span><span class="modal-val" title="${bc.difficulty}">${humanDiff}</span></div>`;
            }
            if (bc.mediantime) {
                html += `<div class="modal-row"><span class="modal-label">Median Time</span><span class="modal-val">${new Date(bc.mediantime * 1000).toLocaleString()}</span></div>`;
            }
            if (bc.chainwork) {
                const short = bc.chainwork.substring(0, 20) + '...';
                html += `<div class="modal-row"><span class="modal-label">Chain Work</span><span class="modal-val" title="${bc.chainwork}">${short}</span></div>`;
            }
            html += `<div class="modal-row"><span class="modal-label">IBD Status</span><span class="modal-val ${bc.initialblockdownload ? 'modal-val-warn' : 'modal-val-ok'}">${bc.initialblockdownload ? 'Yes' : 'No'}</span></div>`;
            if (bc.size_on_disk) {
                html += `<div class="modal-row"><span class="modal-label">Size on Disk</span><span class="modal-val">${(bc.size_on_disk / 1e9).toFixed(1)} GB</span></div>`;
            }
            html += `<div class="modal-row"><span class="modal-label">Pruning</span><span class="modal-val">${bc.pruned ? 'Yes' : 'No'}</span></div>`;
            if (bc.pruned && bc.pruneheight) {
                html += `<div class="modal-row"><span class="modal-label">Prune Height</span><span class="modal-val">${bc.pruneheight.toLocaleString()}</span></div>`;
            }
            // Softforks
            if (bc.softforks && Object.keys(bc.softforks).length > 0) {
                html += '<div class="modal-section-title">Softforks</div>';
                for (const [name, sf] of Object.entries(bc.softforks)) {
                    const status = sf.active ? 'Active' : (sf.type || 'Defined');
                    const cls = sf.active ? 'modal-val-ok' : '';
                    html += `<div class="modal-row"><span class="modal-label">${name}</span><span class="modal-val ${cls}">${status}</span></div>`;
                }
            }
            body.innerHTML = html;
        }).catch(err => {
            const body = document.getElementById('blockchain-body');
            if (body) body.innerHTML = `<div style="color:var(--err)">Error: ${err.message}</div>`;
        });
    }

    // ═══════════════════════════════════════════════════════════
    // GEODB MANAGEMENT DROPDOWN
    // ═══════════════════════════════════════════════════════════

    let geodbDropdownEl = null;

    function openGeoDBDropdown(anchorEl) {
        closeGeoDBDropdown();
        const dd = document.createElement('div');
        dd.className = 'currency-dropdown';
        dd.id = 'geodb-dropdown';
        dd.style.minWidth = '240px';
        dd.innerHTML = '<div style="color:var(--text-muted);font-size:10px;text-align:center;padding:8px">Loading...</div>';
        document.body.appendChild(dd);
        geodbDropdownEl = dd;

        if (anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            dd.style.left = Math.max(8, rect.left - 60) + 'px';
            dd.style.top = (rect.bottom + 6) + 'px';
        }

        // Populate from lastNodeInfo
        if (lastNodeInfo && lastNodeInfo.geo_db_stats) {
            renderGeoDBDropdown(lastNodeInfo.geo_db_stats);
        } else {
            dd.innerHTML = '<div style="color:var(--text-muted);font-size:10px;text-align:center;padding:8px">No GeoDB data</div>';
        }

        setTimeout(() => { document.addEventListener('click', closeGeoDBOnOutside); }, 0);
    }

    function renderGeoDBDropdown(stats) {
        const dd = document.getElementById('geodb-dropdown');
        if (!dd) return;
        const statusText = stats.status || 'unknown';
        const statusCls = statusText === 'ok' ? 'ok' : (statusText === 'disabled' ? 'disabled' : 'error');
        let html = '<div class="curr-title">MBCore DB</div>';
        html += `<div class="modal-row" style="padding:2px 0"><span class="modal-label">Status</span><span class="geodb-status-badge ${statusCls}">${statusText.toUpperCase()}</span></div>`;
        if (stats.entries != null) html += `<div class="modal-row" style="padding:2px 0"><span class="modal-label">Entries</span><span class="modal-val">${stats.entries.toLocaleString()}</span></div>`;
        if (stats.size_bytes != null) html += `<div class="modal-row" style="padding:2px 0"><span class="modal-label">Size</span><span class="modal-val">${(stats.size_bytes / 1e6).toFixed(1)} MB</span></div>`;
        if (stats.oldest_age_days != null) html += `<div class="modal-row" style="padding:2px 0"><span class="modal-label">Oldest Entry</span><span class="modal-val">${stats.oldest_age_days} days</span></div>`;
        if (stats.path) html += `<div class="modal-row" style="padding:2px 0"><span class="modal-label">Path</span><span class="modal-val" style="font-size:9px;max-width:160px" title="${stats.path}">${stats.path}</span></div>`;
        const alCls = stats.auto_lookup ? 'modal-val-ok' : 'modal-val-warn';
        html += `<div class="modal-row" style="padding:2px 0"><span class="modal-label">Auto-lookup</span><span class="modal-val ${alCls}">${stats.auto_lookup ? 'On' : 'Off'}</span></div>`;
        const auCls = stats.auto_update ? 'modal-val-ok' : 'modal-val-warn';
        html += `<div class="modal-row" style="padding:2px 0"><span class="modal-label">Auto-update</span><span class="modal-val ${auCls}">${stats.auto_update ? 'On' : 'Off'}</span></div>`;
        html += '<button class="geodb-update-btn" id="geodb-update-btn">Update Database</button>';
        html += '<div class="geodb-result" id="geodb-result"></div>';
        dd.innerHTML = html;

        document.getElementById('geodb-update-btn').addEventListener('click', async () => {
            const resultEl = document.getElementById('geodb-result');
            resultEl.textContent = 'Updating...';
            resultEl.style.color = 'var(--text-secondary)';
            try {
                const resp = await fetch('/api/geodb/update', { method: 'POST' });
                const data = await resp.json();
                resultEl.textContent = data.message || (data.success ? 'Done' : 'Failed');
                resultEl.style.color = data.success ? 'var(--ok)' : 'var(--err)';
            } catch (err) {
                resultEl.textContent = 'Error: ' + err.message;
                resultEl.style.color = 'var(--err)';
            }
        });
    }

    function closeGeoDBOnOutside(e) {
        if (geodbDropdownEl && !geodbDropdownEl.contains(e.target)) {
            closeGeoDBDropdown();
        }
    }

    function closeGeoDBDropdown() {
        if (geodbDropdownEl) { geodbDropdownEl.remove(); geodbDropdownEl = null; }
        document.removeEventListener('click', closeGeoDBOnOutside);
    }

    // ═══════════════════════════════════════════════════════════
    // CONNECT PEER MODAL
    // ═══════════════════════════════════════════════════════════

    function openConnectPeerModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'connect-peer-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:440px">
            <div class="modal-header"><span class="modal-title">Connect Peer</span><button class="modal-close" id="connect-close">&times;</button></div>
            <div class="modal-body">
                <div class="connect-instructions">Enter a peer address to connect. Bitcoin Core will attempt a one-time connection.</div>
                <div class="connect-example">IPv4: 1.2.3.4:8333</div>
                <div class="connect-example">IPv6: [2001:db8::1]:8333</div>
                <div class="connect-example">Tor: abc...xyz.onion:8333</div>
                <div class="connect-example">I2P: abc...xyz.b32.i2p:0</div>
                <div class="connect-example">CJDNS: [fc00::1]:8333</div>
                <div class="connect-input-row">
                    <input type="text" class="connect-input" id="connect-addr-input" placeholder="Enter peer address...">
                    <button class="connect-btn" id="connect-go-btn">Connect</button>
                </div>
                <div class="connect-result" id="connect-result"></div>
                <div class="connect-cli-hint">For a permanent connection, use:<div class="connect-cli-cmd" id="connect-cli-cmd"><span>bitcoin-cli addnode &lt;address&gt; add</span><button class="connect-copy-btn" id="connect-copy-cli">Copy</button></div></div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        document.getElementById('connect-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const input = document.getElementById('connect-addr-input');
        const goBtn = document.getElementById('connect-go-btn');
        const resultEl = document.getElementById('connect-result');
        const cliCmd = document.getElementById('connect-cli-cmd');
        const copyBtn = document.getElementById('connect-copy-cli');

        goBtn.addEventListener('click', async () => {
            const addr = input.value.trim();
            if (!addr) { resultEl.textContent = 'Please enter an address'; resultEl.className = 'connect-result err'; return; }
            resultEl.textContent = 'Connecting...';
            resultEl.className = 'connect-result';
            try {
                const resp = await fetch('/api/peer/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }) });
                const data = await resp.json();
                if (data.success) {
                    resultEl.textContent = `Connection attempt sent to ${data.address}`;
                    resultEl.className = 'connect-result ok';
                    cliCmd.querySelector('span').textContent = `bitcoin-cli addnode "${data.address}" add`;
                    setTimeout(fetchPeers, 2000);
                } else {
                    resultEl.textContent = data.error || 'Failed';
                    resultEl.className = 'connect-result err';
                }
            } catch (err) {
                resultEl.textContent = 'Error: ' + err.message;
                resultEl.className = 'connect-result err';
            }
        });

        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBtn.click(); });

        // Auto-populate CLI command hint as user types
        input.addEventListener('input', () => {
            const addr = input.value.trim();
            const cmdSpan = cliCmd.querySelector('span');
            if (cmdSpan) {
                cmdSpan.textContent = addr
                    ? `bitcoin-cli addnode "${addr}" add`
                    : 'bitcoin-cli addnode <address> add';
            }
        });

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const txt = cliCmd.querySelector('span').textContent;
                navigator.clipboard.writeText(txt).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
                });
            });
        }
    }

    // Connect Peer button handler
    const connectPeerBtn = document.getElementById('btn-connect-peer');
    if (connectPeerBtn) {
        connectPeerBtn.addEventListener('click', (e) => { e.stopPropagation(); openConnectPeerModal(); });
    }

    // Node Info button handler (old handle btn, kept for compatibility)
    const nodeInfoBtn = document.getElementById('btn-node-info');
    if (nodeInfoBtn) {
        nodeInfoBtn.addEventListener('click', (e) => { e.stopPropagation(); openNodeInfoModal(); });
    }

    // System Info button handler (old handle btn, kept for compatibility)
    const systemInfoBtn = document.getElementById('btn-system-info');
    if (systemInfoBtn) {
        systemInfoBtn.addEventListener('click', (e) => { e.stopPropagation(); openSystemInfoModal(); });
    }

    // Map overlay link: Node Info
    const moNodeInfoLink = document.getElementById('mo-node-info');
    if (moNodeInfoLink) {
        moNodeInfoLink.addEventListener('click', (e) => { e.stopPropagation(); openNodeInfoModal(); });
    }

    // Map overlay link: Mempool Info
    const moMempoolInfoLink = document.getElementById('mo-mempool-info');
    if (moMempoolInfoLink) {
        moMempoolInfoLink.addEventListener('click', (e) => { e.stopPropagation(); openMempoolModal(); });
    }

    // Map overlay link: Blockchain Info
    const moBlockchainInfoLink = document.getElementById('mo-blockchain-info');
    if (moBlockchainInfoLink) {
        moBlockchainInfoLink.addEventListener('click', (e) => { e.stopPropagation(); openBlockchainModal(); });
    }

    // Right overlay: MBCore DB link
    const roGeodbLink = document.getElementById('ro-geodb-link');
    if (roGeodbLink) {
        roGeodbLink.addEventListener('click', (e) => { e.stopPropagation(); openGeoDBDropdown(roGeodbLink); });
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE NETWORK POPUP (for peer list clicks)
    // ═══════════════════════════════════════════════════════════

    function showPrivateNetPopup(msg) {
        // Remove existing
        const existing = document.getElementById('private-net-popup');
        if (existing) existing.remove();
        const popup = document.createElement('div');
        popup.className = 'private-net-popup';
        popup.id = 'private-net-popup';
        popup.innerHTML = `<div>${msg}</div><button class="close-popup">OK</button>`;
        popup.style.left = '50%';
        popup.style.top = '40%';
        popup.style.transform = 'translate(-50%, -50%)';
        document.body.appendChild(popup);
        popup.querySelector('.close-popup').addEventListener('click', () => popup.remove());
        setTimeout(() => popup.remove(), 8000);
    }

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════

    /** Mercator projection: lon/lat -> normalised 0..1 coordinates */
    function project(lon, lat) {
        const x = (lon + 180) / 360;
        const latRad = lat * Math.PI / 180;
        const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
        const y = 0.5 - mercN / (2 * Math.PI);
        return { x, y };
    }

    /** Convert lon/lat to screen pixel coordinates using current view */
    function worldToScreen(lon, lat) {
        const p = project(lon, lat);
        const sx = (p.x - 0.5) * W * view.zoom + W / 2 - view.x * view.zoom;
        const sy = (p.y - 0.5) * H * view.zoom + H / 2 - view.y * view.zoom;
        return { x: sx, y: sy };
    }

    /** Convert screen pixel coordinates back to lon/lat */
    function screenToWorld(sx, sy) {
        const px = ((sx - W / 2 + view.x * view.zoom) / (W * view.zoom)) + 0.5;
        const py = ((sy - H / 2 + view.y * view.zoom) / (H * view.zoom)) + 0.5;
        const lon = px * 360 - 180;
        const mercN = (0.5 - py) * 2 * Math.PI;
        const lat = (2 * Math.atan(Math.exp(mercN)) - Math.PI / 2) * 180 / Math.PI;
        return { lon, lat };
    }

    function rgba(c, a) {
        return `rgba(${c.r},${c.g},${c.b},${a})`;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    /** Simple deterministic hash for stable Antarctica placement */
    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;  // force 32-bit integer
        }
        return hash;
    }

    // ═══════════════════════════════════════════════════════════
    // ANTARCTICA PLACEMENT
    // Peers with location_status "private" or "unavailable" (or
    // overlay networks like Tor/I2P/CJDNS) are placed near
    // Antarctic research stations with a deterministic offset
    // so they don't jump around between refreshes.
    // ═══════════════════════════════════════════════════════════

    function getAntarcticaPosition(addr) {
        if (antarcticaCache[addr]) return antarcticaCache[addr];

        const h1 = hashString(addr);
        const h2 = hashString(addr + '_offset');

        // Pick a station deterministically
        const idx = Math.abs(h1) % ANTARCTICA_STATIONS.length;
        const station = ANTARCTICA_STATIONS[idx];

        // Small offset (±0.5 deg) so peers near same station don't stack
        const latOff = ((Math.abs(h2) % 100) / 100 - 0.5) * 1.0;
        const lonOff = ((Math.abs(h2 >> 8) % 100) / 100 - 0.5) * 1.0;

        const pos = { lat: station.lat + latOff, lon: station.lon + lonOff };
        antarcticaCache[addr] = pos;
        return pos;
    }

    // ═══════════════════════════════════════════════════════════
    // WORLD MAP GEOMETRY — Real Natural Earth 50m landmasses
    // Loaded from /static/assets/world-50m.json on startup.
    // Format: array of polygons, each polygon is an array of
    // rings (outer + holes), each ring is [[lon,lat], ...].
    // Source: Natural Earth (public domain), stripped to coords only.
    // 50m gives much better coastline detail than 110m (~1410 polygons
    // vs 127), while still being fast to load and render on canvas.
    // ═══════════════════════════════════════════════════════════

    async function loadWorldGeometry() {
        try {
            const resp = await fetch('/static/assets/world-50m.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const polygons = await resp.json();

            // Convert to our internal format: each entry is { rings: [[[lon,lat],...], ...] }
            // The first ring is the outer boundary, subsequent rings are holes (lakes etc)
            worldPolygons = polygons;
            worldReady = true;
            console.log(`[vNext] Loaded ${polygons.length} land polygons`);
        } catch (err) {
            console.error('[vNext] Failed to load world geometry, using fallback:', err);
            // Fallback: minimal hand-traced outlines so the map isn't blank
            worldPolygons = [
                [[[-130,50],[-125,60],[-115,68],[-95,72],[-80,72],[-65,62],[-55,50],[-60,45],[-68,44],[-75,38],[-82,30],[-90,28],[-97,26],[-105,30],[-118,34],[-125,42],[-130,50]]],
                [[[-80,10],[-75,12],[-63,10],[-52,4],[-42,0],[-35,-5],[-35,-12],[-38,-18],[-42,-22],[-48,-28],[-52,-33],[-58,-38],[-65,-45],[-68,-53],[-72,-48],[-75,-42],[-72,-35],[-68,-28],[-70,-18],[-75,-10],[-80,0],[-80,10]]],
                [[[-10,36],[0,38],[3,42],[5,44],[2,48],[-5,48],[-8,54],[-5,58],[5,62],[12,58],[18,55],[24,58],[30,60],[35,58],[42,55],[45,50],[40,45],[35,40],[28,36],[20,36],[12,38],[5,38],[0,36],[-10,36]]],
                [[[-15,12],[-17,15],[-12,25],[-5,35],[0,36],[10,37],[12,32],[20,32],[25,30],[32,32],[35,30],[42,12],[50,2],[42,-5],[40,-12],[35,-22],[30,-30],[22,-34],[18,-34],[15,-28],[12,-18],[8,-5],[5,5],[0,6],[-8,5],[-15,12]]],
                [[[28,36],[35,40],[42,48],[50,50],[55,55],[60,60],[65,68],[75,72],[90,72],[100,68],[115,65],[125,60],[130,55],[140,55],[145,50],[142,44],[135,38],[128,34],[122,30],[115,24],[108,18],[105,12],[100,5],[98,8],[95,15],[88,22],[80,28],[72,32],[60,38],[50,40],[42,45],[35,40],[28,36]]],
                [[[115,-15],[120,-14],[130,-12],[135,-14],[140,-16],[148,-20],[152,-25],[153,-28],[150,-33],[145,-38],[137,-35],[130,-32],[122,-33],[116,-32],[114,-28],[114,-22],[118,-20],[120,-18],[115,-15]]],
            ];
            worldReady = true;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // LAKES GEOMETRY — Natural Earth 50m major lakes
    // Loaded from /static/assets/lakes-50m.json on startup.
    // Rendered on top of land using the ocean background colour
    // to "carve out" Great Lakes, Caspian Sea, Lake Victoria, etc.
    // ═══════════════════════════════════════════════════════════

    async function loadLakeGeometry() {
        try {
            const resp = await fetch('/static/assets/lakes-50m.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            lakePolygons = await resp.json();
            lakesReady = true;
            console.log(`[vNext] Loaded ${lakePolygons.length} lake polygons`);
        } catch (err) {
            // Lakes are non-critical — map still works without them
            console.warn('[vNext] Failed to load lake geometry:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // COUNTRY BORDERS — Natural Earth 50m admin-0 boundary lines
    // Subtle dashed lines between countries, visible at medium zoom.
    // ═══════════════════════════════════════════════════════════

    async function loadBorderGeometry() {
        try {
            const resp = await fetch('/static/assets/borders-50m.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            borderLines = await resp.json();
            bordersReady = true;
            console.log(`[vNext] Loaded ${borderLines.length} country border lines`);
        } catch (err) {
            console.warn('[vNext] Failed to load country borders:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // STATE/PROVINCE BORDERS — Natural Earth 50m admin-1 lines
    // Even subtler lines, visible only at higher zoom.
    // ═══════════════════════════════════════════════════════════

    async function loadStateGeometry() {
        try {
            const resp = await fetch('/static/assets/states-50m.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            stateLines = await resp.json();
            statesReady = true;
            console.log(`[vNext] Loaded ${stateLines.length} state/province border lines`);
        } catch (err) {
            console.warn('[vNext] Failed to load state borders:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CITIES — Natural Earth 50m populated places
    // Point data with name and population, shown at high zoom.
    // ═══════════════════════════════════════════════════════════

    async function loadCityData() {
        try {
            const resp = await fetch('/static/assets/cities-50m.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            cityPoints = await resp.json();
            citiesReady = true;
            console.log(`[vNext] Loaded ${cityPoints.length} cities`);
        } catch (err) {
            console.warn('[vNext] Failed to load city data:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // COUNTRY LABELS — Natural Earth 50m admin-0 (English names)
    // Appear at medium zoom, before state labels.
    // ═══════════════════════════════════════════════════════════

    async function loadCountryLabels() {
        try {
            const resp = await fetch('/static/assets/country-labels-50m.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            countryLabels = await resp.json();
            countryLabelsReady = true;
            console.log(`[vNext] Loaded ${countryLabels.length} country labels`);
        } catch (err) {
            console.warn('[vNext] Failed to load country labels:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // STATE/PROVINCE LABELS — Natural Earth 50m admin-1 (English)
    // Rendered after country labels are already visible.
    // ═══════════════════════════════════════════════════════════

    async function loadStateLabels() {
        try {
            const resp = await fetch('/static/assets/state-labels-50m.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            stateLabels = await resp.json();
            stateLabelsReady = true;
            console.log(`[vNext] Loaded ${stateLabels.length} state/province labels`);
        } catch (err) {
            console.warn('[vNext] Failed to load state labels:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DATA FETCHING — Real peers from /api/peers
    // ═══════════════════════════════════════════════════════════

    /**
     * Fetch peers from the backend and transform them into canvas nodes.
     * - Peers with valid lat/lon and location_status "ok" use real coords
     * - Private/unavailable/pending peers go to Antarctica
     * - Existing nodes that are no longer in the response start fading out
     * - New nodes fade in with a spawn animation
     */
    async function fetchPeers() {
        try {
            const resp = await fetch('/api/peers');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const peers = await resp.json();
            lastPeers = peers;

            const now = Date.now();

            // Build a set of peer IDs from this response
            const currentIds = new Set();
            for (const p of peers) currentIds.add(p.id);

            // ── Mark departed peers for fade-out ──
            // If a node was alive and is no longer in the response, start its fade-out
            for (const node of nodes) {
                if (node.alive && !currentIds.has(node.peerId)) {
                    node.alive = false;
                    node.fadeOutStart = now;
                }
            }

            // ── Add or update existing peers ──
            for (const peer of peers) {
                const existing = nodes.find(n => n.peerId === peer.id && n.alive);

                // Determine map coordinates
                let lat, lon;
                const isPrivate = (
                    peer.location_status === 'private' ||
                    peer.location_status === 'unavailable' ||
                    peer.location_status === 'pending'
                );

                if (isPrivate || (peer.lat === 0 && peer.lon === 0)) {
                    // Place in Antarctica with stable position
                    const pos = getAntarcticaPosition(peer.addr || `peer-${peer.id}`);
                    lat = pos.lat;
                    lon = pos.lon;
                } else {
                    lat = peer.lat;
                    lon = peer.lon;
                }

                // Resolve network colour
                const netKey = peer.network || 'ipv4';
                const color = NET_COLORS[netKey] || NET_COLOR_UNKNOWN;

                if (existing) {
                    // ── Update in place (peer still connected) ──
                    existing.lat = lat;
                    existing.lon = lon;
                    existing.net = netKey;      // always use authoritative API value
                    existing.color = color;     // keep colour in sync with network
                    existing.ping = peer.ping_ms || 0;
                    existing.city = peer.city || '';
                    existing.regionName = peer.regionName || '';
                    existing.country = peer.country || peer.countryCode || '';
                    existing.subver = peer.subver || '';
                    existing.direction = peer.direction || '';
                    existing.conntime = peer.conntime || 0;
                    existing.conntime_fmt = peer.conntime_fmt || '';
                    existing.isp = peer.isp || '';
                    existing.connection_type = peer.connection_type || '';
                    existing.in_addrman = peer.in_addrman || false;
                    existing.ip = peer.ip || '';
                    existing.port = peer.port || '';
                    existing.isPrivate = isPrivate;
                    existing.location_status = peer.location_status;
                } else {
                    // ── New peer — create node with spawn animation ──
                    nodes.push({
                        peerId: peer.id,
                        lat,
                        lon,
                        net: netKey,
                        color,
                        city: peer.city || '',
                        regionName: peer.regionName || '',
                        country: peer.country || peer.countryCode || '',
                        subver: peer.subver || '',
                        direction: peer.direction || '',
                        ping: peer.ping_ms || 0,
                        conntime: peer.conntime || 0,
                        conntime_fmt: peer.conntime_fmt || '',
                        isp: peer.isp || '',
                        connection_type: peer.connection_type || '',
                        in_addrman: peer.in_addrman || false,
                        isPrivate,
                        location_status: peer.location_status,
                        addr: peer.addr || '',
                        ip: peer.ip || '',
                        port: peer.port || '',
                        // Animation state
                        phase: Math.random() * Math.PI * 2,  // random pulse phase
                        spawnTime: now,                       // triggers fade-in animation
                        alive: true,
                        fadeOutStart: null,
                    });
                }
            }

            // ── Garbage collect fully faded-out nodes ──
            nodes = nodes.filter(n => {
                if (!n.alive && n.fadeOutStart) {
                    return (now - n.fadeOutStart) < CFG.fadeOutDuration;
                }
                return true;
            });

            // Update connection status in the topbar
            updateConnectionStatus(peers.length > 0);

            // Update flight deck network counts
            updateFlightDeck(nodes);

            // Refresh the peer table panel
            renderPeerTable();

            // Reset countdown timer
            lastPeerFetchTime = Date.now();

        } catch (err) {
            console.error('[vNext] Failed to fetch peers:', err);
            updateConnectionStatus(false);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DATA FETCHING — Node info from /api/info (block height)
    // ═══════════════════════════════════════════════════════════

    let lastBlockHeight = null;
    let lastNodeInfo = null;  // Full /api/info response for Node Info card

    async function fetchInfo() {
        try {
            const resp = await fetch(`/api/info?currency=${btcCurrency}`);
            if (!resp.ok) return;
            const info = await resp.json();

            lastNodeInfo = info;

            // Update block height (stored for modals and map overlay)
            if (info.last_block && info.last_block.height) {
                lastBlockHeight = info.last_block.height;
            }

            // Update BTC price in topbar
            updateBtcPricePanel(info);

            // Update right overlay MBCore DB count
            if (info.geo_db_stats && info.geo_db_stats.entries != null) {
                const geodbCountEl = document.getElementById('ro-geodb-count');
                if (geodbCountEl) geodbCountEl.textContent = info.geo_db_stats.entries.toLocaleString();
            }

            // Update flight deck scores
            if (info.network_scores) {
                const s4 = info.network_scores.ipv4;
                const s6 = info.network_scores.ipv6;
                const score4El = document.getElementById('fd-ipv4-score');
                const score6El = document.getElementById('fd-ipv6-score');
                if (score4El) { score4El.textContent = s4 != null ? s4 : '\u2014'; pulseOnChange('fd-ipv4-score', s4 || 0, 'long'); }
                if (score6El) { score6El.textContent = s6 != null ? s6 : '\u2014'; pulseOnChange('fd-ipv6-score', s6 || 0, 'long'); }
            }

        } catch (err) {
            console.error('[vNext] Failed to fetch info:', err);
        }
    }

    /** Open combined Node Info modal — node info + mempool + blockchain ALL in one */
    function openNodeInfoModal() {
        // Remove any existing
        const existing = document.getElementById('node-info-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'node-info-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:560px"><div class="modal-header"><span class="modal-title">Node Info</span><button class="modal-close" id="node-info-close">&times;</button></div><div class="modal-body" id="node-info-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        document.getElementById('node-info-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Build combined content from cached data + fresh API calls
        const body = document.getElementById('node-info-body');
        let html = '';

        // ── Section 1: Node Overview ──
        html += '<div class="modal-section-title">Node</div>';
        if (lastNodeInfo) {
            const info = lastNodeInfo;
            html += `<div class="modal-row"><span class="modal-label">Version</span><span class="modal-val">${info.subversion || '\u2014'}</span></div>`;
            html += `<div class="modal-row"><span class="modal-label">Peers</span><span class="modal-val">${info.connected != null ? info.connected : '\u2014'}</span></div>`;
            if (info.blockchain) {
                html += `<div class="modal-row"><span class="modal-label">Size (Disk)</span><span class="modal-val">${info.blockchain.size_gb} GB</span></div>`;
                html += `<div class="modal-row"><span class="modal-label">Node Type</span><span class="modal-val">${info.blockchain.pruned ? 'Pruned' : 'Full'}</span></div>`;
                html += `<div class="modal-row"><span class="modal-label">TX Index</span><span class="modal-val">${info.blockchain.indexed ? 'Yes' : 'No'}</span></div>`;
                html += `<div class="modal-row"><span class="modal-label">Status</span><span class="modal-val ${info.blockchain.ibd ? 'modal-val-warn' : 'modal-val-ok'}">${info.blockchain.ibd ? 'Syncing (IBD)' : 'Synced'}</span></div>`;
            }
            if (info.last_block) {
                const t = info.last_block.time ? new Date(info.last_block.time * 1000).toLocaleTimeString() : '';
                html += `<div class="modal-row"><span class="modal-label">Block Height</span><span class="modal-val modal-val-ok">${info.last_block.height ? info.last_block.height.toLocaleString() : '\u2014'}${t ? ' (' + t + ')' : ''}</span></div>`;
            }
            if (info.mempool_size != null) {
                html += `<div class="modal-row"><span class="modal-label">Mempool Size</span><span class="modal-val">${info.mempool_size.toLocaleString()} tx</span></div>`;
            }
        } else {
            html += '<div style="color:var(--text-muted);padding:4px 0">No node data yet</div>';
        }

        // ── Section 2: Mempool (loading async) ──
        html += '<div class="modal-section-title">Mempool</div>';
        html += '<div id="ni-mempool-section" style="color:var(--text-muted);padding:4px 0">Loading mempool data...</div>';

        // ── Section 3: Blockchain (loading async) ──
        html += '<div class="modal-section-title">Blockchain</div>';
        html += '<div id="ni-blockchain-section" style="color:var(--text-muted);padding:4px 0">Loading blockchain data...</div>';

        body.innerHTML = html;

        // Fetch mempool data
        fetch(`/api/mempool?currency=${btcCurrency}`).then(r => r.json()).then(data => {
            const section = document.getElementById('ni-mempool-section');
            if (!section) return;
            if (data.error) { section.innerHTML = `<div style="color:var(--err)">${data.error}</div>`; return; }
            const mp = data.mempool;
            if (!mp) { section.innerHTML = '<div style="color:var(--text-muted)">No data</div>'; return; }
            const price = data.btc_price || 0;
            let mhtml = '';
            mhtml += `<div class="modal-row"><span class="modal-label">Pending Transactions</span><span class="modal-val modal-val-highlight">${(mp.size || 0).toLocaleString()}</span></div>`;
            mhtml += `<div class="modal-row"><span class="modal-label">Data Size</span><span class="modal-val">${((mp.bytes || 0) / 1e6).toFixed(2)} MB</span></div>`;
            mhtml += `<div class="modal-row"><span class="modal-label">Memory Usage</span><span class="modal-val">${((mp.usage || 0) / 1e6).toFixed(2)} MB</span></div>`;
            const totalFeesBTC = mp.total_fee || 0;
            const totalFeesFiat = price ? ` ($${(totalFeesBTC * price).toFixed(2)})` : '';
            mhtml += `<div class="modal-row"><span class="modal-label">Total Fees</span><span class="modal-val">${totalFeesBTC.toFixed(8)} BTC${totalFeesFiat}</span></div>`;
            mhtml += `<div class="modal-row"><span class="modal-label">Max Mempool Size</span><span class="modal-val">${((mp.maxmempool || 0) / 1e6).toFixed(0)} MB</span></div>`;
            if (mp.mempoolminfee != null) {
                const satVb = (mp.mempoolminfee * 1e8 / 1000).toFixed(2);
                mhtml += `<div class="modal-row"><span class="modal-label">Min Accepted Fee</span><span class="modal-val">${satVb} sat/vB</span></div>`;
            }
            if (mp.minrelaytxfee != null) {
                const satVb = (mp.minrelaytxfee * 1e8 / 1000).toFixed(2);
                mhtml += `<div class="modal-row"><span class="modal-label">Min Relay Fee</span><span class="modal-val">${satVb} sat/vB</span></div>`;
            }
            if (mp.fullrbf != null) {
                const cls = mp.fullrbf ? 'modal-val-ok' : 'modal-val-warn';
                mhtml += `<div class="modal-row"><span class="modal-label">Full RBF</span><span class="modal-val ${cls}">${mp.fullrbf ? 'Enabled' : 'Disabled'}</span></div>`;
            }
            if (mp.unbroadcastcount != null) {
                const cls = mp.unbroadcastcount === 0 ? 'modal-val-ok' : 'modal-val-highlight';
                mhtml += `<div class="modal-row"><span class="modal-label">Unbroadcast Txs</span><span class="modal-val ${cls}">${mp.unbroadcastcount}</span></div>`;
            }
            section.innerHTML = mhtml;
        }).catch(err => {
            const section = document.getElementById('ni-mempool-section');
            if (section) section.innerHTML = `<div style="color:var(--err)">Error: ${err.message}</div>`;
        });

        // Fetch blockchain data
        fetch('/api/blockchain').then(r => r.json()).then(data => {
            const section = document.getElementById('ni-blockchain-section');
            if (!section) return;
            if (data.error) { section.innerHTML = `<div style="color:var(--err)">${data.error}</div>`; return; }
            const bc = data.blockchain;
            if (!bc) { section.innerHTML = '<div style="color:var(--text-muted)">No data</div>'; return; }
            let bhtml = '';
            bhtml += `<div class="modal-row"><span class="modal-label">Chain</span><span class="modal-val modal-val-highlight">${bc.chain || '\u2014'}</span></div>`;
            bhtml += `<div class="modal-row"><span class="modal-label">Block Height</span><span class="modal-val modal-val-ok">${(bc.blocks || 0).toLocaleString()}</span></div>`;
            if (bc.headers) {
                const pct = bc.blocks && bc.headers ? ((bc.blocks / bc.headers) * 100).toFixed(2) : '100';
                bhtml += `<div class="modal-row"><span class="modal-label">Sync Progress</span><span class="modal-val">${bc.blocks.toLocaleString()} / ${bc.headers.toLocaleString()} (${pct}%)</span></div>`;
            }
            if (bc.bestblockhash) {
                const short = bc.bestblockhash.substring(0, 20) + '...';
                bhtml += `<div class="modal-row"><span class="modal-label">Best Block Hash</span><span class="modal-val" title="${bc.bestblockhash}">${short}</span></div>`;
            }
            if (bc.difficulty) {
                const diff = parseFloat(bc.difficulty);
                const humanDiff = diff > 1e12 ? (diff / 1e12).toFixed(2) + 'T' : diff.toLocaleString();
                bhtml += `<div class="modal-row"><span class="modal-label">Difficulty</span><span class="modal-val" title="${bc.difficulty}">${humanDiff}</span></div>`;
            }
            if (bc.mediantime) {
                bhtml += `<div class="modal-row"><span class="modal-label">Median Time</span><span class="modal-val">${new Date(bc.mediantime * 1000).toLocaleString()}</span></div>`;
            }
            bhtml += `<div class="modal-row"><span class="modal-label">IBD Status</span><span class="modal-val ${bc.initialblockdownload ? 'modal-val-warn' : 'modal-val-ok'}">${bc.initialblockdownload ? 'Yes' : 'No'}</span></div>`;
            if (bc.size_on_disk) {
                bhtml += `<div class="modal-row"><span class="modal-label">Size on Disk</span><span class="modal-val">${(bc.size_on_disk / 1e9).toFixed(1)} GB</span></div>`;
            }
            bhtml += `<div class="modal-row"><span class="modal-label">Pruning</span><span class="modal-val">${bc.pruned ? 'Yes' : 'No'}</span></div>`;
            if (bc.softforks && Object.keys(bc.softforks).length > 0) {
                bhtml += '<div class="modal-section-title" style="margin-top:6px;padding-top:4px">Softforks</div>';
                for (const [name, sf] of Object.entries(bc.softforks)) {
                    const status = sf.active ? 'Active' : (sf.type || 'Defined');
                    const cls = sf.active ? 'modal-val-ok' : '';
                    bhtml += `<div class="modal-row"><span class="modal-label">${name}</span><span class="modal-val ${cls}">${status}</span></div>`;
                }
            }
            section.innerHTML = bhtml;
        }).catch(err => {
            const section = document.getElementById('ni-blockchain-section');
            if (section) section.innerHTML = `<div style="color:var(--err)">Error: ${err.message}</div>`;
        });
    }

    /** Update BTC Price in left map overlay + ₿ symbol coloring */
    function updateBtcPricePanel(info) {
        const priceEl = document.getElementById('mo-btc-price');
        const symbolEl = document.getElementById('mo-btc-symbol');
        const arrowEl = document.getElementById('mo-btc-arrow');
        if (!priceEl) return;

        if (info.btc_price) {
            const price = parseFloat(info.btc_price);
            priceEl.textContent = `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

            // Persistent coloring on price element (red/green on change)
            const dir = pulseOnChange('mo-btc-price', price, 'persistent');

            // ₿ symbol stays gold normally — price text gets red/green
            // Arrow indicator shows direction
            if (arrowEl && dir) {
                arrowEl.textContent = dir > 0 ? '\u25B2' : '\u25BC';
                arrowEl.className = 'mo-btc-arrow ' + (dir > 0 ? 'arrow-up' : 'arrow-down');
            }
        } else {
            priceEl.textContent = '\u2014';
        }

        // Currency code display
        const codeEl = document.getElementById('mo-btc-currency');
        if (codeEl) codeEl.textContent = btcCurrency;
    }

    // ═══════════════════════════════════════════════════════════
    // CONNECTION STATUS (topbar dot + text)
    // ═══════════════════════════════════════════════════════════

    function updateConnectionStatus(connected) {
        const dot = document.getElementById('status-dot');
        const txt = document.getElementById('status-text');
        if (connected) {
            dot.classList.add('online');
            txt.textContent = 'Connected';
        } else {
            dot.classList.remove('online');
            txt.textContent = 'Offline';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CANVAS RESIZE
    // Handles high-DPI displays via devicePixelRatio scaling.
    // ═══════════════════════════════════════════════════════════

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ═══════════════════════════════════════════════════════════
    // DRAWING — Grid, landmasses, lakes, borders, cities, nodes
    // Horizontal world wrapping: the map repeats seamlessly.
    // ═══════════════════════════════════════════════════════════

    /**
     * Returns longitude offsets for world rendering.
     * Computes which copies of the 360° world are visible on screen
     * so the map repeats seamlessly when panning horizontally.
     * Always runs — even at zoom 1, the user can pan horizontally
     * so we need to fill any exposed edges with adjacent copies.
     */
    function getWrapOffsets() {
        // World width in pixels at current zoom
        const worldWidthPx = W * view.zoom;

        // How many full world copies could fit in the viewport + margin
        const copiesNeeded = Math.ceil(W / worldWidthPx) + 2;

        const offsets = [];
        for (let i = -copiesNeeded; i <= copiesNeeded; i++) {
            const off = i * 360;
            // Project the left and right edges of this world copy
            const leftPx = worldToScreen(-180 + off, 0).x;
            const rightPx = worldToScreen(180 + off, 0).x;
            // Include if any part of this copy overlaps the viewport (with margin)
            if (rightPx > -200 && leftPx < W + 200) {
                offsets.push(off);
            }
        }

        return offsets.length > 0 ? offsets : [0];
    }

    /** Draw subtle lat/lon grid lines (with wrap) */
    function drawGrid() {
        ctx.strokeStyle = 'rgba(88,166,255,0.04)';
        ctx.lineWidth = 0.5;
        const offsets = getWrapOffsets();

        for (const off of offsets) {
            // Longitude lines (vertical on map)
            for (let lon = -180; lon <= 180; lon += CFG.gridSpacing) {
                ctx.beginPath();
                for (let lat = -85; lat <= 85; lat += 2) {
                    const s = worldToScreen(lon + off, lat);
                    if (lat === -85) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                }
                ctx.stroke();
            }

            // Latitude lines (horizontal on map)
            for (let lat = -60; lat <= 80; lat += CFG.gridSpacing) {
                ctx.beginPath();
                for (let lon = -180; lon <= 180; lon += 2) {
                    const s = worldToScreen(lon + off, lat);
                    if (lon === -180) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                }
                ctx.stroke();
            }
        }
    }

    /**
     * Draw a set of polygons (land or lakes) at a given longitude offset.
     * Each polygon has one or more rings: ring[0] = outer boundary,
     * ring[1+] = holes. Uses evenodd fill rule to cut out holes.
     */
    function drawPolygonSet(polygons, fillStyle, strokeStyle, lonOffset) {
        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = CFG.coastlineWidth;

        for (const poly of polygons) {
            ctx.beginPath();
            for (const ring of poly) {
                for (let i = 0; i < ring.length; i++) {
                    const s = worldToScreen(ring[i][0] + lonOffset, ring[i][1]);
                    if (i === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                }
                ctx.closePath();
            }
            ctx.fill('evenodd');
            ctx.stroke();
        }
    }

    /** Draw landmasses at all visible wrap positions */
    function drawLandmasses() {
        if (!worldReady) return;
        const offsets = getWrapOffsets();
        for (const off of offsets) {
            drawPolygonSet(worldPolygons, '#151d28', '#253040', off);
        }
    }

    /** Draw lakes on top of land using ocean colour to "carve" them out */
    function drawLakes() {
        if (!lakesReady) return;
        const offsets = getWrapOffsets();
        for (const off of offsets) {
            // Lakes filled with ocean colour, subtle darker stroke
            drawPolygonSet(lakePolygons, '#06080c', '#1a2230', off);
        }
    }

    /**
     * Draw line strings (borders) at a given longitude offset.
     * Used for both country and state borders.
     */
    function drawLineSet(lines, strokeStyle, lineWidth, lonOffset) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        for (const line of lines) {
            ctx.beginPath();
            for (let i = 0; i < line.length; i++) {
                const s = worldToScreen(line[i][0] + lonOffset, line[i][1]);
                if (i === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();
        }
    }

    /** Draw country borders at all zoom levels — always visible, zoom-aware strokes */
    function drawCountryBorders() {
        if (!bordersReady) return;
        // Visible alpha at all zoom levels; brighter when zoomed in
        const alpha = 0.25 + clamp((view.zoom - 1) / 3, 0, 1) * 0.15;
        // Stroke width scales with zoom so borders never become sub-pixel
        const strokeW = Math.max(1.0, 0.8 * view.zoom);
        const offsets = getWrapOffsets();
        for (const off of offsets) {
            drawLineSet(borderLines, `rgba(88,166,255,${alpha})`, strokeW, off);
        }
    }

    /**
     * Draw country name labels (admin-0, English).
     * Appears at medium zoom, before state labels — this is the first text
     * layer so every continent has named countries as geographic context.
     * Font size scales with zoom; larger countries get bigger text.
     */
    function drawCountryLabels() {
        if (!countryLabelsReady || view.zoom < ZOOM_SHOW_COUNTRY_LABELS) return;

        // Fade in gradually over a zoom range
        const alpha = clamp((view.zoom - ZOOM_SHOW_COUNTRY_LABELS) / 0.8, 0, 1) * 0.55;

        // Font size scales with zoom, starts readable and grows
        const fontSize = clamp(8 + (view.zoom - ZOOM_SHOW_COUNTRY_LABELS) * 1.2, 8, 18);

        ctx.font = `600 ${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const offsets = getWrapOffsets();

        for (const label of countryLabels) {
            for (const off of offsets) {
                const s = worldToScreen(label.c[0] + off, label.c[1]);
                // Cull off-screen labels
                if (s.x < -150 || s.x > W + 150 || s.y < -30 || s.y > H + 30) continue;

                // Dark shadow behind text for readability against land
                ctx.fillStyle = `rgba(6,8,12,${alpha * 0.6})`;
                ctx.fillText(label.n, s.x + 1, s.y + 1);
                // Country name in warm white
                ctx.fillStyle = `rgba(200,210,225,${alpha})`;
                ctx.fillText(label.n, s.x, s.y);
            }
        }
    }

    /** Draw state/province borders (zoom >= ZOOM_SHOW_STATES), zoom-aware strokes */
    function drawStateBorders() {
        if (!statesReady || view.zoom < ZOOM_SHOW_STATES) return;
        // Fade in from threshold, cap at solid visibility
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATES) / 1.5, 0, 1) * 0.20;
        // Stroke width scales with zoom, minimum 1 screen pixel
        const strokeW = Math.max(1.0, 0.5 * view.zoom);
        const offsets = getWrapOffsets();
        for (const off of offsets) {
            drawLineSet(stateLines, `rgba(88,166,255,${alpha})`, strokeW, off);
        }
    }

    /**
     * Draw state/province name labels (admin-1, English).
     * Only appears AFTER country labels are already visible.
     * Smaller and more subtle than country labels.
     */
    function drawStateLabels() {
        if (!stateLabelsReady || view.zoom < ZOOM_SHOW_STATE_LABELS) return;

        // Gradual fade-in over a zoom range
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATE_LABELS) / 1.5, 0, 1) * 0.40;

        // Font size: smaller than country labels, scales gently
        const fontSize = clamp(7 + (view.zoom - ZOOM_SHOW_STATE_LABELS) * 0.6, 7, 13);

        ctx.font = `${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const offsets = getWrapOffsets();

        for (const label of stateLabels) {
            for (const off of offsets) {
                const s = worldToScreen(label.c[0] + off, label.c[1]);
                if (s.x < -100 || s.x > W + 100 || s.y < -20 || s.y > H + 20) continue;

                // Subtle state/province name
                ctx.fillStyle = `rgba(140,160,190,${alpha})`;
                ctx.fillText(label.n, s.x, s.y);
            }
        }
    }

    /**
     * Draw city labels. Cities are the LAST text layer — they only
     * appear at high zoom after countries and states are visible:
     *   zoom 6.0+  → mega-cities (>5M)
     *   zoom 8.0+  → large cities (>1M)
     *   zoom 10.0+ → medium cities (>300K)
     *   zoom 12.0+ → all cities
     */
    function drawCities() {
        if (!citiesReady || view.zoom < ZOOM_SHOW_CITIES_MAJOR) return;

        // Determine population cutoff based on zoom
        let minPop;
        if (view.zoom >= ZOOM_SHOW_CITIES_ALL)        minPop = 0;
        else if (view.zoom >= ZOOM_SHOW_CITIES_MED)    minPop = 300000;
        else if (view.zoom >= ZOOM_SHOW_CITIES_LARGE)  minPop = 1000000;
        else                                            minPop = 5000000;

        // Overall opacity fades in from the first threshold
        const alpha = clamp((view.zoom - ZOOM_SHOW_CITIES_MAJOR) / 0.5, 0, 1) * 0.7;

        const offsets = getWrapOffsets();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        for (const city of cityPoints) {
            if (city.p < minPop) continue;

            for (const off of offsets) {
                const s = worldToScreen(city.c[0] + off, city.c[1]);
                // Cull off-screen cities
                if (s.x < -50 || s.x > W + 50 || s.y < -20 || s.y > H + 20) continue;

                // Small dot
                ctx.fillStyle = `rgba(212,218,228,${alpha * 0.5})`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
                ctx.fill();

                // City name label
                const fontSize = city.p > 5000000 ? 10 : city.p > 1000000 ? 9 : 8;
                ctx.font = `${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
                ctx.fillStyle = `rgba(212,218,228,${alpha * 0.6})`;
                ctx.fillText(city.n, s.x + 5, s.y);
            }
        }
    }

    /**
     * Draw a single node at a specific screen position.
     * @param {number} brightness - connection-age brightness (0..1)
     */
    function drawNodeAt(sx, sy, c, r, gr, pulse, opacity, brightness) {
        // Outer glow (radial gradient) — modulated by brightness and pulse
        const grad = ctx.createRadialGradient(sx, sy, r, sx, sy, gr);
        grad.addColorStop(0, rgba(c, 0.55 * pulse * opacity * brightness));
        grad.addColorStop(0.5, rgba(c, 0.18 * pulse * opacity * brightness));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, gr, 0, Math.PI * 2);
        ctx.fill();

        // Core dot — now subtly modulated by pulse for continuous twinkle
        const coreTwinkle = 0.88 + 0.12 * pulse;
        ctx.fillStyle = rgba(c, (0.5 + 0.4 * brightness) * opacity * coreTwinkle);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright white centre highlight — scales with brightness and pulse
        ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.65 * pulse * opacity * brightness);
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * Draw the arrival bloom effect — an expanding ring + brief energetic glow.
     * Runs during the first CFG.arrivalDuration ms after a node spawns.
     * This is visually distinct from the steady-state glow: a one-time event
     * that says "a new peer just appeared here."
     */
    function drawArrivalBloom(sx, sy, c, ageMs, opacity) {
        // ── Expanding ring (first arrivalRingDuration ms) ──
        if (ageMs < CFG.arrivalRingDuration) {
            const t = ageMs / CFG.arrivalRingDuration;
            const ringR = CFG.nodeRadius + (CFG.arrivalRingMaxRadius - CFG.nodeRadius) * t;
            const ringAlpha = (1 - t) * 0.6 * opacity;
            ctx.strokeStyle = rgba(c, ringAlpha);
            ctx.lineWidth = Math.max(0.5, 2 * (1 - t));
            ctx.beginPath();
            ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── Soft bloom glow (entire arrival phase, fading out) ──
        const bloomT = ageMs / CFG.arrivalDuration;
        const bloomAlpha = (1 - bloomT) * 0.3 * opacity;
        if (bloomAlpha > 0.005) {
            const bloomR = CFG.glowRadius * 1.8;
            const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, bloomR);
            grad.addColorStop(0, rgba(c, bloomAlpha));
            grad.addColorStop(0.4, rgba(c, bloomAlpha * 0.4));
            grad.addColorStop(1, rgba(c, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(sx, sy, bloomR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * Connection-age brightness.
     * New peers start dim, veteran peers glow fully.
     * Uses conntime (Unix timestamp from Bitcoin Core) to compute real age.
     */
    function getAgeBrightness(node, nowSec) {
        if (!node.conntime || node.conntime <= 0) return CFG.ageBrightnessMax;
        const ageSec = nowSec - node.conntime;
        if (ageSec <= 0) return CFG.ageBrightnessMin;
        const t = clamp(ageSec / CFG.ageRampSeconds, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        return CFG.ageBrightnessMin + (CFG.ageBrightnessMax - CFG.ageBrightnessMin) * eased;
    }

    /**
     * Direction-aware pulse with nervousness decay.
     * - Inbound:  slow, gentle sinusoidal breathing
     * - Outbound: faster pulse with sharper abs-sin shape
     * - Young peers get extra "nervous" speed that decays with age
     */
    function getDirectionPulse(node, ageMs, connAgeSec) {
        const isInbound = node.direction === 'IN';
        const baseSpeed = isInbound ? CFG.pulseSpeedInbound : CFG.pulseSpeedOutbound;
        const depth = isInbound ? CFG.pulseDepthInbound : CFG.pulseDepthOutbound;

        // Nervousness: young peers pulse faster, decays over time
        const nervT = clamp(connAgeSec / CFG.nervousnessRampSec, 0, 1);
        const nervousness = CFG.nervousnessMax * (1 - nervT);
        const speed = baseSpeed + nervousness;

        if (isInbound) {
            return (1 - depth) + depth * (0.5 + 0.5 * Math.sin(node.phase + ageMs * speed));
        } else {
            const raw = Math.abs(Math.sin(node.phase + ageMs * speed));
            return (1 - depth) + depth * raw;
        }
    }

    /**
     * Draw a single node on the canvas at all visible wrap positions.
     * Lifecycle phases:
     *   1. Arrival bloom (first ~5s) — expanding ring + energetic glow
     *   2. Connected state — brightness ramps with age, nervousness decays
     *   3. Fade-out — eased dissolve when peer disconnects
     */
    function drawNode(node, now, wrapOffsets) {
        if (now < node.spawnTime) return;

        // Network filter: skip nodes whose network isn't enabled
        // (but always draw fading-out nodes so they dissolve gracefully)
        if (!passesNetFilter(node.net) && node.alive) return;

        const c = node.color;
        const ageMs = now - node.spawnTime;
        const nowSec = Math.floor(now / 1000);
        const connAgeSec = (node.conntime > 0) ? Math.max(0, nowSec - node.conntime) : 0;
        const inArrival = ageMs < CFG.arrivalDuration;

        // ── Connection-age brightness (dim newcomers, bright veterans) ──
        const brightness = getAgeBrightness(node, nowSec);

        // ── Fade-in: ease-out curve for smooth materialization ──
        let opacity = 1;
        if (ageMs < CFG.fadeInDuration) {
            const t = ageMs / CFG.fadeInDuration;
            opacity = 1 - Math.pow(1 - t, 2);
        }

        // ── Fade-out: eased curve so nodes dissolve gracefully ──
        if (!node.alive && node.fadeOutStart) {
            const fadeAge = now - node.fadeOutStart;
            const t = clamp(fadeAge / CFG.fadeOutDuration, 0, 1);
            opacity = Math.pow(1 - t, CFG.fadeOutEase);
            if (opacity <= 0.001) return;
        }

        // ── Pulse (direction-aware + nervousness for young peers) ──
        let pulse;
        if (inArrival) {
            // During arrival: fast energetic pulse
            pulse = 0.55 + 0.45 * Math.abs(Math.sin(node.phase + ageMs * CFG.arrivalPulseSpeed));
        } else {
            pulse = getDirectionPulse(node, ageMs, connAgeSec);
        }

        // Spawn "pop" scale effect (first 600ms)
        let scale = 1;
        if (ageMs < 600) {
            const t = ageMs / 600;
            scale = t < 0.6 ? (t / 0.6) * 1.4 : 1.4 - 0.4 * ((t - 0.6) / 0.4);
        }

        const r = CFG.nodeRadius * scale;
        const gr = CFG.glowRadius * scale * pulse;

        // Draw at each wrap offset
        for (const off of wrapOffsets) {
            const s = worldToScreen(node.lon + off, node.lat);
            // Skip if well off screen (with bloom margin)
            const margin = inArrival ? CFG.arrivalRingMaxRadius : gr;
            if (s.x < -margin || s.x > W + margin || s.y < -margin || s.y > H + margin) continue;

            // Arrival bloom effect (ring + glow) — drawn behind the node
            if (inArrival && node.alive) {
                drawArrivalBloom(s.x, s.y, c, ageMs, opacity);
            }

            drawNodeAt(s.x, s.y, c, r, gr, pulse, opacity, brightness);
        }
    }

    /**
     * Draw subtle connection lines between nearby nodes.
     * Only draws between nodes that are close on screen (< 250px apart)
     * and skips fading-out nodes to avoid visual clutter.
     * Uses wrap offsets so connections work across the date line.
     */
    function drawConnectionLines(now, wrapOffsets) {
        ctx.lineWidth = 0.5;
        let aliveNodes = nodes.filter(n => n.alive);
        // Respect network filter for connection lines too
        if (!isAllNetsEnabled()) {
            aliveNodes = aliveNodes.filter(n => passesNetFilter(n.net));
        }

        for (const off of wrapOffsets) {
            for (let i = 0; i < aliveNodes.length; i++) {
                const j = (i + 1) % aliveNodes.length;
                const a = worldToScreen(aliveNodes[i].lon + off, aliveNodes[i].lat);
                const b = worldToScreen(aliveNodes[j].lon + off, aliveNodes[j].lat);

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 250 || dist < 20) continue;

                const alpha = 0.08 * (1 - dist / 250);
                ctx.strokeStyle = rgba(aliveNodes[i].color, alpha);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // HUD — Peer count, block height, network badges
    // Updated every frame from current node state.
    // ═══════════════════════════════════════════════════════════

    // Countdown timer state
    let lastPeerFetchTime = 0;
    let countdownInterval = null;

    function startCountdownTimer() {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const cdEl = document.getElementById('mo-countdown');
            if (!cdEl) return;
            const elapsed = Date.now() - lastPeerFetchTime;
            const remaining = Math.max(0, Math.ceil((CFG.pollInterval - elapsed) / 1000));
            cdEl.textContent = remaining + 's';
        }, 1000);
    }

    function updateHUD() {
        // Count alive nodes by network type
        const netCounts = { ipv4: 0, ipv6: 0, onion: 0, i2p: 0, cjdns: 0 };
        let total = 0;
        for (const n of nodes) {
            if (!n.alive) continue;
            total++;
            if (netCounts.hasOwnProperty(n.net)) netCounts[n.net]++;
        }

        // Map overlay — peer count
        const moPeers = document.getElementById('mo-peers');
        if (moPeers) {
            moPeers.textContent = total;
            pulseOnChange('mo-peers', total, 'white');
        }

        // Map overlay — status
        const moStatus = document.getElementById('mo-status');
        if (moStatus && lastNodeInfo) {
            if (lastNodeInfo.blockchain && lastNodeInfo.blockchain.ibd) {
                moStatus.textContent = 'Syncing (IBD)';
                moStatus.style.color = 'var(--warn)';
            } else {
                moStatus.textContent = 'Synced';
                moStatus.style.color = 'var(--ok)';
            }
        }

        // Map overlay — status message (like original: "Map Loaded!" / "Locating X peers...")
        const moMsg = document.getElementById('mo-status-msg');
        if (moMsg) {
            // Count pending geolocation peers
            let pendingGeo = 0;
            for (const n of nodes) {
                if (n.alive && n.location_status === 'pending') pendingGeo++;
            }
            if (pendingGeo > 0) {
                moMsg.textContent = `Locating ${pendingGeo} peer${pendingGeo > 1 ? 's' : ''}...`;
                moMsg.classList.remove('loaded');
            } else if (total > 0) {
                moMsg.textContent = 'Map Loaded!';
                moMsg.classList.add('loaded');
            }
        }

        // Badge counts (inside the filter badges)
        const bcAll = document.getElementById('bc-all');
        const bcIpv4 = document.getElementById('bc-ipv4');
        const bcIpv6 = document.getElementById('bc-ipv6');
        const bcTor = document.getElementById('bc-tor');
        const bcI2p = document.getElementById('bc-i2p');
        const bcCjdns = document.getElementById('bc-cjdns');
        if (bcAll) { bcAll.textContent = total; pulseOnChange('bc-all', total, 'white'); }
        if (bcIpv4) { bcIpv4.textContent = netCounts.ipv4; pulseOnChange('bc-ipv4', netCounts.ipv4); }
        if (bcIpv6) { bcIpv6.textContent = netCounts.ipv6; pulseOnChange('bc-ipv6', netCounts.ipv6); }
        if (bcTor) { bcTor.textContent = netCounts.onion; pulseOnChange('bc-tor', netCounts.onion); }
        if (bcI2p) { bcI2p.textContent = netCounts.i2p; pulseOnChange('bc-i2p', netCounts.i2p); }
        if (bcCjdns) { bcCjdns.textContent = netCounts.cjdns; pulseOnChange('bc-cjdns', netCounts.cjdns); }
    }

    /** Position the Antarctica annotation on the map landmass */
    function updateAntarcticaNote() {
        if (!antNote || antNote.classList.contains('hidden')) return;
        // Place at central Antarctica (~-72°lat, 30°lon — near Novolazarevskaya)
        const s = worldToScreen(30, -72);
        // Offset so the note sits centered above the point
        const noteW = antNote.offsetWidth || 340;
        const noteH = antNote.offsetHeight || 40;
        antNote.style.left = Math.max(8, Math.min(W - noteW - 8, s.x - noteW / 2)) + 'px';
        antNote.style.top = Math.max(48, Math.min(H - noteH - 40, s.y - noteH - 12)) + 'px';
    }

    /** Update the clock display in the topbar */
    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        clockEl.textContent = `${h}:${m}:${s}`;
    }

    // ═══════════════════════════════════════════════════════════
    // TOOLTIP — Rich peer inspection on hover
    // ═══════════════════════════════════════════════════════════

    /** Find the nearest alive node within hit radius of screen coords. */
    function findNodeAtScreen(sx, sy) {
        const hitRadius = 12;
        const offsets = getWrapOffsets();
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (!nodes[i].alive) continue;
            for (const off of offsets) {
                const s = worldToScreen(nodes[i].lon + off, nodes[i].lat);
                const dx = s.x - sx;
                const dy = s.y - sy;
                if (dx * dx + dy * dy < hitRadius * hitRadius) {
                    return nodes[i];
                }
            }
        }
        return null;
    }

    /** Build a tooltip row: label + value, skipping empty values */
    function ttRow(label, value) {
        if (!value && value !== 0 && value !== false) return '';
        return `<div class="tt-row"><span class="tt-label">${label}</span><span class="tt-val">${value}</span></div>`;
    }

    /** Display comprehensive tooltip near cursor with peer details.
     *  When pinned=true, tooltip gets pointer-events and a disconnect button. */
    function showTooltip(node, mx, my, pinned) {
        const netLabel = NET_DISPLAY[node.net] || node.net.toUpperCase();
        const netColor = rgba(node.color, 0.9);

        // Direction + connection type
        const dirLabel = node.direction === 'IN' ? 'Inbound' : 'Outbound';
        const typeStr = node.connection_type
            ? `${dirLabel} / ${node.connection_type}`
            : dirLabel;

        // Address display
        const addrDisplay = (node.ip && node.port)
            ? `${node.ip}:${node.port}`
            : node.addr || '—';

        // Location: build from parts, skip empties
        let locationParts = [];
        if (!node.isPrivate) {
            if (node.city) locationParts.push(node.city);
            if (node.regionName) locationParts.push(node.regionName);
            if (node.country) locationParts.push(node.country);
        }
        const locationStr = locationParts.length > 0
            ? locationParts.join(', ')
            : '<span class="tt-muted">Private Network</span>';

        // Addrman
        const addrmanStr = node.isPrivate ? '—' : (node.in_addrman ? 'Yes' : 'No');

        // Build tooltip HTML — grouped sections
        let html = '';

        // ── Header: Peer ID with network color accent ──
        html += `<div class="tt-header">`;
        html += `<span class="tt-peer-id">Peer ${node.peerId}</span>`;
        html += `<span class="tt-net" style="color:${netColor}">${netLabel}</span>`;
        html += `</div>`;

        // ── Identity / Connection ──
        html += `<div class="tt-section">`;
        html += ttRow('Address', addrDisplay);
        html += ttRow('Type', typeStr);
        if (node.subver) html += ttRow('Software', node.subver);
        html += `</div>`;

        // ── Location ──
        html += `<div class="tt-section">`;
        html += `<div class="tt-row"><span class="tt-label">Location</span><span class="tt-val">${locationStr}</span></div>`;
        if (!node.isPrivate && node.isp) html += ttRow('ISP', node.isp);
        html += ttRow('Addrman', addrmanStr);
        html += `</div>`;

        // ── Performance ──
        html += `<div class="tt-section">`;
        html += ttRow('Ping', node.ping + 'ms');
        if (node.conntime_fmt) html += ttRow('Uptime', node.conntime_fmt);
        html += `</div>`;

        // ── Actions (only when pinned) ──
        if (pinned) {
            html += `<div class="tt-actions">`;
            html += `<button class="tt-action-btn tt-disconnect" data-id="${node.peerId}" data-net="${node.net}">Disconnect</button>`;
            html += `</div>`;
        }

        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');

        // Pinned tooltips are interactive (clickable buttons)
        if (pinned) {
            tooltipEl.classList.add('pinned');
            tooltipEl.style.pointerEvents = 'auto';
            // Bind disconnect button
            const dcBtn = tooltipEl.querySelector('.tt-disconnect');
            if (dcBtn) {
                dcBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showDisconnectDialog(parseInt(dcBtn.dataset.id), dcBtn.dataset.net);
                });
            }
        } else {
            tooltipEl.classList.remove('pinned');
            tooltipEl.style.pointerEvents = 'none';
        }

        // Position: prefer right of cursor, flip left if near right edge
        const ttWidth = 260;
        const ttPad = 16;
        let tx = mx + ttPad;
        if (tx + ttWidth > W - 10) {
            tx = mx - ttPad - ttWidth;
        }
        let ty = my - 10;
        tooltipEl.style.left = Math.max(10, tx) + 'px';
        tooltipEl.style.top = Math.max(48, ty) + 'px';
    }

    function hideTooltip() {
        tooltipEl.classList.add('hidden');
        tooltipEl.classList.remove('pinned');
        tooltipEl.style.pointerEvents = 'none';
        hoveredNode = null;
        pinnedNode = null;
    }

    /** Highlight a table row by peer ID (map node hover → table row).
     *  Visual highlight only — never scrolls the table on hover.
     *  Pass scrollIntoView=true for click-driven selection. */
    function highlightTableRow(peerId, scrollIntoView) {
        // Remove previous highlight
        const prev = tbodyEl.querySelector('.row-highlight');
        if (prev) prev.classList.remove('row-highlight');

        if (peerId === null) return;

        const row = tbodyEl.querySelector(`tr[data-id="${peerId}"]`);
        if (row) {
            row.classList.add('row-highlight');
            if (scrollIntoView && !panelEl.classList.contains('collapsed')) {
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // BOTTOM PEER PANEL — Full peer table with all columns
    // ═══════════════════════════════════════════════════════════

    // Connection type acronyms: short form + full description for hover
    const CONN_TYPE_SHORT = {
        'outbound-full-relay': 'OFR',
        'block-relay-only': 'BRO',
        'manual': 'MAN',
        'addr-fetch': 'AF',
        'feeler': 'FLR',
        'inbound': 'IN',
    };
    const CONN_TYPE_FULL = {
        'OFR': 'Outbound Full Relay',
        'BRO': 'Block Relay Only',
        'MAN': 'Manual',
        'AF': 'Address Fetch',
        'FLR': 'Feeler',
        'IN': 'Inbound',
        'OUT': 'Outbound',
    };

    /** Get short type string for a peer and its full description */
    function peerTypeShort(p) {
        const dir = p.direction === 'IN' ? 'IN' : 'OUT';
        if (!p.connection_type) return dir;
        const ct = CONN_TYPE_SHORT[p.connection_type] || p.connection_type;
        return p.direction === 'IN' ? ct : `${dir}/${ct}`;
    }
    function peerTypeFull(p) {
        const dir = p.direction === 'IN' ? 'Inbound' : 'Outbound';
        return p.connection_type ? `${dir} / ${p.connection_type}` : dir;
    }

    // Column definitions: { key, label, get(short), full(hover), vis, width }
    // width: preferred width in px for fixed layout. min is enforced via CSS.
    const COLUMNS = [
        { key: 'id',              label: 'ID',       get: p => p.id,                                      full: null,  vis: true,  w: 40  },
        { key: 'network',         label: 'Net',      get: p => (NET_DISPLAY[p.network] || p.network),     full: null,  vis: true,  w: 45  },
        { key: 'conntime_fmt',    label: 'Duration', get: p => p.conntime_fmt || '—',                     full: null,  vis: true,  w: 75  },
        { key: 'connection_type', label: 'Type',     get: p => peerTypeShort(p),                           full: p => peerTypeFull(p), vis: true, w: 70 },
        { key: 'addr',            label: 'IP:Port',  get: p => p.addr || `${p.ip}:${p.port}`,             full: null,  vis: true,  w: 130 },
        { key: 'subver',          label: 'Software', get: p => p.subver || '—',                            full: null,  vis: true,  w: 90  },
        { key: 'services_abbrev', label: 'Services', get: p => p.services_abbrev || '—',                   full: null,  vis: true,  w: 70  },
        { key: 'city',            label: 'City',     get: p => p.city || '—',                              full: null,  vis: true,  w: 60  },
        { key: 'regionName',      label: 'Region',   get: p => p.regionName || '—',                        full: null,  vis: true,  w: 55  },
        { key: 'country',         label: 'Country',  get: p => p.country || '—',                           full: null,  vis: true,  w: 70  },
        { key: 'continent',       label: 'Cont.',    get: p => p.continent || '—',                         full: null,  vis: true,  w: 60  },
        { key: 'isp',             label: 'ISP',      get: p => p.isp || '—',                               full: null,  vis: true,  w: 110 },
        { key: 'ping_ms',         label: 'Ping',     get: p => p.ping_ms != null ? p.ping_ms + 'ms' : '—', full: null, vis: true,  w: 50  },
        { key: 'bytessent_fmt',   label: 'Sent',     get: p => p.bytessent_fmt || '—',                     full: null,  vis: true,  w: 60  },
        { key: 'bytesrecv_fmt',   label: 'Recv',     get: p => p.bytesrecv_fmt || '—',                     full: null,  vis: true,  w: 60  },
        { key: 'in_addrman',      label: 'Addrman',  get: p => p.in_addrman ? 'Yes' : 'No',                full: null,  vis: true,  w: 55  },
        // Advanced columns (hidden by default)
        { key: 'direction',       label: 'Dir',      get: p => p.direction === 'IN' ? 'IN' : 'OUT',        full: p => p.direction === 'IN' ? 'Inbound' : 'Outbound', vis: false, w: 40 },
        { key: 'countryCode',     label: 'CC',       get: p => p.countryCode || '—',                       full: null,  vis: false, w: 35  },
        { key: 'continentCode',   label: 'CC',       get: p => p.continentCode || '—',                     full: null,  vis: false, w: 35  },
        { key: 'lat',             label: 'Lat',      get: p => p.lat != null ? p.lat.toFixed(2) : '—',     full: null,  vis: false, w: 55  },
        { key: 'lon',             label: 'Lon',      get: p => p.lon != null ? p.lon.toFixed(2) : '—',     full: null,  vis: false, w: 55  },
        { key: 'region',          label: 'Rgn',      get: p => p.region || '—',                             full: null,  vis: false, w: 60  },
        { key: 'as',              label: 'AS',        get: p => p.as || '—',                                full: null,  vis: false, w: 80  },
        { key: 'asname',          label: 'AS Name',   get: p => p.asname || '—',                            full: null,  vis: false, w: 100 },
        { key: 'district',        label: 'District',  get: p => p.district || '—',                          full: null,  vis: false, w: 80  },
        { key: 'mobile',          label: 'Mob',       get: p => p.mobile ? 'Y' : 'N',                       full: p => p.mobile ? 'Yes' : 'No', vis: false, w: 35 },
        { key: 'org',             label: 'Org',       get: p => p.org || '—',                               full: null,  vis: false, w: 100 },
        { key: 'timezone',        label: 'TZ',        get: p => p.timezone || '—',                          full: null,  vis: false, w: 70  },
        { key: 'currency',        label: 'Curr',      get: p => p.currency || '—',                          full: null,  vis: false, w: 45  },
        { key: 'hosting',         label: 'Host',      get: p => p.hosting ? 'Y' : 'N',                      full: p => p.hosting ? 'Yes' : 'No', vis: false, w: 35 },
        { key: 'offset',          label: 'UTC',        get: p => p.offset != null ? p.offset : '—',         full: null,  vis: false, w: 45  },
        { key: 'proxy',           label: 'Proxy',      get: p => p.proxy ? 'Y' : 'N',                       full: p => p.proxy ? 'Yes' : 'No', vis: false, w: 40 },
        { key: 'zip',             label: 'ZIP',        get: p => p.zip || '—',                              full: null,  vis: false, w: 55  },
    ];

    // Visible column keys (start with defaults, can be toggled later)
    let visibleColumns = COLUMNS.filter(c => c.vis).map(c => c.key);

    // Sort state
    let sortKey = 'id';
    let sortAsc = true;

    // Auto-fit column state: ON by default, OFF when user resizes
    let autoFitColumns = true;
    let userColumnWidths = {};  // key -> px width (only used when autoFit OFF)

    // Panel DOM (let because ban list view replaces and restores them)
    const panelEl = document.getElementById('peer-panel');
    let theadEl = document.getElementById('peer-thead');
    let tbodyEl = document.getElementById('peer-tbody');
    const handleCountEl = { textContent: '' };  // peer count now shown in badge only

    // Panel toggle
    document.getElementById('peer-panel-handle').addEventListener('click', () => {
        panelEl.classList.toggle('collapsed');
    });

    /** Get sorted copy of lastPeers based on current sort state.
     *  sortKey=null means unsorted (original peer order). */
    function getSortedPeers() {
        if (!sortKey) return [...lastPeers];  // unsorted — original order
        const col = COLUMNS.find(c => c.key === sortKey);
        if (!col) return [...lastPeers];
        return [...lastPeers].sort((a, b) => {
            let va = col.get(a);
            let vb = col.get(b);
            // Numeric-aware sort for known numeric fields
            if (typeof va === 'number' && typeof vb === 'number') {
                return sortAsc ? va - vb : vb - va;
            }
            // Strip 'ms' for ping column
            if (sortKey === 'ping_ms') {
                va = parseInt(va) || 0;
                vb = parseInt(vb) || 0;
                return sortAsc ? va - vb : vb - va;
            }
            va = String(va);
            vb = String(vb);
            return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
    }

    /** Build colgroup with column widths.
     *  Auto-fit ON: compute widths from data distribution (~95th percentile of value lengths),
     *  then scale proportionally to fill the viewport.
     *  Auto-fit OFF: use reasonable default widths from column definitions. */
    function renderColgroup() {
        const table = document.getElementById('peer-table');
        // Remove old colgroup if present
        const old = table.querySelector('colgroup');
        if (old) old.remove();

        if (autoFitColumns) {
            // ── Auto-fit: size columns to fit viewport based on data ──
            table.style.tableLayout = 'fixed';
            const cg = document.createElement('colgroup');
            const charPx = 7;  // approximate px per character at font-size 11px
            const headerPad = 28; // padding + sort arrow
            const colPad = 16;   // cell padding (8px each side)
            const actionsW = 80; // fixed actions column

            // Measure available width
            const tableWrap = table.closest('.peer-table-wrap');
            const availW = (tableWrap ? tableWrap.clientWidth : W) - actionsW;

            const widths = [];
            for (const key of visibleColumns) {
                const col = COLUMNS.find(c => c.key === key);
                if (!col) { widths.push(60); continue; }

                // Minimum: header label width
                const headerW = col.label.length * charPx + headerPad;

                if (lastPeers.length === 0) {
                    widths.push(Math.max(headerW, col.w));
                    continue;
                }

                // Gather string lengths for all values
                const lens = lastPeers.map(p => String(col.get(p)).length);
                lens.sort((a, b) => a - b);

                // Use ~95th percentile to ignore extreme outliers (e.g. Tor/I2P addresses)
                const p95Idx = Math.min(Math.floor(lens.length * 0.95), lens.length - 1);
                const p95Len = lens[p95Idx];
                const dataW = p95Len * charPx + colPad;

                widths.push(Math.max(headerW, Math.min(dataW, 250)));
            }

            // Scale proportionally to fill available width
            const totalNatural = widths.reduce((s, w) => s + w, 0);
            const scale = totalNatural > 0 ? Math.max(availW / totalNatural, 0.5) : 1;

            for (const w of widths) {
                const colEl = document.createElement('col');
                colEl.style.width = Math.round(w * scale) + 'px';
                cg.appendChild(colEl);
            }
            // Actions column
            const actCol = document.createElement('col');
            actCol.style.width = actionsW + 'px';
            cg.appendChild(actCol);
            table.insertBefore(cg, table.firstChild);
            return;
        }

        // ── Auto-fit OFF: use reasonable default widths from column definitions ──
        table.style.tableLayout = 'fixed';
        const cg = document.createElement('colgroup');
        for (const key of visibleColumns) {
            const col = COLUMNS.find(c => c.key === key);
            const colEl = document.createElement('col');
            const w = userColumnWidths[key] || (col ? col.w : 80);
            colEl.style.width = w + 'px';
            cg.appendChild(colEl);
        }
        // Actions column (single Disconnect button)
        const actCol = document.createElement('col');
        actCol.style.width = '80px';
        cg.appendChild(actCol);
        table.insertBefore(cg, table.firstChild);
    }

    /** Build table header row with resize handles */
    function renderPeerTableHead() {
        let html = '<tr>';
        for (const key of visibleColumns) {
            const col = COLUMNS.find(c => c.key === key);
            if (!col) continue;
            const isActive = sortKey === key;
            // 3-state: no sortKey = unsorted (dim arrow), asc = ▲, desc = ▼
            const arrow = isActive ? (sortAsc ? '&#9650;' : '&#9660;') : '';
            const cls = isActive ? 'sort-arrow active' : 'sort-arrow';
            html += `<th data-sort="${key}"><span class="th-text">${col.label} <span class="${cls}">${arrow}</span></span><span class="th-resize" data-col="${key}"></span></th>`;
        }
        html += '<th>Actions</th>';
        html += '</tr>';
        theadEl.innerHTML = html;
        renderColgroup();
    }

    /** Build table body from lastPeers (filtered by active network filter) */
    function renderPeerTable() {
        if (!tbodyEl) return;
        let sorted = getSortedPeers();

        // Apply network filter to table as well
        if (!isAllNetsEnabled()) {
            sorted = sorted.filter(p => passesNetFilter(p.network || 'ipv4'));
        }

        handleCountEl.textContent = sorted.length;

        let html = '';
        for (const peer of sorted) {
            const isHighlighted = highlightedPeerId === peer.id;
            const cls = isHighlighted ? ' class="row-highlight"' : '';
            const net = peer.network || 'ipv4';
            html += `<tr data-id="${peer.id}" data-net="${net}"${cls}>`;
            for (const key of visibleColumns) {
                const col = COLUMNS.find(c => c.key === key);
                if (!col) continue;
                const val = col.get(peer);
                const hoverVal = col.full ? col.full(peer) : val;
                html += `<td title="${String(hoverVal).replace(/"/g, '&quot;')}">${val}</td>`;
            }
            // Action buttons — single Disconnect button opens confirmation dialog
            html += '<td>';
            html += `<button class="peer-action-btn" data-action="disconnect" data-id="${peer.id}" data-net="${net}">Disconnect</button>`;
            html += '</td>';
            html += '</tr>';
        }
        tbodyEl.innerHTML = html;
    }

    // Initial header render
    renderPeerTableHead();

    // ── Named event handlers (for reattachment after ban list close) ──

    let resizingColumn = false;  // suppress sort click when resize drag occurred

    function handleTheadClick(e) {
        // Suppress sort if this click followed a column resize drag
        if (resizingColumn) {
            resizingColumn = false;
            return;
        }
        // Ignore clicks on resize handles
        if (e.target.closest('.th-resize')) return;
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const key = th.dataset.sort;
        // 3-state sort cycle: unsorted → ascending → descending → unsorted
        if (sortKey === key) {
            if (sortAsc) {
                sortAsc = false;  // asc → desc
            } else {
                sortKey = null;   // desc → unsorted
                sortAsc = true;
            }
        } else {
            sortKey = key;
            sortAsc = true;       // new column → ascending
        }
        renderPeerTableHead();
        renderPeerTable();
    }

    let resizeState = null;
    function handleTheadResize(e) {
        const handle = e.target.closest('.th-resize');
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        const colKey = handle.dataset.col;
        const th = handle.parentElement;
        const startX = e.clientX;
        const startW = th.offsetWidth;

        resizeState = { colKey, th, startX, startW };

        const onMove = (me) => {
            if (!resizeState) return;
            resizingColumn = true;  // flag to suppress subsequent sort click
            const delta = me.clientX - resizeState.startX;
            const newW = Math.max(30, resizeState.startW + delta);
            if (autoFitColumns) {
                autoFitColumns = false;
                const ths = theadEl.querySelectorAll('th[data-sort]');
                ths.forEach(t => {
                    const key = t.dataset.sort;
                    if (key) userColumnWidths[key] = t.offsetWidth;
                });
                updateAutoFitBtn();
            }
            userColumnWidths[resizeState.colKey] = newW;
            renderColgroup();
        };
        const onUp = () => {
            resizeState = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    // Sort on column header click
    theadEl.addEventListener('click', handleTheadClick);
    // Column resize via drag on th-resize handles
    theadEl.addEventListener('mousedown', handleTheadResize);

    // ── Auto-fit toggle button ──
    const autoFitBtn = document.getElementById('btn-autofit');
    function updateAutoFitBtn() {
        autoFitBtn.classList.toggle('active', autoFitColumns);
    }
    updateAutoFitBtn();
    autoFitBtn.addEventListener('click', () => {
        autoFitColumns = !autoFitColumns;
        if (autoFitColumns) userColumnWidths = {};
        updateAutoFitBtn();
        renderColgroup();
    });

    // ── Ban list modal (overlay — peer table stays visible underneath) ──
    const bansBtn = document.getElementById('btn-bans');
    let banModalOpen = false;

    bansBtn.addEventListener('click', () => {
        if (banModalOpen) {
            closeBanModal();
        } else {
            openBanModal();
        }
    });

    function openBanModal() {
        banModalOpen = true;
        bansBtn.classList.add('active');

        // Remove any existing modal
        const existing = document.getElementById('ban-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'ban-modal';
        modal.className = 'ban-modal-overlay';
        modal.innerHTML = `
            <div class="ban-modal-box">
                <div class="ban-modal-header">
                    <span class="ban-modal-title">Banned IPs</span>
                    <button class="ban-modal-close" id="ban-modal-close">&times;</button>
                </div>
                <div class="ban-modal-body" id="ban-modal-body">
                    <div class="ban-list-loading">Loading ban list...</div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        // Close button
        document.getElementById('ban-modal-close').addEventListener('click', closeBanModal);
        // Close on overlay background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeBanModal();
        });

        fetchBanList();
    }

    function closeBanModal() {
        banModalOpen = false;
        bansBtn.classList.remove('active');
        const modal = document.getElementById('ban-modal');
        if (modal) modal.remove();
    }

    async function fetchBanList() {
        const body = document.getElementById('ban-modal-body');
        if (!body) return;
        try {
            const resp = await fetch('/api/bans');
            const data = await resp.json();
            const bans = data.bans || [];
            renderBanList(bans);
        } catch (err) {
            body.innerHTML = `<div class="ban-list-loading" style="color:var(--err)">Failed to load bans: ${err.message}</div>`;
        }
    }

    function renderBanList(bans) {
        const body = document.getElementById('ban-modal-body');
        if (!body) return;

        let html = '';
        // Header with count + clear all
        html += '<div class="ban-list-header">';
        html += `<span class="ban-list-title">Banned IPs (${bans.length})</span>`;
        if (bans.length > 0) {
            html += '<button class="toolbar-btn ban-clear-all" id="ban-clear-all">Clear All Bans</button>';
        }
        html += '</div>';

        if (bans.length === 0) {
            html += '<div class="ban-list-empty">No banned IPs</div>';
        } else {
            html += '<div class="ban-modal-table-wrap"><table class="peer-table ban-table"><thead><tr>';
            html += '<th>Address</th><th>Ban Created</th><th>Ban Until</th><th>Actions</th>';
            html += '</tr></thead><tbody>';
            for (const ban of bans) {
                const addr = ban.address || '—';
                const created = ban.ban_created ? new Date(ban.ban_created * 1000).toLocaleString() : '—';
                const until = ban.banned_until ? new Date(ban.banned_until * 1000).toLocaleString() : '—';
                html += '<tr>';
                html += `<td title="${addr}">${addr}</td>`;
                html += `<td>${created}</td>`;
                html += `<td>${until}</td>`;
                html += `<td><button class="peer-action-btn ban-unban" data-addr="${addr}">Unban</button></td>`;
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        }
        body.innerHTML = html;

        // Bind unban buttons
        body.querySelectorAll('.ban-unban').forEach(btn => {
            btn.addEventListener('click', async () => {
                const addr = btn.dataset.addr;
                try {
                    const resp = await fetch('/api/peer/unban', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ address: addr }),
                    });
                    const data = await resp.json();
                    if (data.success) {
                        showActionResult(`Unbanned ${addr}`, true);
                        fetchBanList();
                    } else {
                        showActionResult(`Unban failed: ${data.error}`, false);
                    }
                } catch (err) {
                    showActionResult(`Error: ${err.message}`, false);
                }
            });
        });

        // Bind clear all
        const clearBtn = document.getElementById('ban-clear-all');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (!confirm('Clear ALL bans? This cannot be undone.')) return;
                try {
                    const resp = await fetch('/api/bans/clear', { method: 'POST' });
                    const data = await resp.json();
                    if (data.success) {
                        showActionResult('All bans cleared', true);
                        fetchBanList();
                    } else {
                        showActionResult(`Clear failed: ${data.error}`, false);
                    }
                } catch (err) {
                    showActionResult(`Error: ${err.message}`, false);
                }
            });
        }
    }

    // Table row click → center map on peer + open tooltip
    function handleTbodyClick(e) {
        const btn = e.target.closest('.peer-action-btn');
        if (btn) {
            e.stopPropagation();
            handlePeerAction(btn.dataset.action, parseInt(btn.dataset.id), btn.dataset.net);
            return;
        }

        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        const peerId = parseInt(row.dataset.id);
        const rowNet = row.dataset.net;

        // Private networks: don't pan/zoom, show info popup instead
        const isPrivateNet = (rowNet === 'onion' || rowNet === 'i2p' || rowNet === 'cjdns');
        if (isPrivateNet) {
            const netName = NET_DISPLAY[rowNet] || rowNet.toUpperCase();
            showPrivateNetPopup(`${netName} peers cannot be geolocated and are placed in Antarctica for visualization.`);
            return;
        }

        const node = nodes.find(n => n.peerId === peerId && n.alive);
        if (node) {
            // Select this peer: reset map to world view, then zoom into the peer.
            // Peer lands at ~30% from top of visible map area.
            const p = project(node.lon, node.lat);

            // For southern peers (lat < -30), auto-collapse the panel so they're visible
            if (node.lat < -30 && !panelEl.classList.contains('collapsed')) {
                panelEl.classList.add('collapsed');
            }

            // Calculate visible map area
            const topbarH = 40;
            const panelH = panelEl.classList.contains('collapsed') ? 32 : 340;
            const visibleTop = topbarH;
            const visibleBot = H - panelH;
            const visibleH = visibleBot - visibleTop;
            const targetScreenY = visibleTop + visibleH * 0.30;

            // Mercator world bounds for vertical clamping
            const yTop = project(0, 85).y;
            const yBot = project(0, -85).y;

            // Find minimum zoom that allows correct peer positioning.
            // Start at zoom 3 (standard); escalate for edge-case peers
            // near world bounds (e.g. Australia, Antarctica).
            let z = 3;
            for (; z <= CFG.maxZoom; z += 0.2) {
                const offsetFromCenter = (H / 2 - targetScreenY) / z;
                const candidateY = (p.y - 0.5) * H - offsetFromCenter;
                const minPanY = (yTop - 0.5) * H + H / (2 * z);
                const maxPanY = (yBot - 0.5) * H - H / (2 * z);
                if (minPanY < maxPanY && candidateY >= minPanY && candidateY <= maxPanY) {
                    break;
                }
            }
            z = Math.min(z, CFG.maxZoom);

            const offsetFromCenter = (H / 2 - targetScreenY) / z;
            const finalX = (p.x - 0.5) * W;
            const finalY = (p.y - 0.5) * H - offsetFromCenter;

            // Reset view state to world baseline first (zoom 1, centered on peer longitude)
            // so we always zoom IN fresh, never pan from a previous peer's position.
            view.x = finalX;
            view.y = 0;
            view.zoom = 1;
            // Then set the target to animate smoothly into the peer
            targetView.x = finalX;
            targetView.y = finalY;
            targetView.zoom = z;

            // Set selection state + highlight row
            highlightedPeerId = peerId;
            pinnedNode = node;
            highlightTableRow(peerId, true);  // scroll into view on click

            // Open pinned tooltip at the node's screen position (once view settles)
            setTimeout(() => {
                const offsets = getWrapOffsets();
                for (const off of offsets) {
                    const s = worldToScreen(node.lon + off, node.lat);
                    if (s.x > -50 && s.x < W + 50 && s.y > -50 && s.y < H + 50) {
                        showTooltip(node, s.x, s.y, true);
                        hoveredNode = node;
                        break;
                    }
                }
            }, 500);

            row.classList.add('row-selected');
            setTimeout(() => row.classList.remove('row-selected'), 1500);
        }
    }

    function handleTbodyHover(e) {
        const row = e.target.closest('tr[data-id]');
        if (row) {
            highlightedPeerId = parseInt(row.dataset.id);
        }
    }

    function handleTbodyLeave() {
        highlightedPeerId = null;
    }

    tbodyEl.addEventListener('click', handleTbodyClick);
    tbodyEl.addEventListener('mouseover', handleTbodyHover);
    tbodyEl.addEventListener('mouseleave', handleTbodyLeave);

    /** Show a confirmation dialog for disconnect with optional ban */
    function showDisconnectDialog(peerId, net) {
        const canBan = (net === 'ipv4' || net === 'ipv6');
        // Remove any existing dialog
        const existing = document.getElementById('disconnect-dialog');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'disconnect-dialog';
        overlay.className = 'dialog-overlay';
        overlay.innerHTML = `
            <div class="dialog-box">
                <div class="dialog-title">Disconnect Peer ${peerId}</div>
                <div class="dialog-text">Choose an action for this peer:</div>
                <div class="dialog-actions">
                    <button class="dialog-btn dialog-btn-disconnect" data-choice="disconnect">Disconnect Only</button>
                    ${canBan ? `<button class="dialog-btn dialog-btn-ban" data-choice="ban">Disconnect + Ban 24h</button>` : ''}
                    <button class="dialog-btn dialog-btn-cancel" data-choice="cancel">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        // Handle button clicks
        overlay.addEventListener('click', async (e) => {
            const btn = e.target.closest('.dialog-btn');
            if (!btn) return;
            const choice = btn.dataset.choice;
            overlay.remove();

            if (choice === 'cancel') return;

            try {
                if (choice === 'ban') {
                    // Ban first, then disconnect
                    const banResp = await fetch('/api/peer/ban', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ peer_id: peerId }),
                    });
                    const banData = await banResp.json();
                    if (!banData.success) {
                        showActionResult(`Ban failed: ${banData.error}`, false);
                        return;
                    }
                    const dcResp = await fetch('/api/peer/disconnect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ peer_id: peerId }),
                    });
                    const dcData = await dcResp.json();
                    if (dcData.success) {
                        showActionResult(`Banned ${banData.banned_ip} and disconnected peer ${peerId}`, true);
                    } else {
                        showActionResult(`Banned but disconnect failed: ${dcData.error}`, false);
                    }
                } else {
                    const resp = await fetch('/api/peer/disconnect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ peer_id: peerId }),
                    });
                    const data = await resp.json();
                    if (data.success) {
                        showActionResult(`Disconnected peer ${peerId}`, true);
                    } else {
                        showActionResult(`Failed: ${data.error}`, false);
                    }
                }
                setTimeout(fetchPeers, 1000);
            } catch (err) {
                showActionResult(`Error: ${err.message}`, false);
            }
        });

        // Close on overlay background click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    /** Handle disconnect action from table row button */
    function handlePeerAction(action, peerId, net) {
        showDisconnectDialog(peerId, net || 'ipv4');
    }

    /** Show a temporary result notification */
    function showActionResult(msg, success) {
        // Remove existing notification
        const existing = document.getElementById('action-notification');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.id = 'action-notification';
        el.style.cssText = `position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:400;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;pointer-events:none;backdrop-filter:blur(12px);border:1px solid;`;
        if (success) {
            el.style.color = 'var(--ok)';
            el.style.borderColor = 'rgba(63,185,80,0.4)';
            el.style.background = 'rgba(10,14,20,0.92)';
        } else {
            el.style.color = 'var(--err)';
            el.style.borderColor = 'rgba(248,81,73,0.4)';
            el.style.background = 'rgba(10,14,20,0.92)';
        }
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
    }

    // ═══════════════════════════════════════════════════════════
    // NODE HIGHLIGHT RING — Draw highlight for map↔table interaction
    // ═══════════════════════════════════════════════════════════

    /** Draw a highlight ring around a node when it's highlighted via table hover.
     *  When pinned (selected), draws a brighter pulsing halo so it's
     *  unambiguous which peer is selected even in dense clusters. */
    function drawHighlightRing(node, now, wrapOffsets) {
        if (!node.alive) return;
        const isPinned = pinnedNode && pinnedNode.peerId === node.peerId;
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.005);
        const r = CFG.nodeRadius * 2.5;
        for (const off of wrapOffsets) {
            const s = worldToScreen(node.lon + off, node.lat);
            if (s.x < -r * 3 || s.x > W + r * 3 || s.y < -r * 3 || s.y > H + r * 3) continue;

            if (isPinned) {
                // Outer soft glow halo
                const glowR = r * 2.2;
                const grad = ctx.createRadialGradient(s.x, s.y, r, s.x, s.y, glowR);
                grad.addColorStop(0, rgba(node.color, 0.3 * pulse));
                grad.addColorStop(1, rgba(node.color, 0));
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
                ctx.fill();

                // Inner bright ring
                ctx.strokeStyle = rgba(node.color, 0.8 * pulse);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                // Hover: subtle white ring
                ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, 0.5 * pulse);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // MAIN RENDER LOOP
    // Runs at ~60fps via requestAnimationFrame.
    // ═══════════════════════════════════════════════════════════

    /**
     * Clamp the view to prevent empty space.
     *
     * Horizontal: no clamping — the world wraps seamlessly, so the
     * user can pan left/right forever. getWrapOffsets() ensures we
     * always render enough copies to fill the viewport.
     *
     * Vertical:
     *   - At zoom <= 1: vertical panning is completely locked (centered)
     *   - At zoom > 1: panning is allowed but clamped so the Mercator
     *     world edges (±85°) never retreat inside the viewport.
     */
    function clampView() {
        // ── Horizontal: free (wrapping handles it) ──
        // No clamping on view.x or targetView.x

        // ── Vertical: Mercator bounds at ±85° latitude ──
        const yTop = project(0, 85).y;   // ~0.035
        const yBot = project(0, -85).y;  // ~0.965
        const centerY = ((yTop + yBot) / 2 - 0.5) * H;

        if (view.zoom <= 1.001) {
            // At zoom 1: lock vertical position — no panning at all
            view.y = centerY;
            targetView.y = centerY;
        } else {
            // Zoomed in: allow vertical pan within bounds.
            // World top in screen space = (yTop - 0.5) * H * zoom + H/2 - y * zoom
            // We want that to be <= 0 (world top at or above screen top)
            // => y >= (yTop - 0.5) * H + H / (2 * zoom)
            // Similarly, world bottom must be >= H (at or below screen bottom)
            // => y <= (yBot - 0.5) * H - H / (2 * zoom)
            const minPanY = (yTop - 0.5) * H + H / (2 * view.zoom);
            const maxPanY = (yBot - 0.5) * H - H / (2 * view.zoom);

            if (minPanY >= maxPanY) {
                // World doesn't fill screen vertically — center it
                view.y = centerY;
                targetView.y = centerY;
            } else {
                view.y = clamp(view.y, minPanY, maxPanY);
                targetView.y = clamp(targetView.y, minPanY, maxPanY);
            }
        }
    }

    function frame() {
        const now = Date.now();

        // Smooth view interpolation (pan/zoom easing)
        view.x = lerp(view.x, targetView.x, CFG.panSmooth);
        view.y = lerp(view.y, targetView.y, CFG.panSmooth);
        view.zoom = lerp(view.zoom, targetView.zoom, CFG.panSmooth);

        // Lock view within world bounds
        clampView();

        // Clear canvas with ocean colour
        ctx.fillStyle = '#06080c';
        ctx.fillRect(0, 0, W, H);

        // Compute wrap offsets once per frame
        const wrapOffsets = getWrapOffsets();

        // Draw layers bottom-to-top:
        // 1. Grid lines (always visible)
        drawGrid();
        // 2. Land polygons (always visible)
        drawLandmasses();
        // 3. Lakes carved out on top of land (always visible)
        drawLakes();
        // 4. Country borders (always visible at all zoom levels)
        drawCountryBorders();
        // 5. Country name labels (zoom >= 1.5) — first text layer
        drawCountryLabels();
        // 6. State/province borders (zoom >= 3.0, zoom-aware stroke width)
        drawStateBorders();
        // 7. State/province name labels (zoom >= 4.0, after countries)
        drawStateLabels();
        // 8. City labels (zoom >= 6.0, after states visible)
        drawCities();
        // 9. Connection mesh lines between nearby peers
        drawConnectionLines(now, wrapOffsets);

        // 10. Peer nodes (alive + fading out)
        for (const node of nodes) {
            drawNode(node, now, wrapOffsets);
        }

        // 11. Highlight ring for map↔table cross-highlighting
        //     Draw for pinned node (selection) and/or hovered node
        if (pinnedNode && pinnedNode.alive) {
            drawHighlightRing(pinnedNode, now, wrapOffsets);
        }
        if (highlightedPeerId !== null && (!pinnedNode || highlightedPeerId !== pinnedNode.peerId)) {
            const hlNode = nodes.find(n => n.peerId === highlightedPeerId && n.alive);
            if (hlNode) drawHighlightRing(hlNode, now, wrapOffsets);
        }

        // Update HUD overlays
        updateHUD();
        updateClock();
        updateAntarcticaNote();

        requestAnimationFrame(frame);
    }

    // ═══════════════════════════════════════════════════════════
    // INTERACTION — Pan, zoom, touch, hover
    // ═══════════════════════════════════════════════════════════

    // ── Mouse pan ──
    let dragZoom = 1;  // zoom level when drag started
    let dragMoved = false;  // track if mouse moved during drag (vs click)
    canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        dragMoved = false;
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
        dragViewStart.x = targetView.x;
        dragViewStart.y = targetView.y;
        dragZoom = view.zoom;  // capture current zoom for consistent drag speed
    });

    window.addEventListener('mousemove', (e) => {
        if (dragging) {
            // Pan the view by drag delta, scaled by zoom so drag feels 1:1 with the map
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
            targetView.x = dragViewStart.x - dx / dragZoom;
            // At zoom 1, vertical panning is locked (clampView enforces it)
            if (dragZoom > 1.001) {
                targetView.y = dragViewStart.y - dy / dragZoom;
            }
            if (dragMoved) hideTooltip();
        } else {
            // Hover detection for tooltip + table highlight
            const node = findNodeAtScreen(e.clientX, e.clientY);
            if (node) {
                // Don't override a pinned tooltip with hover
                if (!pinnedNode) {
                    showTooltip(node, e.clientX, e.clientY, false);
                }
                hoveredNode = node;
                highlightTableRow(node.peerId);
                canvas.style.cursor = 'pointer';
            } else if (hoveredNode && !pinnedNode) {
                hideTooltip();
                highlightTableRow(null);
                canvas.style.cursor = 'grab';
            } else if (!pinnedNode) {
                canvas.style.cursor = 'grab';
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (dragging && !dragMoved) {
            // This was a click, not a drag
            const node = findNodeAtScreen(e.clientX, e.clientY);
            if (node) {
                // Pin tooltip on this node
                pinnedNode = node;
                highlightedPeerId = node.peerId;
                showTooltip(node, e.clientX, e.clientY, true);
                // Scroll peer table to this row (expand panel if collapsed)
                if (panelEl.classList.contains('collapsed')) {
                    panelEl.classList.remove('collapsed');
                    // Wait for panel to expand before scrolling
                    setTimeout(() => highlightTableRow(node.peerId, true), 350);
                } else {
                    highlightTableRow(node.peerId, true);
                }
            } else if (pinnedNode) {
                // Clicked empty space — unpin
                hideTooltip();
                highlightTableRow(null);
            }
        }
        dragging = false;
    });

    // ── Mouse wheel zoom (zooms toward cursor position) ──
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const factor = dir > 0 ? CFG.zoomStep : 1 / CFG.zoomStep;
        const newZoom = clamp(targetView.zoom * factor, CFG.minZoom, CFG.maxZoom);

        // Remember world point under cursor before zoom
        const mx = e.clientX;
        const my = e.clientY;
        const worldBefore = screenToWorld(mx, my);

        targetView.zoom = newZoom;

        // Adjust pan so the world point stays under the cursor after zoom
        const pBefore = project(worldBefore.lon, worldBefore.lat);
        const sxAfter = (pBefore.x - 0.5) * W * targetView.zoom + W / 2 - targetView.x * targetView.zoom;
        const syAfter = (pBefore.y - 0.5) * H * targetView.zoom + H / 2 - targetView.y * targetView.zoom;
        targetView.x += (sxAfter - mx) / targetView.zoom;
        targetView.y += (syAfter - my) / targetView.zoom;
    }, { passive: false });

    // ── Touch pan (single finger) ──
    let touchStart = null;
    let touchZoom = 1;
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            dragViewStart.x = targetView.x;
            dragViewStart.y = targetView.y;
            touchZoom = view.zoom;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (touchStart && e.touches.length === 1) {
            const dx = e.touches[0].clientX - touchStart.x;
            const dy = e.touches[0].clientY - touchStart.y;
            targetView.x = dragViewStart.x - dx / touchZoom;
            // At zoom 1, vertical panning is locked
            if (touchZoom > 1.001) {
                targetView.y = dragViewStart.y - dy / touchZoom;
            }
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => { touchStart = null; }, { passive: true });

    // ── Zoom buttons ──
    document.getElementById('zoom-in').addEventListener('click', () => {
        targetView.zoom = clamp(targetView.zoom * CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        targetView.zoom = clamp(targetView.zoom / CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    document.getElementById('zoom-reset').addEventListener('click', () => {
        targetView.x = 0;
        targetView.y = 0;
        targetView.zoom = 1;
    });

    // ═══════════════════════════════════════════════════════════
    // NETWORK BADGE CONTROLS — Click to filter, hover for stats
    // ═══════════════════════════════════════════════════════════

    const netBadges = document.querySelectorAll('.handle-nets .net-badge');
    const netPopover = document.getElementById('net-popover');
    const antCloseBtn = document.getElementById('ant-close');
    let antNoteDismissed = false;  // tracks if user dismissed the annotation this session

    /** Update badge visual states to reflect the current multi-select filter */
    function updateBadgeStates() {
        const allOn = isAllNetsEnabled();
        netBadges.forEach(badge => {
            const net = badge.dataset.net;
            if (net === 'all') {
                badge.classList.toggle('active', allOn);
                badge.classList.toggle('dimmed', !allOn);
            } else {
                badge.classList.toggle('active', enabledNets.has(net));
                badge.classList.toggle('dimmed', !enabledNets.has(net));
            }
        });

        // Show Antarctica annotation when any private network is enabled
        // Once dismissed, stays closed for the entire session
        if (!antNoteDismissed) {
            const hasPrivate = enabledNets.has('onion') || enabledNets.has('i2p') || enabledNets.has('cjdns');
            if (hasPrivate) {
                antNote.classList.remove('hidden');
            } else {
                antNote.classList.add('hidden');
            }
        }
    }

    // Click to toggle network badges (multi-select)
    // stopPropagation prevents the peer-panel-handle click from toggling the panel
    netBadges.forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const net = badge.dataset.net;
            if (net === 'all') {
                // "All" → select everything
                enabledNets = new Set(ALL_NETS);
            } else {
                // Toggle this network
                if (enabledNets.has(net)) {
                    enabledNets.delete(net);
                    // Don't allow empty selection — re-enable if it would be empty
                    if (enabledNets.size === 0) {
                        enabledNets = new Set(ALL_NETS);
                    }
                } else {
                    enabledNets.add(net);
                }
            }
            updateBadgeStates();
            renderPeerTable();
        });

        // Hover to show network stats popover (positioned above the badge)
        badge.addEventListener('mouseenter', () => {
            const net = badge.dataset.net;
            const stats = getNetworkStats(net);
            if (!stats) return;
            netPopover.innerHTML = stats;
            netPopover.classList.remove('hidden');
            // Position popover above the hovered badge
            const rect = badge.getBoundingClientRect();
            netPopover.style.left = rect.left + 'px';
            netPopover.style.top = (rect.top - netPopover.offsetHeight - 6) + 'px';
        });
        badge.addEventListener('mouseleave', () => {
            netPopover.classList.add('hidden');
        });
    });

    // Close Antarctica annotation (dismisses until network filter changes)
    if (antCloseBtn) {
        antCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            antNoteDismissed = true;
            antNote.classList.add('hidden');
        });
    }

    /** Build popover HTML for a network type or "all" */
    function getNetworkStats(net) {
        const aliveNodes = nodes.filter(n => n.alive);
        const counts = { ipv4: 0, ipv6: 0, onion: 0, i2p: 0, cjdns: 0 };
        let inbound = 0, outbound = 0, totalPing = 0, pingCount = 0;

        for (const n of aliveNodes) {
            if (counts.hasOwnProperty(n.net)) counts[n.net]++;
            const match = (net === 'all') || (n.net === net);
            if (match) {
                if (n.direction === 'IN') inbound++;
                else outbound++;
                if (n.ping > 0) { totalPing += n.ping; pingCount++; }
            }
        }

        const total = net === 'all'
            ? aliveNodes.length
            : (counts[net] || 0);

        if (total === 0 && net !== 'all') return null;

        const avgPing = pingCount > 0 ? Math.round(totalPing / pingCount) : '—';
        const label = net === 'all' ? 'All Networks' : (NET_DISPLAY[net] || net.toUpperCase());

        let html = `<div class="pop-title">${label}</div>`;
        html += `<div class="pop-row"><span class="pop-label">Peers</span><span class="pop-val">${total}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Inbound</span><span class="pop-val">${inbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Outbound</span><span class="pop-val">${outbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Avg Ping</span><span class="pop-val">${avgPing}${avgPing !== '—' ? 'ms' : ''}</span></div>`;

        if (net === 'all') {
            // Show per-network breakdown
            for (const nk of Object.keys(NET_COLORS)) {
                if (counts[nk] > 0) {
                    html += `<div class="pop-row"><span class="pop-label">${NET_DISPLAY[nk]}</span><span class="pop-val">${counts[nk]}</span></div>`;
                }
            }
        }

        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // SYSTEM INFO — CPU/RAM from /api/stats (data stored for modal)
    // ═══════════════════════════════════════════════════════════

    async function fetchSystemStats() {
        try {
            const resp = await fetch('/api/stats');
            if (!resp.ok) return;
            const data = await resp.json();
            renderSystemInfoCard(data.system_stats || {});
        } catch (err) {
            console.error('[vNext] Failed to fetch system stats:', err);
        }
    }

    /** Store latest system stats for modal use */
    let lastSystemStats = null;

    function renderSystemInfoCard(stats) {
        // Store the stats for modal use
        lastSystemStats = stats;

        // Update right overlay CPU/RAM display
        const cpuEl = document.getElementById('ro-cpu');
        const ramEl = document.getElementById('ro-ram');
        if (cpuEl && stats.cpu_pct != null) {
            const cpuPct = Math.round(stats.cpu_pct);
            cpuEl.textContent = cpuPct + '%';
            pulseOnChange('ro-cpu', cpuPct, 'white');
        }
        if (ramEl && stats.mem_pct != null) {
            const memPct = Math.round(stats.mem_pct);
            const memUsed = stats.mem_used_mb;
            const memTotal = stats.mem_total_mb;
            if (memUsed && memTotal) {
                ramEl.textContent = `${memPct}% (${memUsed}/${memTotal}MB)`;
            } else {
                ramEl.textContent = memPct + '%';
            }
            pulseOnChange('ro-ram', memPct, 'white');
        }

        // Update right overlay MBCore DB entry count
        const geodbCountEl = document.getElementById('ro-geodb-count');
        if (geodbCountEl && lastNodeInfo && lastNodeInfo.geo_db_stats && lastNodeInfo.geo_db_stats.entries != null) {
            geodbCountEl.textContent = lastNodeInfo.geo_db_stats.entries.toLocaleString();
        }
    }

    /** Open combined System Info modal — system stats + GeoDB + traffic + recent changes */
    function openSystemInfoModal() {
        const existing = document.getElementById('system-info-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'system-info-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:520px"><div class="modal-header"><span class="modal-title">System Info</span><button class="modal-close" id="system-info-close">&times;</button></div><div class="modal-body" id="system-info-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        document.getElementById('system-info-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const body = document.getElementById('system-info-body');
        let html = '';

        // ── Section 1: System Stats ──
        html += '<div class="modal-section-title">System</div>';
        const stats = lastSystemStats || {};
        const cpuPct = stats.cpu_pct != null ? Math.round(stats.cpu_pct) : null;
        const memPct = stats.mem_pct != null ? Math.round(stats.mem_pct) : null;
        const memUsed = stats.mem_used_mb;
        const memTotal = stats.mem_total_mb;

        html += '<div class="info-row"><span class="info-label">CPU</span>';
        if (cpuPct != null) {
            html += `<span class="info-val info-bar-wrap"><span class="info-bar" style="width:${cpuPct}%"></span><span class="info-bar-text">${cpuPct}%</span></span>`;
        } else {
            html += '<span class="info-val">\u2014</span>';
        }
        html += '</div>';

        html += '<div class="info-row"><span class="info-label">RAM</span>';
        if (memPct != null) {
            const memStr = (memUsed && memTotal) ? `${memPct}% (${memUsed}/${memTotal} MB)` : `${memPct}%`;
            html += `<span class="info-val info-bar-wrap"><span class="info-bar" style="width:${memPct}%"></span><span class="info-bar-text">${memStr}</span></span>`;
        } else {
            html += '<span class="info-val">\u2014</span>';
        }
        html += '</div>';

        // Network traffic
        if (lastNetTraffic) {
            const rx = lastNetTraffic.rx_bps || 0;
            const tx = lastNetTraffic.tx_bps || 0;
            const maxBps = Math.max(rx, tx, 1);
            const rxPct = Math.min(100, (rx / maxBps) * 100);
            const txPct = Math.min(100, (tx / maxBps) * 100);
            html += `<div class="info-row"><span class="info-label">NET \u2193</span><span class="info-val net-traffic-bar-wrap"><span class="net-traffic-bar-bg"><span class="net-traffic-bar traffic-in" style="width:${rxPct}%"></span></span><span class="net-traffic-rate">${formatBps(rx)}</span></span></div>`;
            html += `<div class="info-row"><span class="info-label">NET \u2191</span><span class="info-val net-traffic-bar-wrap"><span class="net-traffic-bar-bg"><span class="net-traffic-bar traffic-out" style="width:${txPct}%"></span></span><span class="net-traffic-rate">${formatBps(tx)}</span></span></div>`;
        }

        // ── Section 2: MBCore DB ──
        html += '<div class="modal-section-title">MBCore DB</div>';
        if (lastNodeInfo && lastNodeInfo.geo_db_stats) {
            const geoStats = lastNodeInfo.geo_db_stats;
            const statusText = geoStats.status || 'unknown';
            const statusCls = statusText === 'ok' ? 'ok' : (statusText === 'disabled' ? 'disabled' : 'error');
            html += `<div class="modal-row"><span class="modal-label">Status</span><span class="geodb-status-badge ${statusCls}">${statusText.toUpperCase()}</span></div>`;
            if (geoStats.entries != null) html += `<div class="modal-row"><span class="modal-label">Entries</span><span class="modal-val">${geoStats.entries.toLocaleString()}</span></div>`;
            if (geoStats.size_bytes != null) html += `<div class="modal-row"><span class="modal-label">Size</span><span class="modal-val">${(geoStats.size_bytes / 1e6).toFixed(1)} MB</span></div>`;
            if (geoStats.oldest_age_days != null) html += `<div class="modal-row"><span class="modal-label">Oldest Entry</span><span class="modal-val">${geoStats.oldest_age_days} days</span></div>`;
            if (geoStats.path) html += `<div class="modal-row"><span class="modal-label">Path</span><span class="modal-val" style="font-size:9px;max-width:200px" title="${geoStats.path}">${geoStats.path}</span></div>`;
            const alCls = geoStats.auto_lookup ? 'modal-val-ok' : 'modal-val-warn';
            html += `<div class="modal-row"><span class="modal-label">Auto-lookup</span><span class="modal-val ${alCls}">${geoStats.auto_lookup ? 'On' : 'Off'}</span></div>`;
            const auCls = geoStats.auto_update ? 'modal-val-ok' : 'modal-val-warn';
            html += `<div class="modal-row"><span class="modal-label">Auto-update</span><span class="modal-val ${auCls}">${geoStats.auto_update ? 'On' : 'Off'}</span></div>`;
            html += '<button class="geodb-update-btn" id="si-geodb-update-btn">Update Database</button>';
            html += '<div class="geodb-result" id="si-geodb-result"></div>';
        } else {
            html += '<div style="color:var(--text-muted);padding:4px 0">No GeoDB data available</div>';
        }

        // ── Section 3: Recent Changes ──
        html += '<div class="modal-section-title">Recent Changes</div>';
        html += '<div id="si-changes-section" style="color:var(--text-muted);padding:4px 0">Loading...</div>';

        body.innerHTML = html;

        // Bind GeoDB update button
        const geodbBtn = document.getElementById('si-geodb-update-btn');
        if (geodbBtn) {
            geodbBtn.addEventListener('click', async () => {
                const resultEl = document.getElementById('si-geodb-result');
                resultEl.textContent = 'Updating...';
                resultEl.style.color = 'var(--text-secondary)';
                try {
                    const resp = await fetch('/api/geodb/update', { method: 'POST' });
                    const data = await resp.json();
                    resultEl.textContent = data.message || (data.success ? 'Done' : 'Failed');
                    resultEl.style.color = data.success ? 'var(--ok)' : 'var(--err)';
                } catch (err) {
                    resultEl.textContent = 'Error: ' + err.message;
                    resultEl.style.color = 'var(--err)';
                }
            });
        }

        // Fetch recent changes
        fetch('/api/changes').then(r => r.json()).then(changes => {
            const section = document.getElementById('si-changes-section');
            if (!section) return;
            if (!changes || changes.length === 0) {
                section.innerHTML = '<div class="changes-empty">No recent changes</div>';
                return;
            }
            const recent = changes.slice(-5).reverse();
            let chtml = '';
            for (const c of recent) {
                const isConnect = c.type === 'connected';
                const dotClass = isConnect ? 'connected' : 'disconnected';
                const ip = c.peer ? (c.peer.ip || '') : '';
                const port = c.peer ? (c.peer.port || '') : '';
                const net = c.peer ? (c.peer.network || 'ipv4') : 'ipv4';
                const label = ip ? `${ip}:${port}` : '\u2014';
                const d = new Date(c.time * 1000);
                const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                chtml += `<div class="change-entry" data-ip="${ip}" data-connected="${isConnect}" data-net="${net}"><span class="change-dot ${dotClass}"></span><span class="change-ip" title="${label}">${label}</span><span class="change-time">${t}</span></div>`;
            }
            section.innerHTML = chtml;
        }).catch(err => {
            const section = document.getElementById('si-changes-section');
            if (section) section.innerHTML = `<div style="color:var(--err)">Error: ${err.message}</div>`;
        });
    }

    // ═══════════════════════════════════════════════════════════
    // RECENT CHANGES FEED — from /api/changes
    // ═══════════════════════════════════════════════════════════

    async function fetchChanges() {
        try {
            const resp = await fetch('/api/changes');
            if (!resp.ok) return;
            const changes = await resp.json();
            renderChangesCard(changes);
        } catch (err) {
            console.error('[vNext] Failed to fetch changes:', err);
        }
    }

    // Changes are now rendered inside the System Info modal
    // renderChangesCard just stores the data for on-demand rendering
    let lastChanges = null;
    function renderChangesCard(changes) {
        lastChanges = changes;
    }

    // ═══════════════════════════════════════════════════════════
    // NETWORK TRAFFIC — from /api/netspeed
    // ═══════════════════════════════════════════════════════════

    let lastNetTraffic = null;

    async function fetchNetSpeed() {
        try {
            const resp = await fetch('/api/netspeed');
            if (!resp.ok) return;
            lastNetTraffic = await resp.json();
            updateHandleTrafficBars();
        } catch (err) {
            console.error('[vNext] Failed to fetch netspeed:', err);
        }
    }

    // History arrays for adaptive max (from original dashboard)
    const netHistoryIn = [];
    const netHistoryOut = [];
    const NET_HISTORY_SIZE = 30;

    function getAdaptiveMax(history) {
        if (history.length < 3) return 50 * 1024;
        const sorted = [...history].sort((a, b) => a - b);
        const p90Index = Math.floor(sorted.length * 0.9);
        const p90 = sorted[p90Index] || sorted[sorted.length - 1];
        return Math.max(p90 * 1.2, 10 * 1024);
    }

    /** Update the traffic bars in the right overlay */
    function updateHandleTrafficBars() {
        if (!lastNetTraffic) return;
        const rx = lastNetTraffic.rx_bps || 0;
        const tx = lastNetTraffic.tx_bps || 0;

        // Push to history for adaptive scaling (like original dashboard)
        netHistoryIn.push(rx);
        netHistoryOut.push(tx);
        if (netHistoryIn.length > NET_HISTORY_SIZE) netHistoryIn.shift();
        if (netHistoryOut.length > NET_HISTORY_SIZE) netHistoryOut.shift();

        const maxIn = getAdaptiveMax(netHistoryIn);
        const maxOut = getAdaptiveMax(netHistoryOut);

        const rxPct = Math.min(100, (rx / maxIn) * 100);
        const txPct = Math.min(100, (tx / maxOut) * 100);

        const barIn = document.getElementById('ro-bar-in');
        const barOut = document.getElementById('ro-bar-out');
        const rateIn = document.getElementById('ro-rate-in');
        const rateOut = document.getElementById('ro-rate-out');

        if (barIn) barIn.style.width = rxPct + '%';
        if (barOut) barOut.style.width = txPct + '%';
        if (rateIn) rateIn.textContent = formatBps(rx);
        if (rateOut) rateOut.textContent = formatBps(tx);
    }

    /** Format bytes/sec to human-readable string */
    function formatBps(bps) {
        if (bps < 1024) return `${Math.round(bps)} B/s`;
        if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
        return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    // ═══════════════════════════════════════════════════════════
    // INIT — Start everything
    // ═══════════════════════════════════════════════════════════

    function init() {
        // Setup canvas size and DPI scaling
        resize();
        window.addEventListener('resize', resize);

        // Load all Natural Earth geometry + label layers (async, each renders once loaded)
        loadWorldGeometry();
        loadLakeGeometry();
        loadBorderGeometry();
        loadStateGeometry();
        loadCountryLabels();
        loadStateLabels();
        loadCityData();

        // Fetch real peer data immediately, then poll every 10s
        lastPeerFetchTime = Date.now();
        fetchPeers();
        setInterval(fetchPeers, CFG.pollInterval);
        startCountdownTimer();

        // Fetch node info (block height, BTC price, etc) immediately, then poll
        fetchInfo();
        btcPriceTimer = setInterval(fetchInfo, CFG.infoPollInterval);

        // Fetch system stats (CPU/RAM) immediately, then poll every 10s
        fetchSystemStats();
        setInterval(fetchSystemStats, CFG.pollInterval);

        // Fetch recent changes immediately, then poll every 10s
        fetchChanges();
        setInterval(fetchChanges, CFG.pollInterval);

        // Fetch network traffic speed immediately, then poll every 5s
        fetchNetSpeed();
        setInterval(fetchNetSpeed, 5000);

        // Start the render loop (grid + nodes render immediately,
        // landmasses + lakes appear once JSON assets finish loading)
        requestAnimationFrame(frame);
    }

    init();

})();
