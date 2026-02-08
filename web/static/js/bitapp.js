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
        pulseSpeedInbound: 0.0012,   // slower, calm breathing for inbound
        pulseSpeedOutbound: 0.0024,  // faster, sharper pulse for outbound
        pulseDepthInbound: 0.25,     // subtle amplitude for inbound
        pulseDepthOutbound: 0.45,    // more pronounced for outbound
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
    let hoveredNode = null;

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

            // Refresh the peer table panel
            renderPeerTable();

        } catch (err) {
            console.error('[vNext] Failed to fetch peers:', err);
            updateConnectionStatus(false);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DATA FETCHING — Node info from /api/info (block height)
    // ═══════════════════════════════════════════════════════════

    let lastBlockHeight = null;

    async function fetchInfo() {
        try {
            const resp = await fetch('/api/info?currency=USD');
            if (!resp.ok) return;
            const info = await resp.json();

            // Update block height HUD
            if (info.last_block && info.last_block.height) {
                lastBlockHeight = info.last_block.height;
            }
        } catch (err) {
            console.error('[vNext] Failed to fetch info:', err);
        }
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
        // Outer glow (radial gradient) — modulated by brightness
        const grad = ctx.createRadialGradient(sx, sy, r, sx, sy, gr);
        grad.addColorStop(0, rgba(c, 0.5 * pulse * opacity * brightness));
        grad.addColorStop(0.5, rgba(c, 0.15 * pulse * opacity * brightness));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, gr, 0, Math.PI * 2);
        ctx.fill();

        // Core dot — brightness affects base opacity
        ctx.fillStyle = rgba(c, (0.5 + 0.4 * brightness) * opacity);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright white centre highlight — scales with brightness
        ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.6 * pulse * opacity * brightness);
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

    function updateHUD() {
        // Count alive nodes by network type
        const netCounts = { ipv4: 0, ipv6: 0, onion: 0, i2p: 0, cjdns: 0 };
        let total = 0;
        for (const n of nodes) {
            if (!n.alive) continue;
            total++;
            if (netCounts.hasOwnProperty(n.net)) netCounts[n.net]++;
        }

        // Peer count
        document.getElementById('hud-peers').textContent = total;

        // Block height (from /api/info, not faked)
        const blockEl = document.getElementById('hud-block');
        if (lastBlockHeight !== null) {
            blockEl.textContent = lastBlockHeight.toLocaleString();
        } else {
            blockEl.textContent = '---';
        }

        // "All" badge with total count
        const allBadge = document.querySelector('.net-all');
        if (allBadge) {
            allBadge.textContent = `All ${total}`;
        }

        // Network badges with live counts
        for (const net of Object.keys(NET_COLORS)) {
            // Map "onion" -> "tor" for the CSS class
            const cssClass = net === 'onion' ? 'tor' : net;
            const badge = document.querySelector(`.net-${cssClass}`);
            if (badge) {
                const label = NET_DISPLAY[net] || net.toUpperCase();
                badge.textContent = `${label} ${netCounts[net]}`;
            }
        }
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

    /** Display comprehensive tooltip near cursor with peer details */
    function showTooltip(node, mx, my) {
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

        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');

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
        hoveredNode = null;
    }

    /** Highlight a table row by peer ID (map node hover → table row) */
    function highlightTableRow(peerId) {
        // Remove previous highlight
        const prev = tbodyEl.querySelector('.row-highlight');
        if (prev) prev.classList.remove('row-highlight');

        if (peerId === null) return;

        // Add highlight to matching row and scroll it into view
        const row = tbodyEl.querySelector(`tr[data-id="${peerId}"]`);
        if (row) {
            row.classList.add('row-highlight');
            // Scroll row into view if panel is open
            if (!panelEl.classList.contains('collapsed')) {
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
        { key: 'addr',            label: 'IP:Port',  get: p => p.addr || `${p.ip}:${p.port}`,             full: null,  vis: true,  w: 160 },
        { key: 'subver',          label: 'Software', get: p => p.subver || '—',                            full: null,  vis: true,  w: 120 },
        { key: 'services_abbrev', label: 'Services', get: p => p.services_abbrev || '—',                   full: null,  vis: true,  w: 70  },
        { key: 'city',            label: 'City',     get: p => p.city || '—',                              full: null,  vis: true,  w: 80  },
        { key: 'regionName',      label: 'Region',   get: p => p.regionName || '—',                        full: null,  vis: true,  w: 80  },
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
    const handleCountEl = document.getElementById('handle-count');
    const actionZoneEl = document.getElementById('peer-action-zone');

    // Panel toggle
    document.getElementById('peer-panel-handle').addEventListener('click', () => {
        panelEl.classList.toggle('collapsed');
    });

    /** Get sorted copy of lastPeers based on current sort state */
    function getSortedPeers() {
        const col = COLUMNS.find(c => c.key === sortKey);
        if (!col) return lastPeers;
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

    /** Build colgroup with column widths (only when auto-fit is OFF) */
    function renderColgroup() {
        const table = document.getElementById('peer-table');
        // Remove old colgroup if present
        const old = table.querySelector('colgroup');
        if (old) old.remove();

        if (autoFitColumns) {
            table.style.tableLayout = 'auto';
            return;
        }

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
            const arrow = isActive ? (sortAsc ? '&#9650;' : '&#9660;') : '&#9650;';
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

    function handleTheadClick(e) {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const key = th.dataset.sort;
        if (sortKey === key) {
            sortAsc = !sortAsc;
        } else {
            sortKey = key;
            sortAsc = true;
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
        const node = nodes.find(n => n.peerId === peerId && n.alive);
        if (node) {
            // Center and zoom map on this peer, placing it in the upper-middle
            // portion of the visible map area (accounting for HUD panels and peer panel)
            const p = project(node.lon, node.lat);
            if (targetView.zoom < 3) targetView.zoom = 3;

            // Calculate visible map area: topbar=40px, peer panel ~340px when open
            const topbarH = 40;
            const panelH = panelEl.classList.contains('collapsed') ? 32 : 340;
            const visibleTop = topbarH;
            const visibleBot = H - panelH;
            const visibleH = visibleBot - visibleTop;
            // Place peer at ~30% from top of visible area (upper-middle)
            const targetScreenY = visibleTop + visibleH * 0.30;
            // Offset from true center: how far above center the target point is
            const offsetFromCenter = (H / 2 - targetScreenY) / targetView.zoom;

            targetView.x = (p.x - 0.5) * W;
            targetView.y = (p.y - 0.5) * H - offsetFromCenter;

            // Open the inspection tooltip at the node's screen position (once view settles)
            highlightedPeerId = peerId;
            setTimeout(() => {
                const offsets = getWrapOffsets();
                for (const off of offsets) {
                    const s = worldToScreen(node.lon + off, node.lat);
                    if (s.x > -50 && s.x < W + 50 && s.y > -50 && s.y < H + 50) {
                        showTooltip(node, s.x, s.y);
                        hoveredNode = node;
                        break;
                    }
                }
            }, 400);

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

    /** Show a temporary result message in the toolbar */
    function showActionResult(msg, success) {
        const el = document.createElement('span');
        el.className = `action-result ${success ? 'ok' : 'err'}`;
        el.textContent = msg;
        actionZoneEl.innerHTML = '';
        actionZoneEl.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
    }

    // ═══════════════════════════════════════════════════════════
    // NODE HIGHLIGHT RING — Draw highlight for map↔table interaction
    // ═══════════════════════════════════════════════════════════

    /** Draw a highlight ring around a node when it's highlighted via table hover */
    function drawHighlightRing(node, now, wrapOffsets) {
        if (!node.alive) return;
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.005);
        const r = CFG.nodeRadius * 2.5;
        for (const off of wrapOffsets) {
            const s = worldToScreen(node.lon + off, node.lat);
            if (s.x < -r || s.x > W + r || s.y < -r || s.y > H + r) continue;
            ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, 0.5 * pulse);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
            ctx.stroke();
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
        if (highlightedPeerId !== null) {
            const hlNode = nodes.find(n => n.peerId === highlightedPeerId && n.alive);
            if (hlNode) drawHighlightRing(hlNode, now, wrapOffsets);
        }

        // Update HUD overlays
        updateHUD();
        updateClock();

        requestAnimationFrame(frame);
    }

    // ═══════════════════════════════════════════════════════════
    // INTERACTION — Pan, zoom, touch, hover
    // ═══════════════════════════════════════════════════════════

    // ── Mouse pan ──
    let dragZoom = 1;  // zoom level when drag started
    canvas.addEventListener('mousedown', (e) => {
        dragging = true;
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
            targetView.x = dragViewStart.x - dx / dragZoom;
            // At zoom 1, vertical panning is locked (clampView enforces it)
            if (dragZoom > 1.001) {
                targetView.y = dragViewStart.y - dy / dragZoom;
            }
            hideTooltip();
        } else {
            // Hover detection for tooltip + table highlight
            const node = findNodeAtScreen(e.clientX, e.clientY);
            if (node) {
                showTooltip(node, e.clientX, e.clientY);
                hoveredNode = node;
                highlightTableRow(node.peerId);
                canvas.style.cursor = 'pointer';
            } else if (hoveredNode) {
                hideTooltip();
                highlightTableRow(null);
                canvas.style.cursor = 'grab';
            }
        }
    });

    window.addEventListener('mouseup', () => {
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

    const netBadges = document.querySelectorAll('#hud-bottom-left .net-badge');
    const netPopover = document.getElementById('net-popover');
    const antNote = document.getElementById('antarctica-note');
    const antCloseBtn = document.getElementById('ant-close');

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

        // Show Antarctica annotation when any private network is exclusively shown
        const hasPrivate = enabledNets.has('onion') || enabledNets.has('i2p') || enabledNets.has('cjdns');
        const hasClearnet = enabledNets.has('ipv4') || enabledNets.has('ipv6');
        if (hasPrivate && !hasClearnet) {
            antNote.classList.remove('hidden');
        } else {
            antNote.classList.add('hidden');
        }
    }

    // Click to toggle network badges (multi-select)
    netBadges.forEach(badge => {
        badge.addEventListener('click', () => {
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

        // Hover to show network stats popover
        badge.addEventListener('mouseenter', () => {
            const net = badge.dataset.net;
            const stats = getNetworkStats(net);
            if (!stats) return;
            netPopover.innerHTML = stats;
            netPopover.classList.remove('hidden');
        });
        badge.addEventListener('mouseleave', () => {
            netPopover.classList.add('hidden');
        });
    });

    // Close Antarctica annotation
    if (antCloseBtn) {
        antCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
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
        fetchPeers();
        setInterval(fetchPeers, CFG.pollInterval);

        // Fetch node info (block height etc) immediately, then poll every 15s
        fetchInfo();
        setInterval(fetchInfo, CFG.infoPollInterval);

        // Start the render loop (grid + nodes render immediately,
        // landmasses + lakes appear once JSON assets finish loading)
        requestAnimationFrame(frame);
    }

    init();

})();
