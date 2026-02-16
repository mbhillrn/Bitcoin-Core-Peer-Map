/* ============================================================
   AS Diversity Analysis — JavaScript Module
   Isolated logic for the AS Diversity view.
   Delete this file to fully revert the feature.

   Integration points in bitapp.js are marked with [AS-DIVERSITY].
   This module exposes window.ASDiversity for the main app to call.
   ============================================================ */

window.ASDiversity = (function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const MAX_SEGMENTS = 8;      // Top N ASes in the donut, rest = "Others"
    const DONUT_SIZE = 260;      // SVG viewBox size
    const DONUT_RADIUS = 116;    // Outer radius of the donut ring
    const DONUT_WIDTH = 28;      // Width of the donut ring
    const INNER_RADIUS = DONUT_RADIUS - DONUT_WIDTH;

    // Curated colour palette — 9 colours (8 AS + Others), distinct and accessible
    const PALETTE = [
        '#58a6ff',   // blue
        '#3fb950',   // green
        '#e3b341',   // gold
        '#f07178',   // coral
        '#8b5cf6',   // purple
        '#d2a8ff',   // lavender
        '#79c0ff',   // light blue
        '#f0883e',   // orange
        '#484f58',   // dark gray (Others)
    ];

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    let isActive = true;           // Always active now (no toggle)
    let asGroups = [];             // Aggregated AS data (sorted by count desc)
    let donutSegments = [];        // Top N + Others for donut rendering
    let hoveredAs = null;          // AS number string currently hovered
    let selectedAs = null;         // AS number string currently selected (clicked)
    let diversityScore = 0;        // 0-10 score
    let totalPeers = 0;
    let hasRenderedOnce = false;   // Track if we've ever rendered data

    // DOM refs (cached on init)
    let containerEl = null;
    let donutWrapEl = null;
    let donutSvg = null;
    let donutCenter = null;
    let legendEl = null;
    let tooltipEl = null;
    let panelEl = null;
    let loadingEl = null;

    // Sub-filter state: when user clicks a sub-row (software, service, country, conn type, others provider)
    let subFilterPeerIds = null;   // Array of peer IDs for the active sub-filter, or null
    let subFilterLabel = null;     // Description of what's being sub-filtered
    let subFilterCategory = null;  // Category key ('software', 'conntype', 'country', 'services', 'provider')
    let subTooltipPinned = false;  // Whether the sub-tooltip is pinned (clicked vs hovered)

    // Integration hooks (set by bitapp.js)
    let _drawLinesForAs = null;    // fn(asNumber, peerIds, color) — draw lines on canvas
    let _clearAsLines = null;      // fn() — clear AS lines from canvas
    let _filterPeerTable = null;   // fn(peerIds | null) — filter peer table
    let _dimMapPeers = null;       // fn(peerIds | null) — dim non-matching peers
    let _getWorldToScreen = null;  // fn(lon, lat) => {x, y}

    // Service flag definitions (mirrored from bitapp.js for hover expansion)
    var SERVICE_FLAGS = {
        'NETWORK':          { abbr: 'N',  desc: 'Full chain history (NODE_NETWORK)' },
        'WITNESS':          { abbr: 'W',  desc: 'Segregated Witness support (NODE_WITNESS)' },
        'NETWORK_LIMITED':  { abbr: 'NL', desc: 'Limited chain history, last 288 blocks (NODE_NETWORK_LIMITED)' },
        'P2P_V2':           { abbr: 'P',  desc: 'BIP324 v2 encrypted transport (P2P_V2)' },
        'COMPACT_FILTERS':  { abbr: 'CF', desc: 'BIP157/158 compact block filters (NODE_COMPACT_FILTERS)' },
        'BLOOM':            { abbr: 'B',  desc: 'BIP37 Bloom filter support (NODE_BLOOM)' },
    };

    // Connection type short labels
    var CONN_TYPE_LABELS = {
        'outbound-full-relay': 'OUT/OFR',
        'block-relay-only': 'OUT/BRO',
        'manual': 'OUT/MAN',
        'addr-fetch': 'ADDR',
        'feeler': 'FEEL',
        'inbound': 'IN',
    };

    var CONN_TYPE_FULL = {
        'outbound-full-relay': 'Outbound Full Relay',
        'block-relay-only': 'Block Relay Only',
        'manual': 'Manual',
        'addr-fetch': 'Address Fetch',
        'feeler': 'Feeler',
        'inbound': 'Inbound',
    };

    // ═══════════════════════════════════════════════════════════
    // PARSING & AGGREGATION
    // ═══════════════════════════════════════════════════════════

    /** Extract AS number from the "AS12345 Org Name" string */
    function parseAsNumber(asField) {
        if (!asField) return null;
        var m = asField.match(/^(AS\d+)/);
        return m ? m[1] : null;
    }

    /** Extract org name from the "AS12345 Org Name" string */
    function parseAsOrg(asField) {
        if (!asField) return '';
        var m = asField.match(/^AS\d+\s+(.+)/);
        return m ? m[1].trim() : asField;
    }

    /** Format bytes to human-readable */
    function fmtBytes(b) {
        if (b == null || isNaN(b)) return '\u2014';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
        return (b / 1073741824).toFixed(2) + ' GB';
    }

    /** Format seconds to human-readable duration */
    function fmtDuration(secs) {
        if (!secs || secs <= 0) return '\u2014';
        var d = Math.floor(secs / 86400);
        var h = Math.floor((secs % 86400) / 3600);
        var m = Math.floor((secs % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm';
    }

    /** Get hosting label from peer flags */
    function getHostingLabel(peers) {
        var hostingCount = peers.filter(function (p) { return p.hosting; }).length;
        var ratio = hostingCount / peers.length;
        if (ratio >= 0.7) return 'Cloud/Hosting';
        if (ratio <= 0.3) return 'Residential';
        return 'Mixed';
    }

    /** Get concentration risk level for a percentage */
    function getRisk(pct) {
        if (pct >= 50) return { level: 'critical', label: 'Critical \u2014 Dominates Peers' };
        if (pct >= 30) return { level: 'high', label: 'High Concentration' };
        if (pct >= 15) return { level: 'moderate', label: 'Moderate Concentration' };
        return { level: 'low', label: '' };
    }

    /** Aggregate peer data into per-AS groups */
    function aggregatePeers(peers) {
        var map = {};
        var locatablePeers = 0;

        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var asNum = parseAsNumber(p.as);
            if (!asNum) continue;
            locatablePeers++;

            if (!map[asNum]) {
                map[asNum] = {
                    asNumber: asNum,
                    asName: parseAsOrg(p.as),
                    asShort: p.asname || '',
                    peers: [],
                };
            }
            map[asNum].peers.push(p);
        }

        totalPeers = locatablePeers;

        // Build full group objects
        var keys = Object.keys(map);
        var groups = [];
        for (var ki = 0; ki < keys.length; ki++) {
            var g = map[keys[ki]];
            var gPeers = g.peers;
            var count = gPeers.length;
            var pct = totalPeers > 0 ? (count / totalPeers) * 100 : 0;

            // Inbound / outbound
            var inbound = 0;
            for (var ii = 0; ii < gPeers.length; ii++) {
                if (gPeers[ii].direction === 'IN') inbound++;
            }
            var outbound = count - inbound;

            // Connection types
            var connTypes = {};
            for (var ci = 0; ci < gPeers.length; ci++) {
                var t = gPeers[ci].connection_type || 'unknown';
                connTypes[t] = (connTypes[t] || 0) + 1;
            }

            // Performance
            var pings = [];
            for (var pii = 0; pii < gPeers.length; pii++) {
                if (gPeers[pii].ping_ms > 0) pings.push(gPeers[pii].ping_ms);
            }
            var avgPing = pings.length > 0 ? pings.reduce(function (a, b) { return a + b; }, 0) / pings.length : 0;

            var nowSec = Math.floor(Date.now() / 1000);
            var durations = [];
            for (var di = 0; di < gPeers.length; di++) {
                if (gPeers[di].conntime > 0) {
                    var dur = nowSec - gPeers[di].conntime;
                    if (dur > 0) durations.push(dur);
                }
            }
            var avgDuration = durations.length > 0 ? durations.reduce(function (a, b) { return a + b; }, 0) / durations.length : 0;

            var totalSent = 0, totalRecv = 0;
            for (var bi = 0; bi < gPeers.length; bi++) {
                totalSent += (gPeers[bi].bytessent || 0);
                totalRecv += (gPeers[bi].bytesrecv || 0);
            }

            // Software versions (with peer references for hover/click)
            var verMap = {};
            for (var vi = 0; vi < gPeers.length; vi++) {
                var v = gPeers[vi].subver || 'Unknown';
                if (!verMap[v]) verMap[v] = { count: 0, peers: [] };
                verMap[v].count++;
                verMap[v].peers.push(gPeers[vi]);
            }
            var versions = [];
            var verKeys = Object.keys(verMap);
            for (var vk = 0; vk < verKeys.length; vk++) {
                versions.push({ subver: verKeys[vk], count: verMap[verKeys[vk]].count, peers: verMap[verKeys[vk]].peers });
            }
            versions.sort(function (a, b) { return b.count - a.count; });

            // Countries (with peer references for hover/click)
            var countryMap = {};
            for (var coi = 0; coi < gPeers.length; coi++) {
                if (!gPeers[coi].countryCode || gPeers[coi].countryCode === '') continue;
                var ckey = gPeers[coi].countryCode;
                if (!countryMap[ckey]) countryMap[ckey] = { code: ckey, name: gPeers[coi].country || ckey, count: 0, peers: [] };
                countryMap[ckey].count++;
                countryMap[ckey].peers.push(gPeers[coi]);
            }
            var countries = [];
            var coKeys = Object.keys(countryMap);
            for (var ck = 0; ck < coKeys.length; ck++) {
                countries.push(countryMap[coKeys[ck]]);
            }
            countries.sort(function (a, b) { return b.count - a.count; });

            // Service flag combos (with peer references for hover/click)
            var svcMap = {};
            for (var si = 0; si < gPeers.length; si++) {
                var s = gPeers[si].services_abbrev || '\u2014';
                if (!svcMap[s]) svcMap[s] = { count: 0, peers: [] };
                svcMap[s].count++;
                svcMap[s].peers.push(gPeers[si]);
            }
            var servicesCombos = [];
            var sKeys = Object.keys(svcMap);
            for (var sk = 0; sk < sKeys.length; sk++) {
                servicesCombos.push({ abbrev: sKeys[sk], count: svcMap[sKeys[sk]].count, peers: svcMap[sKeys[sk]].peers });
            }
            servicesCombos.sort(function (a, b) { return b.count - a.count; });

            // Connection types (with peer references for hover/click)
            var connTypeMap = {};
            for (var cti = 0; cti < gPeers.length; cti++) {
                var ct = gPeers[cti].connection_type || 'unknown';
                if (!connTypeMap[ct]) connTypeMap[ct] = { count: 0, peers: [] };
                connTypeMap[ct].count++;
                connTypeMap[ct].peers.push(gPeers[cti]);
            }
            var connTypesList = [];
            var ctKeys = Object.keys(connTypeMap);
            for (var ctk = 0; ctk < ctKeys.length; ctk++) {
                connTypesList.push({ type: ctKeys[ctk], count: connTypeMap[ctKeys[ctk]].count, peers: connTypeMap[ctKeys[ctk]].peers });
            }
            connTypesList.sort(function (a, b) { return b.count - a.count; });

            var risk = getRisk(pct);

            groups.push({
                asNumber: g.asNumber,
                asName: g.asName,
                asShort: g.asShort,
                peerCount: count,
                percentage: pct,
                inboundCount: inbound,
                outboundCount: outbound,
                connTypes: connTypes,
                connTypesList: connTypesList,
                avgPingMs: avgPing,
                avgDurationSecs: avgDuration,
                avgDurationFmt: fmtDuration(avgDuration),
                totalBytesSent: totalSent,
                totalBytesRecv: totalRecv,
                totalBytesSentFmt: fmtBytes(totalSent),
                totalBytesRecvFmt: fmtBytes(totalRecv),
                versions: versions,
                countries: countries,
                servicesCombos: servicesCombos,
                hostingLabel: getHostingLabel(gPeers),
                riskLevel: risk.level,
                riskLabel: risk.label,
                peers: gPeers,
                peerIds: gPeers.map(function (p) { return p.id; }),
                color: '#6e7681',  // assigned later from palette
            });
        }

        // Sort by peer count descending
        groups.sort(function (a, b) { return b.peerCount - a.peerCount; });
        return groups;
    }

    /** Calculate Herfindahl-Hirschman diversity score (0-10) */
    function calcDiversityScore(groups) {
        if (totalPeers === 0) return 0;
        var hhi = 0;
        for (var i = 0; i < groups.length; i++) {
            var share = groups[i].peerCount / totalPeers;
            hhi += share * share;
        }
        return Math.round((1 - hhi) * 100) / 10; // 0.0 to 10.0
    }

    /** Build donut segments: top N + Others bucket */
    function buildDonutSegments(groups) {
        var top = groups.slice(0, MAX_SEGMENTS);
        var rest = groups.slice(MAX_SEGMENTS);

        // Assign colors
        for (var i = 0; i < top.length; i++) {
            top[i].color = PALETTE[i % PALETTE.length];
        }

        var segments = top.slice();

        if (rest.length > 0) {
            var othersCount = 0;
            var othersPeerIds = [];
            for (var ri = 0; ri < rest.length; ri++) {
                othersCount += rest[ri].peerCount;
                for (var rpi = 0; rpi < rest[ri].peerIds.length; rpi++) {
                    othersPeerIds.push(rest[ri].peerIds[rpi]);
                }
            }
            var othersPct = totalPeers > 0 ? (othersCount / totalPeers) * 100 : 0;
            segments.push({
                asNumber: 'Others',
                asName: rest.length + ' other providers',
                asShort: '',
                peerCount: othersCount,
                percentage: othersPct,
                riskLevel: 'low',
                riskLabel: '',
                color: PALETTE[PALETTE.length - 1],
                peerIds: othersPeerIds,
                isOthers: true,
                _othersGroups: rest,
            });
        }

        return segments;
    }

    // ═══════════════════════════════════════════════════════════
    // SVG DONUT RENDERING
    // ═══════════════════════════════════════════════════════════

    /** Create an SVG arc path for a donut segment */
    function describeArc(cx, cy, outerR, innerR, startAngle, endAngle) {
        var sweep = endAngle - startAngle;
        var actualEnd = sweep >= 2 * Math.PI ? startAngle + 2 * Math.PI - 0.001 : endAngle;
        var largeArc = sweep > Math.PI ? 1 : 0;

        var ox1 = cx + outerR * Math.cos(startAngle);
        var oy1 = cy + outerR * Math.sin(startAngle);
        var ox2 = cx + outerR * Math.cos(actualEnd);
        var oy2 = cy + outerR * Math.sin(actualEnd);
        var ix1 = cx + innerR * Math.cos(actualEnd);
        var iy1 = cy + innerR * Math.sin(actualEnd);
        var ix2 = cx + innerR * Math.cos(startAngle);
        var iy2 = cy + innerR * Math.sin(startAngle);

        return [
            'M ' + ox1 + ' ' + oy1,
            'A ' + outerR + ' ' + outerR + ' 0 ' + largeArc + ' 1 ' + ox2 + ' ' + oy2,
            'L ' + ix1 + ' ' + iy1,
            'A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 0 ' + ix2 + ' ' + iy2,
            'Z',
        ].join(' ');
    }

    /** Render the donut SVG */
    function renderDonut() {
        if (!donutSvg) return;

        var cx = DONUT_SIZE / 2;
        var cy = DONUT_SIZE / 2;
        var gap = 0.03; // gap between segments in radians
        var html = '';

        // SVG defs for 3D-style effects
        html += '<defs>';
        // Drop shadow for depth
        html += '<filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">';
        html += '<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity="0.55"/>';
        html += '</filter>';
        // Inner shadow for 3D ring illusion
        html += '<filter id="donut-inner-shadow" x="-10%" y="-10%" width="120%" height="120%">';
        html += '<feGaussianBlur in="SourceAlpha" stdDeviation="3" result="shadow"/>';
        html += '<feOffset dx="0" dy="2" result="shadow-offset"/>';
        html += '<feComposite in="SourceGraphic" in2="shadow-offset" operator="over"/>';
        html += '</filter>';
        // Highlight gradient for 3D ring top-light
        html += '<linearGradient id="donut-highlight" x1="0" y1="0" x2="0" y2="1">';
        html += '<stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>';
        html += '<stop offset="50%" stop-color="rgba(255,255,255,0)"/>';
        html += '<stop offset="100%" stop-color="rgba(0,0,0,0.12)"/>';
        html += '</linearGradient>';
        html += '</defs>';

        // Background track ring (subtle)
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="rgba(88,166,255,0.04)" stroke-width="' + DONUT_WIDTH + '" />';

        // Outer decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS + 3) + '" fill="none" stroke="rgba(88,166,255,0.08)" stroke-width="1" />';

        // Inner decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (INNER_RADIUS - 3) + '" fill="none" stroke="rgba(88,166,255,0.06)" stroke-width="0.5" />';

        if (donutSegments.length === 0) {
            // Empty state — pulsing gray ring
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="#2d333b" stroke-width="' + DONUT_WIDTH + '" opacity="0.5" />';
        } else if (donutSegments.length === 1) {
            var seg = donutSegments[0];
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="' + seg.color + '" stroke-width="' + DONUT_WIDTH + '" class="as-donut-segment" data-as="' + seg.asNumber + '" filter="url(#donut-shadow)" />';
        } else {
            var totalGap = gap * donutSegments.length;
            var available = 2 * Math.PI - totalGap;
            var angle = -Math.PI / 2; // start at top

            // Group for shadow on all segments
            html += '<g filter="url(#donut-shadow)">';
            for (var si = 0; si < donutSegments.length; si++) {
                var seg = donutSegments[si];
                var sweep = (seg.peerCount / totalPeers) * available;
                if (sweep <= 0) continue;

                var startA = angle + gap / 2;
                var endA = angle + sweep + gap / 2;
                var d = describeArc(cx, cy, DONUT_RADIUS, INNER_RADIUS, startA, endA);

                var cls = ['as-donut-segment'];
                if (selectedAs && selectedAs !== seg.asNumber) cls.push('dimmed');
                if (selectedAs === seg.asNumber) cls.push('selected');

                html += '<path d="' + d + '" fill="' + seg.color + '" class="' + cls.join(' ') + '" data-as="' + seg.asNumber + '" />';
                angle += sweep + gap;
            }
            html += '</g>';

            // 3D highlight overlay — a semi-transparent ring on top for depth illusion
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="url(#donut-highlight)" stroke-width="' + DONUT_WIDTH + '" pointer-events="none" />';
        }

        donutSvg.innerHTML = html;

        // Hide loading once we have data
        if (donutSegments.length > 0 && loadingEl) {
            loadingEl.style.display = 'none';
            hasRenderedOnce = true;
        }

        // Attach segment event listeners
        var segEls = donutSvg.querySelectorAll('.as-donut-segment');
        for (var i = 0; i < segEls.length; i++) {
            segEls[i].addEventListener('mouseenter', onSegmentHover);
            segEls[i].addEventListener('mouseleave', onSegmentLeave);
            segEls[i].addEventListener('click', onSegmentClick);
        }
    }

    /** Get quality rating for a diversity score */
    function getQuality(score) {
        if (score >= 8) return { word: 'Excellent', cls: 'q-excellent' };
        if (score >= 6) return { word: 'Good', cls: 'q-good' };
        if (score >= 4) return { word: 'Moderate', cls: 'q-moderate' };
        if (score >= 2) return { word: 'Poor', cls: 'q-poor' };
        return { word: 'Critical', cls: 'q-critical' };
    }

    /** Build score tooltip text */
    function buildScoreTooltip(score) {
        var q = getQuality(score);
        return 'Diversity Score: ' + score.toFixed(1) + '/10 (' + q.word + ')\n'
             + 'Based on Herfindahl\u2013Hirschman Index (HHI)\n'
             + 'Higher = more evenly distributed peers across providers';
    }

    /** Update the donut center label.
     *  Layout: SCORE: heading | big number | quality word | peer count
     *  When AS selected: peer count heading | AS name | percentage */
    function renderCenter() {
        if (!donutCenter) return;
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');
        if (!scoreVal || !scoreLbl) return;

        // If an AS is selected, show AS info instead of score
        if (selectedAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            if (seg) {
                var displayName = seg.isOthers ? 'Others' : (seg.asShort || seg.asName || seg.asNumber);
                if (displayName.length > 14) displayName = displayName.substring(0, 13) + '\u2026';

                if (headingEl) {
                    headingEl.textContent = seg.peerCount + ' PEER' + (seg.peerCount !== 1 ? 'S' : '');
                    headingEl.style.color = seg.color;
                }
                scoreVal.textContent = displayName;
                scoreVal.className = 'as-score-value as-selected-mode';
                scoreVal.style.color = seg.color;
                scoreVal.title = seg.asNumber + ' \u00b7 ' + (seg.asName || '') + '\n'
                    + seg.peerCount + ' peers (' + seg.percentage.toFixed(1) + '%)';
                if (qualityEl) {
                    qualityEl.textContent = seg.percentage.toFixed(1) + '%';
                    qualityEl.className = 'as-score-quality';
                    qualityEl.style.color = seg.color;
                }
                scoreLbl.textContent = seg.asNumber;
                return;
            }
        }

        // Reset any selected-mode styling
        scoreVal.className = 'as-score-value';
        scoreVal.style.color = '';
        if (headingEl) {
            headingEl.style.color = '';
        }
        if (qualityEl) {
            qualityEl.style.color = '';
        }

        // Edge case: no locatable peers (all private/tor/i2p/cjdns)
        if (totalPeers === 0) {
            if (headingEl) headingEl.textContent = '';
            if (qualityEl) {
                qualityEl.textContent = '';
                qualityEl.className = 'as-score-quality q-nodata';
            }
            scoreVal.textContent = '\u2014';
            scoreVal.title = 'No AS data available \u2014 all peers are on private or anonymous networks';
            scoreLbl.textContent = 'NO DATA';
            return;
        }

        // Normal: show diversity score
        var q = getQuality(diversityScore);

        if (headingEl) {
            headingEl.textContent = 'SCORE:';
        }

        scoreVal.textContent = diversityScore.toFixed(1);
        scoreVal.title = buildScoreTooltip(diversityScore);

        // Remove old score classes and add new
        scoreVal.classList.remove('as-score-excellent', 'as-score-good', 'as-score-moderate', 'as-score-poor', 'as-score-critical');
        if (diversityScore >= 8) scoreVal.classList.add('as-score-excellent');
        else if (diversityScore >= 6) scoreVal.classList.add('as-score-good');
        else if (diversityScore >= 4) scoreVal.classList.add('as-score-moderate');
        else if (diversityScore >= 2) scoreVal.classList.add('as-score-poor');
        else scoreVal.classList.add('as-score-critical');

        if (qualityEl) {
            qualityEl.textContent = q.word;
            qualityEl.className = 'as-score-quality ' + q.cls;
        }

        scoreLbl.textContent = totalPeers + ' (PUBLIC) PEERS';
    }

    /** Render the legend */
    function renderLegend() {
        if (!legendEl) return;
        var html = '';
        for (var i = 0; i < donutSegments.length; i++) {
            var seg = donutSegments[i];
            var cls = ['as-legend-item'];
            if (selectedAs && selectedAs !== seg.asNumber) cls.push('dimmed');
            if (selectedAs === seg.asNumber) cls.push('selected');

            var displayName = seg.isOthers ? seg.asName : (seg.asShort || seg.asName || seg.asNumber);
            var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;

            html += '<div class="' + cls.join(' ') + '" data-as="' + seg.asNumber + '">';
            html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
            html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
            html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
            html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
            html += '</div>';
        }
        legendEl.innerHTML = html;

        // Attach legend event listeners
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var li = 0; li < items.length; li++) {
            items[li].addEventListener('mouseenter', onSegmentHover);
            items[li].addEventListener('mouseleave', onSegmentLeave);
            items[li].addEventListener('click', onSegmentClick);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // HOVER TOOLTIP
    // ═══════════════════════════════════════════════════════════

    function showTooltip(asNum, event) {
        if (!tooltipEl) return;
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        if (!seg) return;

        var html = '';

        // Line 1: AS number + org
        html += '<div class="as-tt-header">';
        html += '<span class="as-tt-number">' + seg.asNumber + '</span>';
        if (seg.asName && !seg.isOthers) {
            html += '<span class="as-tt-sep">&middot;</span>';
            var name = seg.asName.length > 28 ? seg.asName.substring(0, 27) + '\u2026' : seg.asName;
            html += '<span class="as-tt-name">' + name + '</span>';
        }
        html += '</div>';

        // Line 2: peer count + type
        var typeLabel = seg.hostingLabel ? ' \u00b7 ' + seg.hostingLabel : '';
        html += '<div class="as-tt-stats">' + seg.peerCount + ' peer' + (seg.peerCount !== 1 ? 's' : '') + ' (' + seg.percentage.toFixed(1) + '%)' + typeLabel + '</div>';

        // Line 3: risk (only if notable)
        if (seg.riskLevel !== 'low' && seg.riskLabel) {
            html += '<div class="as-tt-risk as-tt-risk-' + seg.riskLevel + '">\u26a0 ' + seg.riskLabel + '</div>';
        }

        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');

        // Position to the left of the donut, not on cursor (avoids covering it)
        var pad = 10;
        var donutRect = donutWrapEl ? donutWrapEl.getBoundingClientRect() : null;
        // Force layout so we can measure the tooltip
        tooltipEl.style.left = '-9999px';
        tooltipEl.style.top = '-9999px';
        var ttRect = tooltipEl.getBoundingClientRect();

        if (donutRect) {
            var x = donutRect.left - ttRect.width - pad;
            if (x < pad) x = pad; // if not enough room on left, just stay near left edge
            var y = event.clientY - ttRect.height / 2;
            if (y < pad) y = pad;
            if (y + ttRect.height > window.innerHeight - pad) y = window.innerHeight - ttRect.height - pad;
            tooltipEl.style.left = x + 'px';
            tooltipEl.style.top = y + 'px';
        } else {
            // Fallback to cursor
            tooltipEl.style.left = (event.clientX - ttRect.width - pad) + 'px';
            tooltipEl.style.top = (event.clientY - ttRect.height / 2) + 'px';
        }
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.classList.add('hidden');
    }

    // ═══════════════════════════════════════════════════════════
    // DETAIL PANEL — Right slide-in (pushes content)
    // ═══════════════════════════════════════════════════════════

    function openPanel(asNum) {
        if (!panelEl) return;
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        if (!seg) return;

        var fullGroup = seg.isOthers ? seg : asGroups.find(function (g) { return g.asNumber === asNum; });
        if (!fullGroup) return;

        // Build header
        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        if (asnEl) asnEl.textContent = seg.isOthers ? 'Others' : seg.asNumber;
        if (orgEl) orgEl.textContent = seg.isOthers ? seg.asName : (fullGroup.asName || seg.asNumber);

        // Meta badges
        if (metaEl && !seg.isOthers) {
            var hosting = fullGroup.hostingLabel || '';
            var hcls = hosting === 'Cloud/Hosting' ? 'hosting' : (hosting === 'Residential' ? 'residential' : '');
            metaEl.innerHTML = hosting ? '<span class="as-detail-type-badge ' + hcls + '">' + hosting + '</span>' : '';
        } else if (metaEl) {
            metaEl.innerHTML = '';
        }

        // Percentage bar
        if (barFill) {
            barFill.style.width = seg.percentage.toFixed(1) + '%';
            barFill.style.background = seg.color;
        }
        if (pctEl) pctEl.textContent = seg.percentage.toFixed(1) + '% of peers';

        // Risk label
        if (riskEl) {
            riskEl.className = 'as-detail-risk';
            if (seg.riskLevel !== 'low' && seg.riskLabel) {
                riskEl.classList.add('as-detail-risk-' + seg.riskLevel);
                riskEl.textContent = seg.riskLabel;
            } else {
                riskEl.textContent = '';
            }
        }

        // Build body
        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;

        var html = '';

        if (seg.isOthers) {
            // ── Others: enriched summary ──
            var allOtherPeers = [];
            if (seg._othersGroups) {
                for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                    for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                        allOtherPeers.push(seg._othersGroups[oi].peers[opi]);
                    }
                }
            }

            html += '<div class="modal-section-title">Summary</div>';
            html += row('Total Peers', seg.peerCount);
            html += row('Providers', seg._othersGroups ? seg._othersGroups.length : '?');
            html += row('Share', seg.percentage.toFixed(1) + '%');

            // Connection type breakdown for Others
            var otherConnMap = {};
            for (var oci = 0; oci < allOtherPeers.length; oci++) {
                var oct = allOtherPeers[oci].connection_type || 'unknown';
                if (!otherConnMap[oct]) otherConnMap[oct] = { count: 0, peers: [] };
                otherConnMap[oct].count++;
                otherConnMap[oct].peers.push(allOtherPeers[oci]);
            }
            var otherConnKeys = Object.keys(otherConnMap);
            for (var ock = 0; ock < otherConnKeys.length; ock++) {
                var octKey = otherConnKeys[ock];
                var octLabel = CONN_TYPE_LABELS[octKey] || octKey;
                var octPeerIds = otherConnMap[octKey].peers.map(function (p) { return p.id; });
                html += interactiveRow(octLabel, otherConnMap[octKey].count, octPeerIds, 'conntype');
            }

            // Performance averages for Others
            var otherPings = [], otherDurations = [], otherSent = 0, otherRecv = 0;
            var nowSec = Math.floor(Date.now() / 1000);
            for (var opi2 = 0; opi2 < allOtherPeers.length; opi2++) {
                if (allOtherPeers[opi2].ping_ms > 0) otherPings.push(allOtherPeers[opi2].ping_ms);
                if (allOtherPeers[opi2].conntime > 0) {
                    var odur = nowSec - allOtherPeers[opi2].conntime;
                    if (odur > 0) otherDurations.push(odur);
                }
                otherSent += (allOtherPeers[opi2].bytessent || 0);
                otherRecv += (allOtherPeers[opi2].bytesrecv || 0);
            }
            var oAvgPing = otherPings.length > 0 ? otherPings.reduce(function (a, b) { return a + b; }, 0) / otherPings.length : 0;
            var oAvgDur = otherDurations.length > 0 ? otherDurations.reduce(function (a, b) { return a + b; }, 0) / otherDurations.length : 0;

            html += '<div class="modal-section-title">Performance</div>';
            html += row('Avg Duration', fmtDuration(oAvgDur));
            html += row('Avg Ping', oAvgPing > 0 ? Math.round(oAvgPing) + 'ms' : '\u2014');
            html += row('Data Sent', fmtBytes(otherSent));
            html += row('Data Recv', fmtBytes(otherRecv));

            if (seg._othersGroups && seg._othersGroups.length > 0) {
                html += '<div class="modal-section-title">All Providers</div>';
                for (var i = 0; i < seg._othersGroups.length; i++) {
                    var g = seg._othersGroups[i];
                    var gName = g.asShort || g.asName || g.asNumber;
                    if (gName.length > 24) gName = gName.substring(0, 23) + '\u2026';
                    html += interactiveRow(
                        g.asNumber + ' \u00b7 ' + gName,
                        g.peerCount + ' peer' + (g.peerCount !== 1 ? 's' : ''),
                        g.peerIds,
                        'provider'
                    );
                }
            }
        } else {
            // ── Individual AS: connection types only (no duplicate inbound/outbound) ──
            html += '<div class="modal-section-title">Peers</div>';
            html += row('Total', fullGroup.peerCount);

            // Show only connection types that exist, with short labels
            if (fullGroup.connTypesList && fullGroup.connTypesList.length > 0) {
                for (var cti = 0; cti < fullGroup.connTypesList.length; cti++) {
                    var ctItem = fullGroup.connTypesList[cti];
                    var ctLabel = CONN_TYPE_LABELS[ctItem.type] || ctItem.type;
                    var ctPeerIds = ctItem.peers.map(function (p) { return p.id; });
                    html += interactiveRow(ctLabel, ctItem.count, ctPeerIds, 'conntype');
                }
            }

            html += '<div class="modal-section-title">Performance</div>';
            html += row('Avg Duration', fullGroup.avgDurationFmt);
            html += row('Avg Ping', fullGroup.avgPingMs > 0 ? Math.round(fullGroup.avgPingMs) + 'ms' : '\u2014');
            html += row('Data Sent', fullGroup.totalBytesSentFmt);
            html += row('Data Recv', fullGroup.totalBytesRecvFmt);

            if (fullGroup.versions && fullGroup.versions.length > 0) {
                html += '<div class="modal-section-title">Software</div>';
                for (var vi = 0; vi < fullGroup.versions.length; vi++) {
                    var vPeerIds = fullGroup.versions[vi].peers.map(function (p) { return p.id; });
                    html += interactiveRow(fullGroup.versions[vi].subver, fullGroup.versions[vi].count + ' peer' + (fullGroup.versions[vi].count !== 1 ? 's' : ''), vPeerIds, 'software');
                }
            }

            if (fullGroup.countries && fullGroup.countries.length > 0) {
                html += '<div class="modal-section-title">Countries</div>';
                for (var ci = 0; ci < fullGroup.countries.length; ci++) {
                    var cPeerIds = fullGroup.countries[ci].peers.map(function (p) { return p.id; });
                    html += interactiveRow(fullGroup.countries[ci].code + '  ' + fullGroup.countries[ci].name, fullGroup.countries[ci].count, cPeerIds, 'country');
                }
            }

            if (fullGroup.servicesCombos && fullGroup.servicesCombos.length > 0) {
                html += '<div class="modal-section-title">Services</div>';
                for (var si = 0; si < fullGroup.servicesCombos.length; si++) {
                    var sPeerIds = fullGroup.servicesCombos[si].peers.map(function (p) { return p.id; });
                    html += interactiveRow(fullGroup.servicesCombos[si].abbrev, fullGroup.servicesCombos[si].count + ' peer' + (fullGroup.servicesCombos[si].count !== 1 ? 's' : ''), sPeerIds, 'services');
                }
            }
        }

        bodyEl.innerHTML = html;

        // Attach hover/click handlers to all interactive rows
        attachInteractiveRowHandlers(bodyEl, seg);

        // Show panel with animation + push content
        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        // Bring AS panel to front
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    function closePanel() {
        if (!panelEl) return;
        panelEl.classList.remove('visible');
        document.body.classList.remove('as-panel-open');
        document.body.classList.remove('panel-focus-as');
        setTimeout(function () {
            if (!panelEl.classList.contains('visible')) {
                panelEl.classList.add('hidden');
            }
        }, 310);
    }

    function row(label, value) {
        return '<div class="modal-row"><span class="modal-label">' + label + '</span><span class="modal-val">' + value + '</span></div>';
    }

    function subRow(label, value) {
        return '<div class="as-detail-sub-row"><span class="as-detail-sub-label">' + label + '</span><span class="as-detail-sub-val">' + value + '</span></div>';
    }

    /** Build an interactive sub-row with hover/click support.
     *  peerIds: array of peer IDs for this row's peers
     *  category: 'conntype' | 'software' | 'services' | 'country' | 'provider' */
    function interactiveRow(label, value, peerIds, category) {
        var peerIdsJson = JSON.stringify(peerIds).replace(/"/g, '&quot;');
        return '<div class="as-detail-sub-row as-interactive-row" data-peer-ids="' + peerIdsJson + '" data-category="' + category + '">'
             + '<span class="as-detail-sub-label">' + label + '</span>'
             + '<span class="as-detail-sub-val">' + value + '</span>'
             + '</div>';
    }

    /** Build a compact hover summary for a set of peers */
    function buildPeerSummaryHtml(peerIds, category, label) {
        // Find the actual peer objects from the current AS group
        var seg = selectedAs ? donutSegments.find(function (s) { return s.asNumber === selectedAs; }) : null;
        var allPeers = [];
        if (seg) {
            if (seg.isOthers && seg._othersGroups) {
                for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                    for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                        allPeers.push(seg._othersGroups[oi].peers[opi]);
                    }
                }
            } else {
                var grp = asGroups.find(function (g) { return g.asNumber === selectedAs; });
                if (grp) allPeers = grp.peers;
            }
        }

        var idSet = {};
        for (var ii = 0; ii < peerIds.length; ii++) idSet[peerIds[ii]] = true;
        var matchedPeers = [];
        for (var mi = 0; mi < allPeers.length; mi++) {
            if (idSet[allPeers[mi].id]) matchedPeers.push(allPeers[mi]);
        }

        var html = '';

        // For services category, show full service name expansion at the top
        if (category === 'services' && label && label !== '\u2014') {
            html += '<div class="as-sub-tt-section">';
            var abbrs = label.split(/\s+/);
            for (var ai = 0; ai < abbrs.length; ai++) {
                var found = false;
                for (var fk in SERVICE_FLAGS) {
                    if (SERVICE_FLAGS.hasOwnProperty(fk) && SERVICE_FLAGS[fk].abbr === abbrs[ai]) {
                        html += '<div class="as-sub-tt-flag">' + abbrs[ai] + ' = ' + SERVICE_FLAGS[fk].desc + '</div>';
                        found = true;
                        break;
                    }
                }
                if (!found) html += '<div class="as-sub-tt-flag">' + abbrs[ai] + '</div>';
            }
            html += '</div>';
        }

        // Show first 6 peers, rest hidden behind expandable "+N more (show)"
        var initialShow = 6;
        var hasMore = matchedPeers.length > initialShow;

        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < matchedPeers.length; pi++) {
            var p = matchedPeers[pi];
            var ct = p.connection_type || 'unknown';
            var ctLabel = CONN_TYPE_LABELS[ct] || ct;
            var loc = (p.city || '') + (p.city && p.country ? ', ' : '') + (p.country || '');
            // Truncate location to keep layout tight
            if (loc.length > 16) loc = loc.substring(0, 15) + '\u2026';
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-id">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + ctLabel + '</span>';
            if (loc) html += '<span class="as-sub-tt-loc">' + loc + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = matchedPeers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Attach expand/collapse handlers to the sub-tooltip after rendering */
    function attachSubTooltipHandlers() {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;

        var showMore = tip.querySelector('.as-sub-tt-show-more');
        var showLess = tip.querySelector('.as-sub-tt-show-less');
        if (!showMore || !showLess) return;

        showMore.addEventListener('click', function (e) {
            e.stopPropagation();
            // Show all extra peers
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) {
                extras[i].style.display = '';
            }
            showMore.style.display = 'none';
            showLess.style.display = '';

            // Add scroll container class if many peers
            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.add('as-sub-tt-expanded');
        });

        showLess.addEventListener('click', function (e) {
            e.stopPropagation();
            // Hide extra peers
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) {
                extras[i].style.display = 'none';
            }
            showLess.style.display = 'none';
            showMore.style.display = '';

            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.remove('as-sub-tt-expanded');
        });
    }

    /** Attach hover and click handlers to interactive rows in the detail panel */
    function attachInteractiveRowHandlers(bodyEl, seg) {
        var rows = bodyEl.querySelectorAll('.as-interactive-row');
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    // Don't override a pinned sub-tooltip with hover
                    if (subTooltipPinned) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    var html = buildPeerSummaryHtml(peerIds, category, label);
                    showSubTooltip(html, e);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (subTooltipPinned) return;
                    positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    // Don't hide a pinned sub-tooltip on mouseleave
                    if (subTooltipPinned) return;
                    hideSubTooltip();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    applySubFilter(peerIds, category, label);
                    // Pin the sub-tooltip so it stays visible
                    var html = buildPeerSummaryHtml(peerIds, category, label);
                    showSubTooltip(html, e);
                    subTooltipPinned = true;
                    var tip = document.getElementById('as-sub-tooltip');
                    if (tip) tip.style.pointerEvents = 'auto';
                });
            })(rows[ri]);
        }
    }

    /** Show the sub-row hover tooltip */
    function showSubTooltip(html, event) {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'as-sub-tooltip';
            tip.className = 'as-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        positionSubTooltip(event);
        attachSubTooltipHandlers();
    }

    function positionSubTooltip(event) {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;
        var rect = tip.getBoundingClientRect();
        var pad = 12;
        // Position to the left of the detail panel
        var panelRect = panelEl ? panelEl.getBoundingClientRect() : { left: window.innerWidth };
        var x = panelRect.left - rect.width - pad;
        if (x < pad) x = pad;
        var y = event.clientY - rect.height / 2;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hideSubTooltip() {
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) {
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        subTooltipPinned = false;
    }

    /** Apply a sub-filter: show only these peers on the map and in the peer list.
     *  category and label are used to re-apply the filter after data refreshes. */
    function applySubFilter(peerIds, category, label) {
        if (subFilterPeerIds && category === subFilterCategory && label === subFilterLabel) {
            // Clicking the same filter — toggle off
            clearSubFilter();
            return;
        }
        subFilterPeerIds = peerIds;
        subFilterCategory = category || null;
        subFilterLabel = label || null;
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);

        // Draw lines for sub-filtered peers
        var seg = selectedAs ? donutSegments.find(function (s) { return s.asNumber === selectedAs; }) : null;
        if (seg && _drawLinesForAs) {
            _drawLinesForAs(selectedAs, peerIds, seg.color);
        }

        // Highlight the active row
        highlightActiveSubRow();
    }

    /** Highlight the sub-filter-active row in the detail panel body */
    function highlightActiveSubRow() {
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        if (!bodyEl) return;
        var rows = bodyEl.querySelectorAll('.as-interactive-row');
        for (var ri = 0; ri < rows.length; ri++) {
            if (subFilterCategory && subFilterLabel
                && rows[ri].dataset.category === subFilterCategory
                && rows[ri].querySelector('.as-detail-sub-label').textContent === subFilterLabel) {
                rows[ri].classList.add('sub-filter-active');
            } else {
                rows[ri].classList.remove('sub-filter-active');
            }
        }
    }

    /** Clear the sub-filter (restore to full AS selection) */
    function clearSubFilter() {
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        hideSubTooltip();
        // Restore to full AS filter
        if (selectedAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            if (seg) {
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
            }
        }
        // Remove active highlights
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        if (bodyEl) {
            var rows = bodyEl.querySelectorAll('.as-interactive-row');
            for (var ri = 0; ri < rows.length; ri++) {
                rows[ri].classList.remove('sub-filter-active');
            }
        }
    }

    /** Find fresh peer IDs by matching category+label in the current AS group data.
     *  This allows sub-filters to survive data refreshes — new peers matching the
     *  criteria get included, disconnected peers drop out. */
    function findPeerIdsByCategoryLabel(seg, category, label) {
        var fullGroup = seg.isOthers ? seg : asGroups.find(function (g) { return g.asNumber === seg.asNumber; });
        if (!fullGroup) return null;

        if (category === 'software' && fullGroup.versions) {
            for (var i = 0; i < fullGroup.versions.length; i++) {
                if (fullGroup.versions[i].subver === label) {
                    return fullGroup.versions[i].peers.map(function (p) { return p.id; });
                }
            }
        } else if (category === 'conntype') {
            var ctList = fullGroup.connTypesList || [];
            for (var i = 0; i < ctList.length; i++) {
                var ctLabel = CONN_TYPE_LABELS[ctList[i].type] || ctList[i].type;
                if (ctLabel === label) {
                    return ctList[i].peers.map(function (p) { return p.id; });
                }
            }
            // Also check Others' connection types
            if (seg.isOthers) {
                var allOtherPeers = [];
                if (seg._othersGroups) {
                    for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                        for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                            allOtherPeers.push(seg._othersGroups[oi].peers[opi]);
                        }
                    }
                }
                var connMap = {};
                for (var ci = 0; ci < allOtherPeers.length; ci++) {
                    var ct = allOtherPeers[ci].connection_type || 'unknown';
                    var cl = CONN_TYPE_LABELS[ct] || ct;
                    if (!connMap[cl]) connMap[cl] = [];
                    connMap[cl].push(allOtherPeers[ci].id);
                }
                if (connMap[label]) return connMap[label];
            }
        } else if (category === 'country' && fullGroup.countries) {
            for (var i = 0; i < fullGroup.countries.length; i++) {
                var cLabel = fullGroup.countries[i].code + '  ' + fullGroup.countries[i].name;
                if (cLabel === label) {
                    return fullGroup.countries[i].peers.map(function (p) { return p.id; });
                }
            }
        } else if (category === 'services' && fullGroup.servicesCombos) {
            for (var i = 0; i < fullGroup.servicesCombos.length; i++) {
                if (fullGroup.servicesCombos[i].abbrev === label) {
                    return fullGroup.servicesCombos[i].peers.map(function (p) { return p.id; });
                }
            }
        } else if (category === 'provider' && seg.isOthers && seg._othersGroups) {
            for (var i = 0; i < seg._othersGroups.length; i++) {
                var g = seg._othersGroups[i];
                var gName = g.asShort || g.asName || g.asNumber;
                if (gName.length > 24) gName = gName.substring(0, 23) + '\u2026';
                var pLabel = g.asNumber + ' \u00b7 ' + gName;
                if (pLabel === label) {
                    return g.peerIds;
                }
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════

    function onSegmentHover(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;
        hoveredAs = asNum;
        showTooltip(asNum, e);

        // Only draw hover lines if nothing is selected
        if (!selectedAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
            if (seg && _drawLinesForAs) {
                _drawLinesForAs(asNum, seg.peerIds, seg.color);
            }
        }
    }

    function onSegmentLeave() {
        hoveredAs = null;
        hideTooltip();

        // ONLY clear lines if nothing is selected — selection keeps its lines
        if (!selectedAs) {
            if (_clearAsLines) _clearAsLines();
        }
    }

    function onSegmentClick(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;

        if (selectedAs === asNum) {
            // Deselect
            deselect();
        } else {
            // Select this AS — clear any sub-filter from previous selection
            subFilterPeerIds = null;
            subFilterLabel = null;
            subFilterCategory = null;
            hideSubTooltip();
            selectedAs = asNum;
            var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
            if (seg) {
                openPanel(asNum);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(asNum, seg.peerIds, seg.color);
            }
            // Keep legend visible while selected
            if (containerEl) containerEl.classList.add('as-legend-visible');
            renderDonut();
            renderCenter();
            renderLegend();
        }
    }

    function deselect() {
        selectedAs = null;
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        hideSubTooltip();
        closePanel();
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        if (_clearAsLines) _clearAsLines();
        renderDonut();
        renderCenter();
        renderLegend();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape' && selectedAs) {
            deselect();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PUBLIC API — Called by bitapp.js
    // ═══════════════════════════════════════════════════════════

    /** Initialize — cache DOM refs and attach events. Call once on page load. */
    function init() {
        containerEl = document.getElementById('as-diversity-container');
        donutWrapEl = document.getElementById('as-donut-wrap');
        donutSvg = document.getElementById('as-donut');
        donutCenter = document.getElementById('as-donut-center');
        legendEl = document.getElementById('as-legend');
        tooltipEl = document.getElementById('as-tooltip');
        panelEl = document.getElementById('as-detail-panel');
        loadingEl = containerEl ? containerEl.querySelector('.as-loading') : null;

        // Close button on detail panel
        var closeBtn = panelEl ? panelEl.querySelector('.as-detail-close') : null;
        if (closeBtn) {
            closeBtn.addEventListener('click', deselect);
        }

        // Clicking the AS detail panel brings it to front
        if (panelEl) {
            panelEl.addEventListener('click', function () {
                document.body.classList.add('panel-focus-as');
                document.body.classList.remove('panel-focus-peers');
            });
        }

        // Escape key
        document.addEventListener('keydown', onKeyDown);

        // Always active — show immediately
        isActive = true;
    }

    /** Register integration callbacks from bitapp.js */
    function setHooks(hooks) {
        _drawLinesForAs = hooks.drawLinesForAs || null;
        _clearAsLines = hooks.clearAsLines || null;
        _filterPeerTable = hooks.filterPeerTable || null;
        _dimMapPeers = hooks.dimMapPeers || null;
        _getWorldToScreen = hooks.getWorldToScreen || null;
    }

    /** Update with new peer data. Called after each fetchPeers(). */
    function update(peers) {
        if (!isActive) return;

        // Check if >10% of peers are still being geolocated
        var pendingCount = 0;
        for (var pi = 0; pi < peers.length; pi++) {
            if (peers[pi].location_status === 'pending') pendingCount++;
        }
        var pendingPct = peers.length > 0 ? (pendingCount / peers.length) * 100 : 0;
        var isGeoLoading = pendingPct > 10;

        // Show/hide the loading overlay
        if (loadingEl) {
            if (isGeoLoading) {
                loadingEl.textContent = 'Locating ' + pendingCount + ' peer' + (pendingCount !== 1 ? 's' : '') + '\u2026';
                loadingEl.style.display = '';
            } else if (hasRenderedOnce) {
                loadingEl.style.display = 'none';
            }
        }

        asGroups = aggregatePeers(peers);
        diversityScore = calcDiversityScore(asGroups);
        donutSegments = buildDonutSegments(asGroups);

        // Toggle no-data state on the container
        if (containerEl) {
            if (totalPeers === 0 && !isGeoLoading) containerEl.classList.add('no-data');
            else containerEl.classList.remove('no-data');
        }

        renderDonut();
        renderCenter();
        renderLegend();

        // If a selection is active, refresh the panel + filter + keep lines
        if (selectedAs) {
            // Save sub-filter identity so we can re-apply after panel rebuild
            var savedCategory = subFilterCategory;
            var savedLabel = subFilterLabel;

            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            if (seg) {
                openPanel(selectedAs);

                // Try to re-apply sub-filter by matching category+label in fresh data
                if (savedCategory && savedLabel) {
                    var freshPeerIds = findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
                    if (freshPeerIds && freshPeerIds.length > 0) {
                        subFilterPeerIds = freshPeerIds;
                        subFilterCategory = savedCategory;
                        subFilterLabel = savedLabel;
                        if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                        if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                        if (_drawLinesForAs) _drawLinesForAs(selectedAs, freshPeerIds, seg.color);
                        highlightActiveSubRow();
                        // Re-pin the sub-tooltip with fresh data if it was pinned
                        if (subTooltipPinned) {
                            var html = buildPeerSummaryHtml(freshPeerIds, savedCategory, savedLabel);
                            var tip = document.getElementById('as-sub-tooltip');
                            if (tip) {
                                tip.innerHTML = html;
                                tip.style.pointerEvents = 'auto';
                                attachSubTooltipHandlers();
                            }
                        }
                    } else {
                        // Sub-filter no longer matches (all peers in that category disconnected)
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        hideSubTooltip();
                        if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                        if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                        if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
                    }
                } else {
                    // No sub-filter active, show full AS
                    if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                    if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                    if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
                }
            } else {
                deselect();
            }
        }
    }

    /** Activate the AS Diversity view (always active now, kept for API compat) */
    function activate() {
        isActive = true;
    }

    /** Deactivate the AS Diversity view */
    function deactivate() {
        isActive = false;
        deselect();
        hideTooltip();
    }

    /** Returns true if this view is currently active */
    function isViewActive() {
        return isActive;
    }

    /** Get the donut center screen position for line drawing */
    function getDonutCenter() {
        if (!donutWrapEl) return null;
        var rect = donutWrapEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    /** Get the screen position of a legend dot for a specific AS number.
     *  Returns {x, y} in page coords, or null if not found / legend not visible. */
    function getLegendDotPosition(asNum) {
        if (!legendEl) return null;
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.as === asNum) {
                var dot = items[i].querySelector('.as-legend-dot');
                if (dot) {
                    var rect = dot.getBoundingClientRect();
                    // Check if actually visible (legend might be hidden)
                    if (rect.width === 0 && rect.height === 0) return null;
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                }
            }
        }
        return null;
    }

    /** Get the currently selected AS number */
    function getSelectedAs() {
        return selectedAs;
    }

    /** Get the currently hovered AS number */
    function getHoveredAs() {
        return hoveredAs;
    }

    /** Get peer IDs for a given AS number */
    function getPeerIdsForAs(asNum) {
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        return seg ? seg.peerIds : [];
    }

    /** Get the color for a given AS number */
    function getColorForAs(asNum) {
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        return seg ? seg.color : null;
    }

    /** Get all segments (for canvas integration) */
    function getSegments() {
        return donutSegments;
    }

    return {
        init: init,
        setHooks: setHooks,
        update: update,
        activate: activate,
        deactivate: deactivate,
        deselect: deselect,
        clearSubFilter: clearSubFilter,
        hasSubFilter: function () { return subFilterPeerIds !== null; },
        isViewActive: isViewActive,
        getDonutCenter: getDonutCenter,
        getLegendDotPosition: getLegendDotPosition,
        getHoveredAs: getHoveredAs,
        getSelectedAs: getSelectedAs,
        getPeerIdsForAs: getPeerIdsForAs,
        getColorForAs: getColorForAs,
        getSegments: getSegments,
    };
})();
