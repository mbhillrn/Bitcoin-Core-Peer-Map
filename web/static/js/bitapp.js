/* ============================================================
   MBCore vNext — Canvas World Map with Animated Nodes
   Phase 1: Fake data, visual proof-of-concept
   ============================================================ */

(function () {
    'use strict';

    // ── Configuration ──────────────────────────────────────────
    const CFG = {
        nodeCount: 80,
        nodeRadius: 3,
        glowRadius: 14,
        pulseSpeed: 0.0018,        // radians per ms
        trailLength: 0.6,          // seconds of connection trail fade
        minZoom: 0.5,
        maxZoom: 8,
        zoomStep: 1.15,
        panSmooth: 0.12,
        gridSpacing: 30,           // degrees
        coastlineWidth: 1.0,
        fps: 60,
    };

    // Network colours (match CSS)
    const NET_COLORS = {
        ipv4:  { r: 227, g: 179, b: 65  },
        ipv6:  { r: 240, g: 113, b: 120 },
        tor:   { r: 74,  g: 158, b: 255 },
        i2p:   { r: 139, g: 92,  b: 246 },
        cjdns: { r: 210, g: 168, b: 255 },
    };
    const NET_NAMES = Object.keys(NET_COLORS);

    // ── State ──────────────────────────────────────────────────
    const canvas = document.getElementById('worldmap');
    const ctx = canvas.getContext('2d');
    let W, H;

    // View transform (world coords: x = lon -180..180, y = lat -90..90)
    let view = { x: 0, y: 0, zoom: 1 };
    let targetView = { x: 0, y: 0, zoom: 1 };

    // Interaction state
    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let dragViewStart = { x: 0, y: 0 };

    // Fake nodes
    let nodes = [];

    // World geometry (simplified continent outlines - GeoJSON-like lon/lat arrays)
    let worldPolygons = [];
    let worldReady = false;

    // Clock
    const clockEl = document.getElementById('clock');

    // ── Helpers ─────────────────────────────────────────────────

    /** Mercator-like projection: lon/lat -> normalised 0..1 */
    function project(lon, lat) {
        const x = (lon + 180) / 360;
        const latRad = lat * Math.PI / 180;
        const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
        const y = 0.5 - mercN / (2 * Math.PI);
        return { x, y };
    }

    /** World coords (lon/lat) -> screen pixels */
    function worldToScreen(lon, lat) {
        const p = project(lon, lat);
        const sx = (p.x - 0.5) * W * view.zoom + W / 2 - view.x * view.zoom;
        const sy = (p.y - 0.5) * H * view.zoom + H / 2 - view.y * view.zoom;
        return { x: sx, y: sy };
    }

    /** Screen pixels -> world coords (lon/lat) */
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

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    // ── World Map Data ─────────────────────────────────────────
    // Simplified continent outlines (lon, lat pairs).
    // This is a low-res hand-traced approximation for visual effect.

    function buildWorldPolygons() {
        worldPolygons = [
            // North America
            [[-130,50],[-125,60],[-115,68],[-95,72],[-80,72],[-65,62],[-55,50],[-60,45],[-68,44],[-75,38],[-82,30],[-90,28],[-97,26],[-105,30],[-118,34],[-125,42],[-130,50]],
            // Central America
            [[-105,24],[-100,20],[-97,18],[-92,16],[-88,14],[-84,10],[-80,8],[-82,10],[-86,14],[-90,16],[-95,20],[-100,22],[-105,24]],
            // South America
            [[-80,10],[-75,12],[-63,10],[-52,4],[-42,0],[-35,-5],[-35,-12],[-38,-18],[-42,-22],[-48,-28],[-52,-33],[-58,-38],[-65,-45],[-68,-53],[-72,-48],[-75,-42],[-72,-35],[-68,-28],[-70,-18],[-75,-10],[-80,0],[-80,10]],
            // Europe
            [[-10,36],[0,38],[3,42],[5,44],[2,48],[-5,48],[-8,54],[-5,58],[5,62],[12,58],[18,55],[24,58],[30,60],[35,58],[42,55],[45,50],[40,45],[35,40],[28,36],[20,36],[12,38],[5,38],[0,36],[-10,36]],
            // Africa
            [[-15,12],[-17,15],[-12,25],[-5,35],[0,36],[10,37],[12,32],[20,32],[25,30],[32,32],[35,30],[42,12],[50,2],[42,-5],[40,-12],[35,-22],[30,-30],[22,-34],[18,-34],[15,-28],[12,-18],[8,-5],[5,5],[0,6],[-8,5],[-15,12]],
            // Asia
            [[28,36],[35,40],[42,48],[50,50],[55,55],[60,60],[65,68],[75,72],[90,72],[100,68],[115,65],[125,60],[130,55],[140,55],[145,50],[142,44],[135,38],[128,34],[122,30],[115,24],[108,18],[105,12],[100,5],[98,8],[95,15],[88,22],[80,28],[72,32],[60,38],[50,40],[42,45],[35,40],[28,36]],
            // India subcontinent
            [[68,24],[72,22],[78,16],[80,8],[82,12],[88,22],[90,26],[85,28],[80,30],[75,28],[68,24]],
            // Southeast Asian islands (rough)
            [[100,2],[105,0],[108,-2],[112,-5],[115,-8],[120,-8],[125,-5],[128,-2],[130,0],[128,2],[122,5],[118,3],[112,2],[108,3],[105,2],[100,2]],
            // Australia
            [[115,-15],[120,-14],[130,-12],[135,-14],[140,-16],[148,-20],[152,-25],[153,-28],[150,-33],[145,-38],[137,-35],[130,-32],[122,-33],[116,-32],[114,-28],[114,-22],[118,-20],[120,-18],[115,-15]],
            // New Zealand (simplified)
            [[166,-35],[172,-34],[178,-37],[177,-42],[174,-46],[170,-45],[168,-42],[166,-35]],
            // UK / Ireland
            [[-8,51],[-5,52],[-3,54],[-5,56],[-3,58],[0,58],[2,54],[2,52],[0,50],[-4,50],[-8,51]],
            // Japan (simplified)
            [[130,31],[132,34],[136,36],[140,38],[142,42],[144,44],[142,44],[140,42],[138,38],[136,36],[134,34],[130,31]],
            // Greenland
            [[-55,60],[-48,62],[-42,65],[-35,70],[-25,74],[-20,76],[-22,80],[-30,82],[-42,82],[-50,78],[-55,74],[-58,68],[-55,60]],
            // Iceland
            [[-24,64],[-22,65],[-18,66],[-14,65],[-13,64],[-16,63],[-20,63],[-24,64]],
            // Madagascar
            [[44,-13],[48,-14],[50,-18],[49,-22],[47,-25],[44,-24],[43,-20],[44,-13]],
        ];
        worldReady = true;
    }

    // ── Fake Node Generation ───────────────────────────────────

    function generateFakeNodes(count) {
        const cities = [
            // Major cities with lat/lon
            { lat: 40.71, lon: -74.01, city: 'New York', country: 'US' },
            { lat: 51.51, lon: -0.13, city: 'London', country: 'UK' },
            { lat: 35.68, lon: 139.69, city: 'Tokyo', country: 'JP' },
            { lat: 48.86, lon: 2.35, city: 'Paris', country: 'FR' },
            { lat: -33.87, lon: 151.21, city: 'Sydney', country: 'AU' },
            { lat: 55.76, lon: 37.62, city: 'Moscow', country: 'RU' },
            { lat: -23.55, lon: -46.63, city: 'Sao Paulo', country: 'BR' },
            { lat: 37.77, lon: -122.42, city: 'San Francisco', country: 'US' },
            { lat: 52.52, lon: 13.41, city: 'Berlin', country: 'DE' },
            { lat: 1.35, lon: 103.82, city: 'Singapore', country: 'SG' },
            { lat: 43.65, lon: -79.38, city: 'Toronto', country: 'CA' },
            { lat: 19.43, lon: -99.13, city: 'Mexico City', country: 'MX' },
            { lat: 28.61, lon: 77.23, city: 'New Delhi', country: 'IN' },
            { lat: 39.91, lon: 116.39, city: 'Beijing', country: 'CN' },
            { lat: -34.60, lon: -58.38, city: 'Buenos Aires', country: 'AR' },
            { lat: 59.33, lon: 18.07, city: 'Stockholm', country: 'SE' },
            { lat: 50.45, lon: 30.52, city: 'Kyiv', country: 'UA' },
            { lat: 25.20, lon: 55.27, city: 'Dubai', country: 'AE' },
            { lat: 22.28, lon: 114.16, city: 'Hong Kong', country: 'HK' },
            { lat: 47.37, lon: 8.54, city: 'Zurich', country: 'CH' },
            { lat: 41.90, lon: 12.50, city: 'Rome', country: 'IT' },
            { lat: 34.05, lon: -118.24, city: 'Los Angeles', country: 'US' },
            { lat: 45.42, lon: -75.69, city: 'Ottawa', country: 'CA' },
            { lat: 35.69, lon: 51.39, city: 'Tehran', country: 'IR' },
            { lat: -1.29, lon: 36.82, city: 'Nairobi', country: 'KE' },
            { lat: 33.87, lon: 35.51, city: 'Beirut', country: 'LB' },
            { lat: -37.81, lon: 144.96, city: 'Melbourne', country: 'AU' },
            { lat: 60.17, lon: 24.94, city: 'Helsinki', country: 'FI' },
            { lat: 40.42, lon: -3.70, city: 'Madrid', country: 'ES' },
            { lat: 30.04, lon: 31.24, city: 'Cairo', country: 'EG' },
            { lat: 37.57, lon: 126.98, city: 'Seoul', country: 'KR' },
            { lat: 13.76, lon: 100.50, city: 'Bangkok', country: 'TH' },
            { lat: 52.37, lon: 4.90, city: 'Amsterdam', country: 'NL' },
            { lat: 38.72, lon: -9.14, city: 'Lisbon', country: 'PT' },
            { lat: 53.35, lon: -6.26, city: 'Dublin', country: 'IE' },
            { lat: 64.13, lon: -21.90, city: 'Reykjavik', country: 'IS' },
            { lat: -22.91, lon: -43.17, city: 'Rio de Janeiro', country: 'BR' },
            { lat: 49.28, lon: -123.12, city: 'Vancouver', country: 'CA' },
            { lat: 41.01, lon: 28.98, city: 'Istanbul', country: 'TR' },
            { lat: 14.60, lon: 120.98, city: 'Manila', country: 'PH' },
        ];

        const result = [];
        for (let i = 0; i < count; i++) {
            // Pick a city and jitter the position
            const base = cities[i % cities.length];
            const lat = base.lat + randomInRange(-3, 3);
            const lon = base.lon + randomInRange(-3, 3);
            const net = NET_NAMES[Math.floor(Math.random() * NET_NAMES.length)];
            result.push({
                id: i,
                lat,
                lon,
                net,
                city: base.city,
                country: base.country,
                color: NET_COLORS[net],
                // animation state
                phase: Math.random() * Math.PI * 2,
                spawnTime: Date.now() + Math.random() * 3000,  // stagger spawn
                alive: true,
                ping: Math.floor(randomInRange(8, 320)),
            });
        }
        return result;
    }

    // ── Resize ─────────────────────────────────────────────────

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

    // ── Drawing ────────────────────────────────────────────────

    function drawGrid() {
        ctx.strokeStyle = 'var(--map-grid)';
        // Fallback since canvas doesn't support CSS vars in strings
        ctx.strokeStyle = 'rgba(88,166,255,0.04)';
        ctx.lineWidth = 0.5;

        // Longitude lines
        for (let lon = -180; lon <= 180; lon += CFG.gridSpacing) {
            ctx.beginPath();
            for (let lat = -85; lat <= 85; lat += 2) {
                const s = worldToScreen(lon, lat);
                if (lat === -85) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();
        }

        // Latitude lines
        for (let lat = -60; lat <= 80; lat += CFG.gridSpacing) {
            ctx.beginPath();
            for (let lon = -180; lon <= 180; lon += 2) {
                const s = worldToScreen(lon, lat);
                if (lon === -180) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();
        }
    }

    function drawLandmasses() {
        if (!worldReady) return;

        ctx.fillStyle = '#151d28';
        ctx.strokeStyle = '#253040';
        ctx.lineWidth = CFG.coastlineWidth;

        for (const poly of worldPolygons) {
            ctx.beginPath();
            for (let i = 0; i < poly.length; i++) {
                const s = worldToScreen(poly[i][0], poly[i][1]);
                if (i === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    function drawNode(node, now) {
        if (now < node.spawnTime) return;

        const s = worldToScreen(node.lon, node.lat);
        const c = node.color;

        // Pulsing factor
        const elapsed = now - node.spawnTime;
        const pulse = 0.6 + 0.4 * Math.sin(node.phase + elapsed * CFG.pulseSpeed);

        // Spawn animation (first 600ms)
        let scale = 1;
        const spawnAge = now - node.spawnTime;
        if (spawnAge < 600) {
            const t = spawnAge / 600;
            scale = t < 0.6 ? (t / 0.6) * 1.4 : 1.4 - 0.4 * ((t - 0.6) / 0.4);
        }

        const r = CFG.nodeRadius * scale;
        const gr = CFG.glowRadius * scale * pulse;

        // Outer glow
        const grad = ctx.createRadialGradient(s.x, s.y, r, s.x, s.y, gr);
        grad.addColorStop(0, rgba(c, 0.5 * pulse));
        grad.addColorStop(0.5, rgba(c, 0.15 * pulse));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, gr, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.fillStyle = rgba(c, 0.9);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright centre
        ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.6 * pulse);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawConnectionLines(now) {
        // Draw subtle lines from each node to 1-2 nearby nodes
        ctx.lineWidth = 0.5;
        for (let i = 0; i < nodes.length; i++) {
            if (now < nodes[i].spawnTime) continue;
            // Connect to the next node in array (wrapping) for a "mesh" feel
            const j = (i + 1) % nodes.length;
            if (now < nodes[j].spawnTime) continue;

            const a = worldToScreen(nodes[i].lon, nodes[i].lat);
            const b = worldToScreen(nodes[j].lon, nodes[j].lat);

            // Only draw if on-screen and not too far apart on screen
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 250 || dist < 20) continue;

            const alpha = 0.08 * (1 - dist / 250);
            ctx.strokeStyle = rgba(nodes[i].color, alpha);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
    }

    function updateHUD() {
        const now = Date.now();
        let visible = 0;
        const netCounts = { ipv4: 0, ipv6: 0, tor: 0, i2p: 0, cjdns: 0 };
        for (const n of nodes) {
            if (now >= n.spawnTime) {
                visible++;
                netCounts[n.net]++;
            }
        }

        document.getElementById('hud-peers').textContent = visible;

        // Fake block height that slowly increments
        const fakeBlock = 880000 + Math.floor((now % 6000000) / 6000);
        document.getElementById('hud-block').textContent = fakeBlock.toLocaleString();

        // Update network badges with counts
        for (const net of NET_NAMES) {
            const badge = document.querySelector(`.net-${net}`);
            if (badge) {
                badge.textContent = `${net.toUpperCase()} ${netCounts[net]}`;
            }
        }

        // Set online status once nodes start appearing
        const dot = document.getElementById('status-dot');
        const txt = document.getElementById('status-text');
        if (visible > 0) {
            dot.classList.add('online');
            txt.textContent = 'Connected';
        }
    }

    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        clockEl.textContent = `${h}:${m}:${s}`;
    }

    // ── Tooltip ────────────────────────────────────────────────
    const tooltipEl = document.getElementById('node-tooltip');
    let hoveredNode = null;

    function findNodeAtScreen(sx, sy) {
        const now = Date.now();
        const hitRadius = 12;
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (now < nodes[i].spawnTime) continue;
            const s = worldToScreen(nodes[i].lon, nodes[i].lat);
            const dx = s.x - sx;
            const dy = s.y - sy;
            if (dx * dx + dy * dy < hitRadius * hitRadius) {
                return nodes[i];
            }
        }
        return null;
    }

    function showTooltip(node, mx, my) {
        tooltipEl.innerHTML =
            `<div class="tt-label">NODE ${node.id}</div>` +
            `<div class="tt-value">${node.city}, ${node.country}</div>` +
            `<div style="color:${rgba(node.color, 0.9)};margin-top:2px;">${node.net.toUpperCase()}</div>` +
            `<div class="tt-label" style="margin-top:4px;">PING</div>` +
            `<div class="tt-value">${node.ping}ms</div>`;
        tooltipEl.classList.remove('hidden');
        // Position near cursor
        const tx = mx + 16;
        const ty = my - 10;
        tooltipEl.style.left = Math.min(tx, W - 180) + 'px';
        tooltipEl.style.top = Math.max(ty, 48) + 'px';
    }

    function hideTooltip() {
        tooltipEl.classList.add('hidden');
        hoveredNode = null;
    }

    // ── Main Loop ──────────────────────────────────────────────

    function frame() {
        const now = Date.now();

        // Smooth view interpolation
        view.x = lerp(view.x, targetView.x, CFG.panSmooth);
        view.y = lerp(view.y, targetView.y, CFG.panSmooth);
        view.zoom = lerp(view.zoom, targetView.zoom, CFG.panSmooth);

        // Clear
        ctx.fillStyle = '#06080c';
        ctx.fillRect(0, 0, W, H);

        // Draw layers
        drawGrid();
        drawLandmasses();
        drawConnectionLines(now);

        // Draw nodes (sorted so brighter ones on top)
        for (const node of nodes) {
            drawNode(node, now);
        }

        // HUD
        updateHUD();
        updateClock();

        requestAnimationFrame(frame);
    }

    // ── Interaction ────────────────────────────────────────────

    // Pan
    canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
        dragViewStart.x = targetView.x;
        dragViewStart.y = targetView.y;
    });

    window.addEventListener('mousemove', (e) => {
        if (dragging) {
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            targetView.x = dragViewStart.x - dx;
            targetView.y = dragViewStart.y - dy;
            hideTooltip();
        } else {
            // Tooltip on hover
            const node = findNodeAtScreen(e.clientX, e.clientY);
            if (node) {
                showTooltip(node, e.clientX, e.clientY);
                hoveredNode = node;
                canvas.style.cursor = 'pointer';
            } else if (hoveredNode) {
                hideTooltip();
                canvas.style.cursor = 'grab';
            }
        }
    });

    window.addEventListener('mouseup', () => {
        dragging = false;
    });

    // Zoom (wheel)
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const factor = dir > 0 ? CFG.zoomStep : 1 / CFG.zoomStep;
        const newZoom = clamp(targetView.zoom * factor, CFG.minZoom, CFG.maxZoom);

        // Zoom toward cursor
        const mx = e.clientX;
        const my = e.clientY;
        const worldBefore = screenToWorld(mx, my);

        targetView.zoom = newZoom;

        // Adjust pan so the point under cursor stays put
        // We need to recalculate after zoom change
        const pBefore = project(worldBefore.lon, worldBefore.lat);
        const sxAfter = (pBefore.x - 0.5) * W * targetView.zoom + W / 2 - targetView.x * targetView.zoom;
        const syAfter = (pBefore.y - 0.5) * H * targetView.zoom + H / 2 - targetView.y * targetView.zoom;
        targetView.x += (sxAfter - mx) / targetView.zoom;
        targetView.y += (syAfter - my) / targetView.zoom;
    }, { passive: false });

    // Touch support (basic pan)
    let touchStart = null;
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            dragViewStart.x = targetView.x;
            dragViewStart.y = targetView.y;
        }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
        if (touchStart && e.touches.length === 1) {
            const dx = e.touches[0].clientX - touchStart.x;
            const dy = e.touches[0].clientY - touchStart.y;
            targetView.x = dragViewStart.x - dx;
            targetView.y = dragViewStart.y - dy;
        }
    }, { passive: true });
    canvas.addEventListener('touchend', () => { touchStart = null; }, { passive: true });

    // Zoom buttons
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

    // ── Init ───────────────────────────────────────────────────

    function init() {
        resize();
        window.addEventListener('resize', resize);

        buildWorldPolygons();
        nodes = generateFakeNodes(CFG.nodeCount);

        requestAnimationFrame(frame);
    }

    init();

})();
