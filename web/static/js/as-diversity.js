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
    const DONUT_WIDTH = 28;      // Width of the donut ring (default)
    const DONUT_WIDTH_SELECTED = 40;  // Width when selected (thicker)
    const DONUT_WIDTH_DIMMED = 14;    // Width when dimmed (thinner)
    const INNER_RADIUS = DONUT_RADIUS - DONUT_WIDTH;

    // Curated colour palette — 9 colours (8 AS + Others), distinct and accessible
    const PALETTE = [
        '#f472b6',   // pink
        '#3fb950',   // green
        '#e3b341',   // gold
        '#f07178',   // coral
        '#8b5cf6',   // purple
        '#d2a8ff',   // lavender
        '#79c0ff',   // light blue
        '#f0883e',   // orange
        '#58a6ff',   // blue (Others)
    ];

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    let isActive = true;           // Always active now (no toggle)
    let asGroups = [];             // Aggregated AS data (sorted by count desc)
    let donutSegments = [];        // Top N + Others for donut rendering
    let hoveredAs = null;          // AS number string currently hovered
    let hoveredAll = false;        // True when title or SUMMARY ANALYSIS is hovered
    let summarySelected = false;   // True when Summary Analysis panel is open
    let selectedAs = null;         // AS number string currently selected (clicked)
    let diversityScore = 0;        // 0-10 score
    let totalPeers = 0;
    let hasRenderedOnce = false;   // Track if we've ever rendered data
    let legendFocusAs = null;      // AS number to exclusively show in legend during panel hover
    let donutFocused = false;      // True when in focused mode (donut at top-center)
    let focusedHoverAs = null;     // AS hovered in focused mode (for center text display)
    let othersListOpen = false;    // True when Others scrollable list is showing in donut center

    // Donut segment animation state
    let donutAnimState = 'idle';   // 'idle' | 'expanding' | 'expanded' | 'reverting'
    let donutAnimTarget = null;    // AS number being expanded
    let donutAnimProgress = 0;    // 0 to 1 progress
    let donutAnimFrame = null;    // requestAnimationFrame ID
    let donutAnimStartTime = 0;   // Animation start timestamp
    const DONUT_ANIM_DURATION = 400; // ms for expand/revert animation
    const DONUT_EXPAND_RATIO = 0.70; // expanded segment gets 70% of donut
    let donutAnimSafetyTimer = null; // Safety timeout to force-end stuck animations

    // DOM refs (cached on init)
    let containerEl = null;
    let titleEl = null;
    let donutWrapEl = null;
    let donutSvg = null;
    let donutCenter = null;
    let legendEl = null;
    let tooltipEl = null;
    let panelEl = null;
    let loadingEl = null;
    let focusedCloseBtn = null;

    // Sub-filter state: when user clicks a sub-row (software, service, country, conn type, others provider)
    let subFilterPeerIds = null;   // Array of peer IDs for the active sub-filter, or null
    let subFilterLabel = null;     // Description of what's being sub-filtered
    let subFilterCategory = null;  // Category key ('software', 'conntype', 'country', 'services', 'provider')
    let subTooltipPinned = false;  // Whether the sub-tooltip is pinned (clicked vs hovered)
    let subSubTooltipPinned = false; // Whether the sub-sub-tooltip is pinned
    let subSubFilterPeerIds = null;  // Peer IDs at sub-sub level (specific provider within a category drill-down)
    let subSubFilterAsNum = null;    // AS number for the sub-sub drill-down provider
    let subSubFilterColor = null;    // Line color for the sub-sub drill-down provider
    let pinnedSubTooltipHtml = null; // HTML of the pinned sub-tooltip (for restore after hover preview)
    let pinnedSubTooltipSrc = null;  // Source element that opened the pinned sub-tooltip
    let pinnedSubTooltipSetup = null; // fn(tip) — re-attach handlers when restoring pinned tooltip
    let lastPeersRaw = [];         // Raw peers from last update (for summary computation)
    let panelHistory = [];         // Navigation stack [{type:'summary'|'provider', asNumber?, scrollTop?}]
    let peerDetailActive = false;  // True when peer detail panel is shown (from peer list/map click)
    let insightActiveAsNum = null;  // AS number to show in donut when an insight is active (Most Stable, Fastest, etc.)
    let insightActiveType = null;   // Type of insight active: 'stable', 'fastest', 'data-bytessent', 'data-bytesrecv'
    let insightRectEl = null;       // DOM ref for insight rectangle overlay
    let insightRectVisible = false; // Whether the insight rectangle is currently shown
    let hoveredPeerId = null;       // Peer ID currently being hovered in a subtooltip (for update preservation)

    // Integration hooks (set by bitapp.js)
    let _drawLinesForAs = null;    // fn(asNumber, peerIds, color) — draw lines on canvas
    let _drawLinesForAllAs = null; // fn(groups) — draw lines for all AS groups at once
    let _clearAsLines = null;      // fn() — clear AS lines from canvas
    let _filterPeerTable = null;   // fn(peerIds | null) — filter peer table
    let _dimMapPeers = null;       // fn(peerIds | null) — dim non-matching peers
    let _getWorldToScreen = null;  // fn(lon, lat) => {x, y}
    let _selectPeerById = null;    // fn(peerId) — select a peer on the map by ID (full deselect)
    let _zoomToPeerOnly = null;    // fn(peerId) — zoom to peer without deselecting AS panel
    let _resetMapZoom = null;      // fn() — smoothly zoom the map back to default view
    let _hideMapTooltip = null;    // fn() — hide the map peer tooltip

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
    // SUMMARY DATA COMPUTATION
    // ═══════════════════════════════════════════════════════════

    /** Get all peer objects for a donut segment (handles Others bucket) */
    function getAllPeersForSegment(seg) {
        if (seg.isOthers && seg._othersGroups) {
            var all = [];
            for (var i = 0; i < seg._othersGroups.length; i++) {
                for (var j = 0; j < seg._othersGroups[i].peers.length; j++) {
                    all.push(seg._othersGroups[i].peers[j]);
                }
            }
            return all;
        }
        var grp = asGroups.find(function (g) { return g.asNumber === seg.asNumber; });
        return grp ? grp.peers : [];
    }

    /** Find the donut segment color for a given AS number.
     *  Peers in the "Others" bucket get the Others color. */
    function getColorForAsNum(asNum) {
        for (var i = 0; i < donutSegments.length; i++) {
            if (donutSegments[i].asNumber === asNum) return donutSegments[i].color;
            if (donutSegments[i].isOthers && donutSegments[i]._othersGroups) {
                for (var j = 0; j < donutSegments[i]._othersGroups.length; j++) {
                    if (donutSegments[i]._othersGroups[j].asNumber === asNum) return donutSegments[i].color;
                }
            }
        }
        return PALETTE[PALETTE.length - 1];
    }

    /** Generic: aggregate peers by a category key function.
     *  Returns [{label, peerCount, providerCount, peerIds, providers: [{asNumber, name, color, peerCount, peerIds, peers}]}]
     *  sorted by peerCount descending. */
    function aggregateSummaryByCategory(peers, getKey, getLabel) {
        var catMap = {};
        for (var i = 0; i < peers.length; i++) {
            var p = peers[i];
            var key = getKey(p);
            if (!key) continue;
            var asNum = parseAsNumber(p.as);
            if (!asNum) continue;
            var label = getLabel ? getLabel(p, key) : key;

            if (!catMap[key]) catMap[key] = { key: key, label: label, peerCount: 0, peerIds: [], providerMap: {} };
            catMap[key].peerCount++;
            catMap[key].peerIds.push(p.id);

            if (!catMap[key].providerMap[asNum]) {
                catMap[key].providerMap[asNum] = {
                    asNumber: asNum,
                    name: parseAsOrg(p.as) || asNum,
                    color: getColorForAsNum(asNum),
                    peerCount: 0,
                    peerIds: [],
                    peers: []
                };
            }
            catMap[key].providerMap[asNum].peerCount++;
            catMap[key].providerMap[asNum].peerIds.push(p.id);
            catMap[key].providerMap[asNum].peers.push(p);
        }

        var result = [];
        var keys = Object.keys(catMap);
        for (var k = 0; k < keys.length; k++) {
            var item = catMap[keys[k]];
            var providers = [];
            var pKeys = Object.keys(item.providerMap);
            for (var pk = 0; pk < pKeys.length; pk++) {
                providers.push(item.providerMap[pKeys[pk]]);
            }
            providers.sort(function (a, b) { return b.peerCount - a.peerCount; });
            result.push({
                key: item.key,
                label: item.label,
                peerCount: item.peerCount,
                providerCount: providers.length,
                peerIds: item.peerIds,
                providers: providers
            });
        }
        result.sort(function (a, b) { return b.peerCount - a.peerCount; });
        return result;
    }

    /** Aggregate peers by network type (IPv4, IPv6, Tor, I2P, CJDNS) */
    function aggregateSummaryNetworks(peers) {
        var netLabels = { 'ipv4': 'IPv4', 'ipv6': 'IPv6', 'onion': 'Tor', 'i2p': 'I2P', 'cjdns': 'CJDNS' };
        return aggregateSummaryByCategory(peers,
            function (p) { return p.network || 'ipv4'; },
            function (p, key) { return netLabels[key] || key; }
        );
    }

    /** Aggregate peers by hosting type (Cloud/Hosting, Proxy/VPN, Mobile, Residential) */
    function aggregateSummaryHosting(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) {
                if (p.hosting) return 'cloud';
                if (p.proxy) return 'proxy';
                if (p.mobile) return 'mobile';
                return 'residential';
            },
            function (p, key) {
                var labels = { 'cloud': 'Cloud / Hosting', 'proxy': 'Proxy / VPN', 'mobile': 'Mobile', 'residential': 'Residential' };
                return labels[key] || key;
            }
        );
    }

    /** Aggregate peers by country */
    function aggregateSummaryCountries(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) { return p.countryCode || null; },
            function (p, key) { return key + '  ' + (p.country || key); }
        );
    }

    /** Aggregate peers by software version */
    function aggregateSummarySoftware(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) { return p.subver || 'Unknown'; },
            null
        );
    }

    /** Aggregate peers by service flag combo */
    function aggregateSummaryServices(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) { return p.services_abbrev || '\u2014'; },
            null
        );
    }

    /** Build connection grid: each donut segment with IN/OUT counts and outbound subtypes */
    function buildConnectionGrid() {
        var grid = [];
        for (var i = 0; i < donutSegments.length; i++) {
            var seg = donutSegments[i];
            var peers = getAllPeersForSegment(seg);
            var inPeers = [], outPeers = [];
            for (var j = 0; j < peers.length; j++) {
                if (peers[j].connection_type === 'inbound') inPeers.push(peers[j]);
                else outPeers.push(peers[j]);
            }
            // Break out outbound by connection subtype
            var outSubtypes = {};
            for (var oj = 0; oj < outPeers.length; oj++) {
                var ct = outPeers[oj].connection_type || 'unknown';
                if (!outSubtypes[ct]) outSubtypes[ct] = [];
                outSubtypes[ct].push(outPeers[oj]);
            }
            var outSubList = [];
            for (var oKey in outSubtypes) {
                if (!outSubtypes.hasOwnProperty(oKey)) continue;
                outSubList.push({
                    type: oKey,
                    label: CONN_TYPE_LABELS[oKey] || oKey,
                    count: outSubtypes[oKey].length,
                    peerIds: outSubtypes[oKey].map(function (p) { return p.id; })
                });
            }
            var displayName = seg.isOthers ? 'Others' : (seg.asShort || seg.asName || seg.asNumber);
            if (displayName.length > 16) displayName = displayName.substring(0, 15) + '\u2026';
            grid.push({
                asNumber: seg.asNumber,
                name: displayName,
                color: seg.color,
                isOthers: seg.isOthers || false,
                inCount: inPeers.length,
                outCount: outPeers.length,
                inPeerIds: inPeers.map(function (p) { return p.id; }),
                outPeerIds: outPeers.map(function (p) { return p.id; }),
                totalPeerIds: peers.map(function (p) { return p.id; }),
                inPeers: inPeers,
                outPeers: outPeers,
                outSubtypes: outSubList,
                totalCount: peers.length
            });
        }
        return grid;
    }

    /** Compute 4 dynamic insights for the summary panel */
    function computeInsights() {
        var insights = [];
        var nowSec = Math.floor(Date.now() / 1000);

        // Insight 1: Most stable — provider with highest avg connection duration
        if (asGroups.length > 0) {
            var bestAvg = 0, bestGroup = null;
            for (var i = 0; i < asGroups.length; i++) {
                var g = asGroups[i];
                var totalDur = 0, durCount = 0;
                for (var j = 0; j < g.peers.length; j++) {
                    if (g.peers[j].conntime > 0) {
                        totalDur += (nowSec - g.peers[j].conntime);
                        durCount++;
                    }
                }
                var avg = durCount > 0 ? totalDur / durCount : 0;
                if (avg > bestAvg) { bestAvg = avg; bestGroup = g; }
            }
            if (bestGroup && bestAvg > 0) {
                insights.push({
                    type: 'stable',
                    icon: '\u23f3',
                    asNumber: bestGroup.asNumber,
                    provName: bestGroup.asShort || bestGroup.asNumber,
                    durText: fmtDuration(bestAvg),
                    peerIds: bestGroup.peers.map(function (p) { return p.id; }),
                    peers: bestGroup.peers
                });
            }
        }

        // Insight 2: Fastest connection — providers ranked by avg ping time (lowest first)
        if (asGroups.length > 0) {
            var pingProvList = [];
            for (var i = 0; i < asGroups.length; i++) {
                var g = asGroups[i];
                var totalPing = 0, pingCount = 0;
                for (var j = 0; j < g.peers.length; j++) {
                    if (g.peers[j].ping_ms > 0) {
                        totalPing += g.peers[j].ping_ms;
                        pingCount++;
                    }
                }
                if (pingCount > 0) {
                    var avgPing = totalPing / pingCount;
                    var peersSorted = g.peers.slice().sort(function (a, b) { return (a.ping_ms || 9999) - (b.ping_ms || 9999); });
                    pingProvList.push({
                        asNumber: g.asNumber,
                        provName: g.asShort || g.asName || g.asNumber,
                        color: getColorForAsNum(g.asNumber),
                        avgPing: avgPing,
                        peers: peersSorted,
                        peerIds: g.peerIds
                    });
                }
            }
            pingProvList.sort(function (a, b) { return a.avgPing - b.avgPing; });
            if (pingProvList.length > 0) {
                insights.push({
                    type: 'fastest',
                    icon: '\u26a1',
                    topProviders: pingProvList,
                    field: 'ping'
                });
            }
        }

        // Insight 3: Providers with most total bytes sent
        var sentByProvider = {};
        for (var i = 0; i < lastPeersRaw.length; i++) {
            var p = lastPeersRaw[i];
            var asNum = parseAsNumber(p.as);
            if (!asNum || !(p.bytessent > 0)) continue;
            if (!sentByProvider[asNum]) sentByProvider[asNum] = { asNumber: asNum, totalBytes: 0, peers: [] };
            sentByProvider[asNum].totalBytes += p.bytessent;
            sentByProvider[asNum].peers.push(p);
        }
        var sentProvList = [];
        for (var k in sentByProvider) {
            if (!sentByProvider.hasOwnProperty(k)) continue;
            var sp = sentByProvider[k];
            sp.peers.sort(function (a, b) { return (b.bytessent || 0) - (a.bytessent || 0); });
            var grp = asGroups.find(function (g) { return g.asNumber === sp.asNumber; });
            sp.provName = grp ? (grp.asShort || grp.asName || grp.asNumber) : sp.asNumber;
            sp.color = getColorForAsNum(sp.asNumber);
            sentProvList.push(sp);
        }
        sentProvList.sort(function (a, b) { return b.totalBytes - a.totalBytes; });
        if (sentProvList.length > 0) {
            insights.push({
                type: 'data-providers',
                icon: '\u2b06\ufe0f',
                label: 'Most data sent to <span style="color:var(--text-muted)">(by rank)</span>',
                topProviders: sentProvList,
                field: 'bytessent'
            });
        }

        // Insight 4: Providers with most total bytes received
        var recvByProvider = {};
        for (var i = 0; i < lastPeersRaw.length; i++) {
            var p = lastPeersRaw[i];
            var asNum = parseAsNumber(p.as);
            if (!asNum || !(p.bytesrecv > 0)) continue;
            if (!recvByProvider[asNum]) recvByProvider[asNum] = { asNumber: asNum, totalBytes: 0, peers: [] };
            recvByProvider[asNum].totalBytes += p.bytesrecv;
            recvByProvider[asNum].peers.push(p);
        }
        var recvProvList = [];
        for (var k in recvByProvider) {
            if (!recvByProvider.hasOwnProperty(k)) continue;
            var rp = recvByProvider[k];
            rp.peers.sort(function (a, b) { return (b.bytesrecv || 0) - (a.bytesrecv || 0); });
            var grp = asGroups.find(function (g) { return g.asNumber === rp.asNumber; });
            rp.provName = grp ? (grp.asShort || grp.asName || grp.asNumber) : rp.asNumber;
            rp.color = getColorForAsNum(rp.asNumber);
            recvProvList.push(rp);
        }
        recvProvList.sort(function (a, b) { return b.totalBytes - a.totalBytes; });
        if (recvProvList.length > 0) {
            insights.push({
                type: 'data-providers',
                icon: '\u2b07\ufe0f',
                label: 'Most data recv by <span style="color:var(--text-muted)">(by rank)</span>',
                topProviders: recvProvList,
                field: 'bytesrecv'
            });
        }

        return insights;
    }

    /** Compute all summary data */
    function computeSummaryData() {
        var peers = lastPeersRaw;
        return {
            score: diversityScore,
            quality: getQuality(diversityScore),
            uniqueProviders: asGroups.length,
            topProvider: asGroups.length > 0 ? asGroups[0] : null,
            insights: computeInsights(),
            connectionGrid: buildConnectionGrid(),
            networks: aggregateSummaryNetworks(peers),
            hosting: aggregateSummaryHosting(peers),
            countries: aggregateSummaryCountries(peers),
            software: aggregateSummarySoftware(peers),
            services: aggregateSummaryServices(peers)
        };
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

            // Calculate sweeps — either normal (data-proportional) or animated (expanded)
            var sweeps = [];
            var normalSweeps = [];
            for (var si = 0; si < donutSegments.length; si++) {
                normalSweeps.push((donutSegments[si].peerCount / totalPeers) * available);
            }

            if ((donutAnimState === 'expanding' || donutAnimState === 'expanded' || donutAnimState === 'reverting') && donutAnimTarget) {
                // Calculate expanded layout: target segment gets DONUT_EXPAND_RATIO, rest share the remainder
                var expandedSweeps = [];
                var targetIdx = -1;
                for (var si = 0; si < donutSegments.length; si++) {
                    if (donutSegments[si].asNumber === donutAnimTarget) {
                        targetIdx = si;
                        break;
                    }
                }
                if (targetIdx >= 0) {
                    var expandedSweep = available * DONUT_EXPAND_RATIO;
                    var remainingSpace = available - expandedSweep;
                    var otherTotal = totalPeers - donutSegments[targetIdx].peerCount;
                    for (var si = 0; si < donutSegments.length; si++) {
                        if (si === targetIdx) {
                            expandedSweeps.push(expandedSweep);
                        } else {
                            var share = otherTotal > 0 ? (donutSegments[si].peerCount / otherTotal) : (1 / (donutSegments.length - 1));
                            expandedSweeps.push(share * remainingSpace);
                        }
                    }
                } else {
                    expandedSweeps = normalSweeps.slice();
                }

                // Interpolate based on animation progress
                var t = donutAnimState === 'reverting' ? (1 - donutAnimProgress) : donutAnimProgress;
                // Smooth easing
                t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                for (var si = 0; si < donutSegments.length; si++) {
                    sweeps.push(normalSweeps[si] + (expandedSweeps[si] - normalSweeps[si]) * t);
                }
            } else {
                sweeps = normalSweeps;
            }

            // Arrange segments: in expanded mode, non-target segments go to top, target at bottom
            var renderOrder = [];
            var targetIdx = -1;
            if ((donutAnimState !== 'idle') && donutAnimTarget) {
                for (var si = 0; si < donutSegments.length; si++) {
                    if (donutSegments[si].asNumber === donutAnimTarget) {
                        targetIdx = si;
                    } else {
                        renderOrder.push(si);
                    }
                }
                if (targetIdx >= 0) renderOrder.push(targetIdx);
            } else {
                for (var si = 0; si < donutSegments.length; si++) renderOrder.push(si);
            }

            // Layout: others at top (starting at -PI/2), target fills bottom
            var angle = -Math.PI / 2;

            // If animating, re-order: non-target segments first (top), then target (bottom)
            var segAngles = [];
            for (var ri = 0; ri < renderOrder.length; ri++) {
                var idx = renderOrder[ri];
                var sweep = sweeps[idx];
                if (sweep <= 0) {
                    segAngles[idx] = { start: angle, end: angle };
                    continue;
                }
                segAngles[idx] = { start: angle + gap / 2, end: angle + sweep + gap / 2 };
                angle += sweep + gap;
            }

            // Calculate per-segment ring widths (animated: selected=thick, others=thin)
            var segWidths = [];
            var animT = 0;
            if ((donutAnimState === 'expanding' || donutAnimState === 'expanded' || donutAnimState === 'reverting') && donutAnimTarget) {
                animT = donutAnimState === 'reverting' ? (1 - donutAnimProgress) : donutAnimProgress;
                animT = animT < 0.5 ? 2 * animT * animT : 1 - Math.pow(-2 * animT + 2, 2) / 2;
            }
            for (var si = 0; si < donutSegments.length; si++) {
                if (animT > 0 && donutAnimTarget) {
                    if (donutSegments[si].asNumber === donutAnimTarget) {
                        segWidths.push(DONUT_WIDTH + (DONUT_WIDTH_SELECTED - DONUT_WIDTH) * animT);
                    } else {
                        segWidths.push(DONUT_WIDTH + (DONUT_WIDTH_DIMMED - DONUT_WIDTH) * animT);
                    }
                } else {
                    segWidths.push(DONUT_WIDTH);
                }
            }

            // Group for shadow on all segments
            html += '<g filter="url(#donut-shadow)">';
            for (var si = 0; si < donutSegments.length; si++) {
                var seg = donutSegments[si];
                if (!segAngles[si] || sweeps[si] <= 0) continue;

                var segW = segWidths[si];
                var segOuter = DONUT_RADIUS - (DONUT_WIDTH - segW) / 2;
                var segInner = segOuter - segW;
                var d = describeArc(cx, cy, segOuter, segInner, segAngles[si].start, segAngles[si].end);

                var cls = ['as-donut-segment'];
                if (selectedAs && selectedAs !== seg.asNumber) cls.push('dimmed');
                if (selectedAs === seg.asNumber) cls.push('selected');

                html += '<path d="' + d + '" fill="' + seg.color + '" class="' + cls.join(' ') + '" data-as="' + seg.asNumber + '" />';
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

    /** Start donut expansion animation for a selected segment */
    function animateDonutExpand(asNum) {
        if (donutAnimFrame) cancelAnimationFrame(donutAnimFrame);
        if (donutAnimSafetyTimer) clearTimeout(donutAnimSafetyTimer);
        donutAnimTarget = asNum;
        donutAnimState = 'expanding';
        donutAnimProgress = 0;
        donutAnimStartTime = performance.now();
        donutAnimFrame = requestAnimationFrame(donutAnimStep);
        // Safety: force-complete if animation gets stuck
        donutAnimSafetyTimer = setTimeout(function () {
            if (donutAnimState === 'expanding') {
                donutAnimState = 'expanded';
                donutAnimProgress = 1;
                donutAnimFrame = null;
                renderDonut();
            }
        }, DONUT_ANIM_DURATION + 200);
    }

    /** Start donut revert animation (back to proportional) */
    function animateDonutRevert() {
        if (donutAnimFrame) cancelAnimationFrame(donutAnimFrame);
        if (donutAnimSafetyTimer) clearTimeout(donutAnimSafetyTimer);
        donutAnimState = 'reverting';
        donutAnimProgress = 0;
        donutAnimStartTime = performance.now();
        donutAnimFrame = requestAnimationFrame(donutAnimStep);
        // Safety: force-complete if animation gets stuck
        donutAnimSafetyTimer = setTimeout(function () {
            if (donutAnimState === 'reverting') {
                donutAnimState = 'idle';
                donutAnimTarget = null;
                donutAnimProgress = 0;
                donutAnimFrame = null;
                renderDonut();
            }
        }, DONUT_ANIM_DURATION + 200);
    }

    /** Animation step — called each frame */
    function donutAnimStep(now) {
        var elapsed = now - donutAnimStartTime;
        donutAnimProgress = Math.min(1, elapsed / DONUT_ANIM_DURATION);

        renderDonut();

        if (donutAnimProgress < 1) {
            donutAnimFrame = requestAnimationFrame(donutAnimStep);
        } else {
            // Animation complete
            donutAnimFrame = null;
            if (donutAnimState === 'expanding') {
                donutAnimState = 'expanded';
                donutAnimProgress = 1;
            } else if (donutAnimState === 'reverting') {
                donutAnimState = 'idle';
                donutAnimTarget = null;
                donutAnimProgress = 0;
                // Final render at idle state
                renderDonut();
            }
        }
    }

    /** Force-stop any donut animation (safety) */
    function stopDonutAnimation() {
        if (donutAnimFrame) {
            cancelAnimationFrame(donutAnimFrame);
            donutAnimFrame = null;
        }
        if (donutAnimSafetyTimer) {
            clearTimeout(donutAnimSafetyTimer);
            donutAnimSafetyTimer = null;
        }
        donutAnimState = 'idle';
        donutAnimTarget = null;
        donutAnimProgress = 0;
    }

    // ═══════════════════════════════════════════════════════════
    // INSIGHT RECTANGLE — replaces donut for Score & Insights selections
    // ═══════════════════════════════════════════════════════════

    /** Show the insight rectangle overlay, hiding the donut SVG and center text.
     *  @param {string} type — 'stable' | 'fastest' | 'data-bytessent' | 'data-bytesrecv'
     *  @param {Object} data — insight-specific data */
    function showInsightRect(type, data) {
        if (!insightRectEl) return;

        var provColor = data.color || '#d29922';
        var borderColor = provColor;

        // Build the title, icon, and content based on insight type
        var icon = '', title = '', provName = '', statLine = '', metaLine = '';

        if (type === 'stable') {
            icon = '\u23f3';
            title = 'Most Stable Network';
            provName = data.provName || '';
            var peerCount = data.peerIds ? data.peerIds.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = 'avg ' + (data.durText || '');
        } else if (type === 'fastest') {
            icon = '\u26a1';
            title = 'Fastest Connection';
            provName = data.provName || '';
            var peerCount = data.peerIds ? data.peerIds.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = data.avgPing ? data.avgPing.toFixed(1) + ' ms avg' : '';
            if (data.rank) {
                statLine = 'Rank #' + data.rank + ' \u00b7 ' + statLine;
            }
        } else if (type === 'data-bytessent') {
            icon = '\u2b06\ufe0f';
            title = 'Most Data Sent To';
            provName = data.provName || '';
            var peerCount = data.peers ? data.peers.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = fmtBytes(data.totalBytes || 0);
            if (data.rank) {
                statLine = 'Rank #' + data.rank + ' \u00b7 ' + statLine;
            }
        } else if (type === 'data-bytesrecv') {
            icon = '\u2b07\ufe0f';
            title = 'Most Data Recv By';
            provName = data.provName || '';
            var peerCount = data.peers ? data.peers.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = fmtBytes(data.totalBytes || 0);
            if (data.rank) {
                statLine = 'Rank #' + data.rank + ' \u00b7 ' + statLine;
            }
        }

        var html = '';
        html += '<div class="as-insight-rect-inner" style="border-color:' + borderColor + '">';
        html += '<div class="as-insight-rect-badge" style="border-color:' + borderColor + '; color:' + borderColor + '">Score &amp; Insights</div>';
        html += '<button class="as-insight-rect-close" title="Back">\u2715</button>';
        html += '<div class="as-insight-rect-content">';
        html += '<div class="as-insight-rect-icon">' + icon + '</div>';
        html += '<div class="as-insight-rect-title">' + escHtml(title) + '</div>';
        html += '<div class="as-insight-rect-provider" style="color:' + provColor + '">' + escHtml(provName) + '</div>';
        html += '<div class="as-insight-rect-meta">' + metaLine + '</div>';
        if (statLine) {
            html += '<div class="as-insight-rect-stat" style="color:' + provColor + '">' + statLine + '</div>';
        }
        html += '</div>';
        html += '</div>';

        insightRectEl.innerHTML = html;

        // Hide donut SVG and center, show rectangle
        if (donutSvg) donutSvg.style.opacity = '0';
        if (donutCenter) donutCenter.style.opacity = '0';
        insightRectEl.classList.add('visible');
        insightRectVisible = true;

        // Bind close button
        var closeBtn = insightRectEl.querySelector('.as-insight-rect-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                hideInsightRect();
                // Clear the insight state and revert
                insightActiveAsNum = null;
                insightActiveType = null;
                animateDonutRevert();
                renderCenter();
                // Restore summary all-lines
                if (summarySelected) {
                    clearSummarySubFilter();
                }
            });
        }
    }

    /** Update the insight rectangle content for a specific peer (hover/select from submenu).
     *  @param {Object} peer — raw peer data
     *  @param {string} provColor — color for the provider */
    function updateInsightRectForPeer(peer, provColor) {
        if (!insightRectEl || !insightRectVisible) return;
        var provEl = insightRectEl.querySelector('.as-insight-rect-provider');
        var metaEl = insightRectEl.querySelector('.as-insight-rect-meta');
        var statEl = insightRectEl.querySelector('.as-insight-rect-stat');

        if (provEl) {
            provEl.textContent = 'Peer #' + peer.id;
            provEl.style.color = provColor;
        }
        if (metaEl) {
            var peerProvName = peer.asname || parseAsOrg(peer.as) || '';
            var asNum = parseAsNumber(peer.as) || '';
            metaEl.textContent = peerProvName + ' \u00b7 ' + asNum;
        }
        if (statEl) {
            var connSec = peer.conntime ? (Math.floor(Date.now() / 1000) - peer.conntime) : 0;
            statEl.textContent = 'Uptime: ' + fmtDuration(connSec);
            statEl.style.color = provColor;
        }
    }

    /** Restore the insight rectangle to its original provider-level content.
     *  Called when mouse leaves a peer in the submenu. */
    function restoreInsightRectProvider() {
        if (!insightRectVisible || !insightActiveType || !insightActiveAsNum) return;
        // Rebuild the rect with the original data
        var data = getInsightDataForActive();
        if (data) showInsightRect(insightActiveType, data);
    }

    /** Get the current insight data for the active insight type/AS */
    function getInsightDataForActive() {
        if (!insightActiveAsNum || !insightActiveType) return null;
        var sumData = computeSummaryData();
        for (var i = 0; i < sumData.insights.length; i++) {
            var ins = sumData.insights[i];
            if (insightActiveType === 'stable' && ins.type === 'stable') {
                return {
                    provName: ins.provName,
                    asNumber: ins.asNumber,
                    peerIds: ins.peerIds,
                    durText: ins.durText,
                    color: getColorForAsNum(ins.asNumber)
                };
            }
            if (insightActiveType === 'fastest' && ins.type === 'fastest' && ins.topProviders) {
                for (var j = 0; j < ins.topProviders.length; j++) {
                    if (ins.topProviders[j].asNumber === insightActiveAsNum) {
                        return {
                            provName: ins.topProviders[j].provName,
                            asNumber: ins.topProviders[j].asNumber,
                            peerIds: ins.topProviders[j].peerIds,
                            avgPing: ins.topProviders[j].avgPing,
                            rank: j + 1,
                            color: ins.topProviders[j].color || getColorForAsNum(ins.topProviders[j].asNumber)
                        };
                    }
                }
            }
            if (ins.type === 'data-providers' && ins.topProviders) {
                var isRecv = insightActiveType === 'data-bytesrecv';
                var isSent = insightActiveType === 'data-bytessent';
                if ((isSent && ins.field === 'bytessent') || (isRecv && ins.field === 'bytesrecv')) {
                    for (var j = 0; j < ins.topProviders.length; j++) {
                        if (ins.topProviders[j].asNumber === insightActiveAsNum) {
                            return {
                                provName: ins.topProviders[j].provName,
                                asNumber: ins.topProviders[j].asNumber,
                                peers: ins.topProviders[j].peers,
                                totalBytes: ins.topProviders[j].totalBytes,
                                rank: j + 1,
                                color: ins.topProviders[j].color || getColorForAsNum(ins.topProviders[j].asNumber)
                            };
                        }
                    }
                }
            }
        }
        return null;
    }

    /** Hide the insight rectangle and restore the donut SVG + center text */
    function hideInsightRect() {
        if (!insightRectEl) return;
        insightRectEl.classList.remove('visible');
        insightRectVisible = false;
        // Show donut SVG and center
        if (donutSvg) donutSvg.style.opacity = '';
        if (donutCenter) donutCenter.style.opacity = '';
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
     *  Layout: DIVERSITY | SCORE: heading | big number | quality word
     *  When AS selected: peer count heading | AS name | percentage */
    function renderCenter() {
        if (!donutCenter) return;

        // If peer detail panel is active, don't touch center text — showPeerInDonutCenter manages it
        if (peerDetailActive) return;

        // If Others scrollable list is open, don't touch center — showOthersListInDonut manages it
        if (othersListOpen) return;

        // In focused mode with hover active, preserve the hover display during data updates
        if (donutFocused && focusedHoverAs && !selectedAs) {
            showFocusedCenterText(focusedHoverAs);
            return;
        }

        // If an insight is active (Most Stable, Fastest, etc.) and no AS is selected,
        // refresh the insight rectangle (it replaces the donut)
        if (insightActiveAsNum && summarySelected && !selectedAs && donutFocused) {
            if (insightRectVisible) {
                // Rect is already visible — refresh its data
                var insData = getInsightDataForActive();
                if (insData) showInsightRect(insightActiveType, insData);
            } else {
                showFocusedCenterText(insightActiveAsNum);
            }
            return;
        }

        var diversityEl = donutCenter.querySelector('.as-score-diversity');
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

                if (diversityEl) diversityEl.style.display = 'none';
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
                scoreLbl.classList.remove('as-summary-link');
                return;
            }
        }

        // Reset any selected-mode styling
        scoreVal.className = 'as-score-value';
        scoreVal.style.color = '';
        if (diversityEl) diversityEl.style.display = '';
        if (headingEl) {
            headingEl.style.color = '';
        }
        if (qualityEl) {
            qualityEl.style.color = '';
        }

        // Edge case: no locatable peers (all private/tor/i2p/cjdns)
        if (totalPeers === 0) {
            if (diversityEl) diversityEl.style.display = 'none';
            if (headingEl) headingEl.textContent = '';
            if (qualityEl) {
                qualityEl.textContent = '';
                qualityEl.className = 'as-score-quality q-nodata';
            }
            scoreVal.textContent = '\u2014';
            scoreVal.title = 'No AS data available \u2014 all peers are on private or anonymous networks';
            scoreLbl.textContent = 'NO DATA';
            scoreLbl.classList.remove('as-summary-link');
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

        // Label just shows quality word below - no "DIVERSITY SUMMARY" text needed
        scoreLbl.textContent = '';
        scoreLbl.classList.remove('as-summary-link');
        scoreLbl.classList.remove('as-summary-active');
    }

    /** Render the legend */
    function renderLegend() {
        if (!legendEl) return;
        var html = '';

        // When a provider is hovered in the panel, show only that provider in the legend
        var focusAs = legendFocusAs || (summarySelected && subSubTooltipPinned && subSubFilterAsNum ? subSubFilterAsNum : null);
        if (focusAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === focusAs; });
            if (seg) {
                var displayName = seg.isOthers ? seg.asName : (seg.asShort || seg.asName || seg.asNumber);
                var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                html += '<div class="as-legend-item highlighted" data-as="' + seg.asNumber + '">';
                html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
                html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
                html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
                html += '</div>';
            } else {
                // Provider is inside Others — show its actual name, not "Others"
                var grp = asGroups.find(function (g) { return g.asNumber === focusAs; });
                if (grp) {
                    var color = getColorForAsNum(focusAs);
                    var displayName = grp.asShort || grp.asName || grp.asNumber;
                    var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                    html += '<div class="as-legend-item highlighted" data-as="' + focusAs + '">';
                    html += '<span class="as-legend-dot" style="background:' + color + '"></span>';
                    html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                    html += '<span class="as-legend-count">' + grp.peerCount + '</span>';
                    html += '<span class="as-legend-pct">' + (totalPeers > 0 ? (grp.peerCount / totalPeers * 100).toFixed(0) : 0) + '%</span>';
                    html += '</div>';
                }
            }
        } else if (selectedAs) {
            // When an AS is clicked (selected), show only that provider in the legend
            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            if (!seg) {
                // Selected AS might be a sub-provider inside Others
                var grp = asGroups.find(function (g) { return g.asNumber === selectedAs; });
                if (grp) {
                    var color = getColorForAsNum(selectedAs);
                    var displayName = grp.asShort || grp.asName || grp.asNumber;
                    var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                    html += '<div class="as-legend-item selected" data-as="' + selectedAs + '">';
                    html += '<span class="as-legend-dot" style="background:' + color + '"></span>';
                    html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                    html += '<span class="as-legend-count">' + grp.peerCount + '</span>';
                    html += '<span class="as-legend-pct">' + (totalPeers > 0 ? (grp.peerCount / totalPeers * 100).toFixed(0) : 0) + '%</span>';
                    html += '</div>';
                }
            } else {
                var displayName = seg.isOthers ? seg.asName : (seg.asShort || seg.asName || seg.asNumber);
                var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                html += '<div class="as-legend-item selected" data-as="' + seg.asNumber + '">';
                html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
                html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
                html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
                html += '</div>';
            }
        } else {
            // Default state: show "TOP 8" header + all segments
            html += '<div class="as-legend-header">TOP ' + Math.min(MAX_SEGMENTS, donutSegments.length) + '</div>';
            for (var i = 0; i < donutSegments.length; i++) {
                var seg = donutSegments[i];
                var displayName = seg.isOthers ? seg.asName : (seg.asShort || seg.asName || seg.asNumber);
                var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;

                html += '<div class="as-legend-item" data-as="' + seg.asNumber + '">';
                html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
                html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
                html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
                html += '</div>';
            }
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

    /** Focus the legend on a single provider (used during panel hover/click) */
    function setLegendFocus(asNum) {
        if (legendFocusAs === asNum) return;
        legendFocusAs = asNum;
        renderLegend();
    }

    /** Clear the legend focus, returning to normal display */
    function clearLegendFocus() {
        if (!legendFocusAs) return;
        if (subSubTooltipPinned) return; // Don't clear while sub-sub is pinned
        legendFocusAs = null;
        renderLegend();
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
        peerDetailActive = false;
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        var fullGroup;

        if (seg) {
            fullGroup = seg.isOthers ? seg : asGroups.find(function (g) { return g.asNumber === asNum; });
        } else {
            // Not a donut segment — find in asGroups (e.g. an "Others" sub-provider)
            fullGroup = asGroups.find(function (g) { return g.asNumber === asNum; });
            if (fullGroup) {
                seg = {
                    asNumber: fullGroup.asNumber,
                    asName: fullGroup.asName,
                    asShort: fullGroup.asShort,
                    peerCount: fullGroup.peerCount,
                    percentage: fullGroup.percentage,
                    color: getColorForAsNum(asNum),
                    riskLevel: fullGroup.riskLevel,
                    riskLabel: fullGroup.riskLabel,
                    peerIds: fullGroup.peerIds,
                    isOthers: false,
                    hostingLabel: fullGroup.hostingLabel,
                };
            }
        }
        if (!seg || !fullGroup) return;

        // Render back button
        renderBackButton();

        // Build header
        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        if (asnEl) {
            asnEl.textContent = seg.isOthers ? 'Others' : seg.asNumber;
            asnEl.classList.remove('as-summary-title');
        }
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
            html += interactiveRow('Total', fullGroup.peerCount, fullGroup.peerIds, 'conntype');

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
        attachPanelBlankClickHandler(bodyEl);

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

    // ═══════════════════════════════════════════════════════════
    // SUMMARY ANALYSIS PANEL
    // ═══════════════════════════════════════════════════════════

    /** Open the Summary Analysis panel (reuses the same #as-detail-panel) */
    function openSummaryPanel() {
        if (!panelEl) return;
        peerDetailActive = false;
        var data = computeSummaryData();

        // Render back button (hidden for summary unless navigated from provider)
        renderBackButton();

        // --- Header ---
        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        if (asnEl) {
            asnEl.innerHTML = '<span style="color:var(--logo-primary, #4a90d9)">PEER ISP</span><br><span style="color:var(--logo-accent, #7ec8e3)">DIVERSITY</span> <span style="color:var(--logo-primary, #4a90d9)">SUMMARY</span>';
            asnEl.classList.add('as-summary-title');
        }
        // Clickable provider count in header (no peer count)
        if (orgEl) {
            orgEl.innerHTML = '<span class="as-panel-link as-all-providers-link" title="View all providers">'
                + data.uniqueProviders + ' unique providers</span>';
        }

        if (metaEl) {
            metaEl.innerHTML = '<span class="as-detail-type-badge">' + data.quality.word + '</span>';
        }

        // Score bar (diversity score 0-10 → percentage 0-100)
        var scorePct = (data.score / 10) * 100;
        var scoreTooltip = buildScoreTooltip(data.score);
        if (barFill) {
            barFill.style.width = scorePct.toFixed(1) + '%';
            barFill.style.background = data.score >= 8 ? 'var(--ok)' : data.score >= 6 ? 'var(--ok-bright)' : data.score >= 4 ? 'var(--warn)' : 'var(--err)';
        }
        if (pctEl) { pctEl.textContent = 'Score: ' + data.score.toFixed(1) + ' / 10'; pctEl.title = scoreTooltip; }
        if (riskEl) {
            riskEl.className = 'as-detail-risk';
            riskEl.textContent = '';
        }

        // --- Body ---
        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;

        var html = '';

        // ── Section 1: Score + Insights ──
        html += '<div class="modal-section-title" title="Diversity score based on Herfindahl\u2013Hirschman Index (HHI). Higher score = more evenly distributed peers across providers.">Score &amp; Insights</div>';
        html += '<div class="modal-row"><span class="modal-label" title="' + scoreTooltip.replace(/"/g, '&quot;') + '">Diversity Score</span><span class="modal-val">' + data.score.toFixed(1) + ' / 10</span></div>';
        html += '<div class="modal-row"><span class="modal-label" title="Quality rating based on the diversity score">Quality</span><span class="modal-val">' + data.quality.word + '</span></div>';
        html += '<div class="modal-row"><span class="modal-label" title="Number of distinct Autonomous Systems (AS/ISPs) your peers connect through">Unique Providers</span>'
             + '<span class="modal-val as-panel-link as-all-providers-link" title="View all providers">' + data.uniqueProviders + '</span></div>';
        if (data.topProvider) {
            var topName = data.topProvider.asShort || data.topProvider.asNumber;
            html += '<div class="modal-row"><span class="modal-label" title="The AS provider with the most peers connected to your node">Top Provider</span>'
                 + '<span class="modal-val as-panel-link as-navigate-provider" data-as="' + data.topProvider.asNumber + '" title="View ' + topName + ' panel">'
                 + topName + ' (' + data.topProvider.peerCount + ')</span></div>';
        }

        // Dynamic insights — each is a simple label row with hover/click sub-panel
        for (var ii = 0; ii < data.insights.length; ii++) {
            var ins = data.insights[ii];
            html += '<div class="as-summary-insight">';
            html += '<span class="as-insight-icon">' + ins.icon + '</span>';
            if (ins.type === 'stable') {
                var stablePeerJson = JSON.stringify(ins.peerIds).replace(/"/g, '&quot;');
                html += '<span class="as-insight-text as-panel-link as-stable-link" data-as="' + ins.asNumber + '" data-peer-ids="' + stablePeerJson + '">Most stable: ' + ins.provName + ' (avg ' + ins.durText + ')</span>';
            } else if (ins.type === 'fastest') {
                html += '<span class="as-insight-text as-panel-link as-fastest-link" title="Providers ranked by average ping time">Fastest connection <span style="color:var(--text-muted)">(by rank)</span></span>';
            } else if (ins.type === 'data-providers') {
                html += '<span class="as-insight-text as-panel-link as-data-providers-link" data-field="' + ins.field + '" title="Providers ranked by total bytes">' + ins.label + '</span>';
            } else {
                html += '<span class="as-insight-text">' + ins.text + '</span>';
            }
            html += '</div>';
        }

        // ── Section 2: Connections by Provider (3 rows per provider) ──
        html += '<div class="modal-section-title" title="Inbound and outbound peer connections grouped by AS provider. Click provider name to view its panel, click IN/OUT to see peer lists.">Connections by Provider</div>';
        for (var gi = 0; gi < data.connectionGrid.length; gi++) {
            var gItem = data.connectionGrid[gi];
            var totalJson = JSON.stringify(gItem.totalPeerIds).replace(/"/g, '&quot;');
            var inJson = JSON.stringify(gItem.inPeerIds).replace(/"/g, '&quot;');
            var outJson = JSON.stringify(gItem.outPeerIds).replace(/"/g, '&quot;');
            var outSubJson = JSON.stringify(gItem.outSubtypes).replace(/"/g, '&quot;');
            // Provider name row (total) — click pins sub-tooltip, "Open provider panel" link inside navigates
            html += '<div class="as-detail-sub-row as-conn-prov-row" data-peer-ids="' + totalJson + '" data-as="' + gItem.asNumber + '" style="cursor:pointer">';
            html += '<span class="as-detail-sub-label"><span class="as-grid-dot" style="background:' + gItem.color + '; display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle"></span>';
            html += '<span style="color:' + gItem.color + '">' + gItem.name + '</span></span>';
            html += '<span class="as-detail-sub-val">' + gItem.totalCount + '</span>';
            html += '</div>';
            // In row
            if (gItem.inCount > 0) {
                html += '<div class="as-detail-sub-row as-interactive-row as-conn-dir-row" data-peer-ids="' + inJson + '" data-as="' + gItem.asNumber + '" data-category="conntype" style="padding-left:22px">';
                html += '<span class="as-detail-sub-label">In</span>';
                html += '<span class="as-detail-sub-val">' + gItem.inCount + '</span>';
                html += '</div>';
            }
            // Out row
            if (gItem.outCount > 0) {
                html += '<div class="as-detail-sub-row as-conn-out-row" data-peer-ids="' + outJson + '" data-as="' + gItem.asNumber + '" data-out-subtypes="' + outSubJson + '" data-category="conntype" style="padding-left:22px; cursor:pointer">';
                html += '<span class="as-detail-sub-label">Out</span>';
                html += '<span class="as-detail-sub-val">' + gItem.outCount + '</span>';
                html += '</div>';
            }
        }

        // ── Section 3: Networks ──
        html += '<div class="modal-section-title" title="Peer connections grouped by network protocol. IPv4/IPv6 are clearnet, Tor/I2P/CJDNS are anonymous overlay networks.">Networks</div>';
        for (var ni = 0; ni < data.networks.length; ni++) {
            var net = data.networks[ni];
            html += summaryInteractiveRow(net.label, net.peerCount + 'p / ' + net.providerCount + 'prov', net);
        }

        // ── Section 4: Hosting ──
        html += '<div class="modal-section-title" title="Peer connections grouped by hosting type. Cloud/Hosting = datacenter, Residential = home ISP, Proxy/VPN = anonymizing relay, Mobile = cellular.">Hosting</div>';
        for (var hi = 0; hi < data.hosting.length; hi++) {
            var host = data.hosting[hi];
            html += summaryInteractiveRow(host.label, host.peerCount + 'p / ' + host.providerCount + 'prov', host);
        }

        // ── Section 5: Countries ──
        html += '<div class="modal-section-title" title="Geographic distribution of peers by country, with provider count showing how many distinct AS providers operate in each country.">Countries</div>';
        for (var ci = 0; ci < data.countries.length; ci++) {
            var country = data.countries[ci];
            html += summaryInteractiveRow(country.label, country.peerCount + 'p / ' + country.providerCount + 'prov', country);
        }

        // ── Section 6: Software ──
        html += '<div class="modal-section-title" title="Bitcoin Core client versions running on your peers, grouped by user agent string. Multiple versions is healthy for network resilience.">Software</div>';
        for (var si = 0; si < data.software.length; si++) {
            var sw = data.software[si];
            html += summaryInteractiveRow(sw.label, sw.peerCount + 'p / ' + sw.providerCount + 'prov', sw);
        }

        // ── Section 7: Services ──
        html += '<div class="modal-section-title" title="Service flag combinations advertised by peers. N=Full Chain, W=SegWit, NL=Pruned, P=BIP324 v2, CF=Compact Filters, B=Bloom.">Services</div>';
        for (var svi = 0; svi < data.services.length; svi++) {
            var svc = data.services[svi];
            html += summaryInteractiveRow(svc.label, svc.peerCount + 'p / ' + svc.providerCount + 'prov', svc);
        }

        bodyEl.innerHTML = html;

        // Attach drill-down handlers for summary rows
        attachSummaryRowHandlers(bodyEl);
        attachGridHandlers(bodyEl);
        attachSummaryLinkHandlers(bodyEl);
        attachPanelBlankClickHandler(bodyEl);

        // Show panel
        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    /** Build a summary interactive row that drills down to providers.
     *  Stores provider data in a data attribute for the click handler. */
    function summaryInteractiveRow(label, value, catData) {
        var providersJson = JSON.stringify(catData.providers.map(function (prov) {
            return { a: prov.asNumber, n: prov.name, c: prov.color, pc: prov.peerCount, pi: prov.peerIds };
        })).replace(/"/g, '&quot;');
        var peerIdsJson = JSON.stringify(catData.peerIds).replace(/"/g, '&quot;');
        return '<div class="as-detail-sub-row as-interactive-row as-summary-row" data-peer-ids="' + peerIdsJson + '" data-providers="' + providersJson + '" data-cat-label="' + label.replace(/"/g, '&quot;') + '">'
             + '<span class="as-detail-sub-label">' + label + '</span>'
             + '<span class="as-detail-sub-val">' + value + '</span>'
             + '</div>';
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
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
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

    /** Attach hover handlers to individual peer rows inside a tooltip element.
     *  On hover: draws a line to just that one peer and filters the table/map.
     *  On leave: restores the parent filter (summary or provider mode). */
    function attachPeerRowHoverHandlers(tip) {
        var peerRows = tip.querySelectorAll('.as-sub-tt-peer[data-peer-id]');
        for (var pri = 0; pri < peerRows.length; pri++) {
            (function (row) {
                row.addEventListener('mouseenter', function () {
                    var peerId = parseInt(row.dataset.peerId);
                    if (isNaN(peerId)) return;
                    hoveredPeerId = peerId; // Track for update preservation
                    if (summarySelected) {
                        previewSummaryLines([peerId]);
                    } else if (selectedAs) {
                        previewProviderLines([peerId]);
                    }
                    // In focused mode, show peer info in donut center or update insight rect
                    if (donutFocused) {
                        var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                        if (peer) {
                            var asNum = row.dataset.as || parseAsNumber(peer.as);
                            var color = asNum ? getColorForAsNum(asNum) : '#6e7681';
                            if (insightRectVisible) {
                                updateInsightRectForPeer(peer, color);
                            } else {
                                showPeerInDonutCenter(peer, color);
                                // Keep donut expanded for the provider context
                                if (subFilterCategory && subFilterCategory.indexOf('conn-') === 0 && subFilterLabel) {
                                    animateDonutExpand(subFilterLabel);
                                }
                            }
                        }
                    }
                });
                row.addEventListener('mouseleave', function () {
                    hoveredPeerId = null; // Clear hover tracking
                    if (summarySelected) {
                        restoreSummaryFromPreview();
                    } else if (selectedAs) {
                        restoreProviderFromPreview();
                    }
                    // In focused mode, restore center to provider/score
                    if (donutFocused) {
                        if (insightRectVisible) {
                            restoreInsightRectProvider();
                        } else if (subFilterCategory && subFilterCategory.indexOf('conn-') === 0 && subFilterLabel) {
                            // Restore donut to show the provider (keep expanded)
                            showFocusedCenterText(subFilterLabel);
                            animateDonutExpand(subFilterLabel);
                        } else if (selectedAs) {
                            renderCenter();
                        } else if (!othersListOpen) {
                            renderCenter();
                        }
                    }
                });
            })(peerRows[pri]);
        }
    }

    /** Attach expand/collapse and peer-click handlers to the sub-tooltip after rendering */
    function attachSubTooltipHandlers() {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;

        // Peer ID click → zoom to peer on map and open the large peer detail popup
        var idLinks = tip.querySelectorAll('.as-sub-tt-id-link');
        for (var li = 0; li < idLinks.length; li++) {
            (function (link) {
                link.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerId = parseInt(link.dataset.peerId);
                    if (isNaN(peerId)) return;
                    // Zoom to peer on map — panel stays open for navigation
                    if (_zoomToPeerOnly) _zoomToPeerOnly(peerId);
                    // Find the peer data and open the large popup
                    var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                    if (peer) {
                        openPeerDetailPanel(peer, 'panel');
                    }
                });
            })(idLinks[li]);
        }

        // Peer row hover → preview line to individual peer
        attachPeerRowHoverHandlers(tip);

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

    /** Clicking blank space in the panel body closes any open sub-panels */
    function attachPanelBlankClickHandler(bodyEl) {
        bodyEl.addEventListener('click', function (e) {
            // Only close if clicking on the body itself, not on interactive children
            if (e.target === bodyEl || e.target.classList.contains('modal-section-title') ||
                e.target.classList.contains('modal-row') || e.target.classList.contains('modal-label') ||
                e.target.classList.contains('modal-val')) {
                if (subTooltipPinned || subSubTooltipPinned) {
                    hideSubTooltip();
                    hideSubSubTooltip();
                    if (summarySelected) {
                        subFilterPeerIds = null;
                        subFilterLabel = null;
                        subFilterCategory = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        activateHoverAll();
                        var rows = bodyEl.querySelectorAll('.sub-filter-active');
                        for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                    } else if (selectedAs) {
                        clearSubFilter();
                    }
                }
            }
        });
    }

    /** Attach hover and click handlers to interactive rows in the detail panel */
    function attachInteractiveRowHandlers(bodyEl, seg) {
        var rows = bodyEl.querySelectorAll('.as-interactive-row');
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    if (subTooltipPinned) {
                        var category = rowEl.dataset.category;
                        var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                        var html = buildPeerSummaryHtml(peerIds, category, label);
                        showHoverPreview(html, e);
                        // Preview lines/filter for hovered sub-row
                        previewProviderLines(peerIds);
                        return;
                    }
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    var html = buildPeerSummaryHtml(peerIds, category, label);
                    showSubTooltip(html, e);
                    // Preview lines/filter for hovered sub-row
                    previewProviderLines(peerIds);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (subTooltipPinned) {
                        restorePinnedSubTooltip();
                        restoreProviderFromPreview();
                        return;
                    }
                    hideSubTooltip();
                    restoreProviderFromPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    // Toggle: clicking same row unpins
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        clearSubFilter();
                        return;
                    }
                    applySubFilter(peerIds, category, label);
                    var html = buildPeerSummaryHtml(peerIds, category, label);
                    showSubTooltip(html, e);
                    pinSubTooltip(html, rowEl, null);
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
        pinnedSubTooltipHtml = null;
        pinnedSubTooltipSrc = null;
        pinnedSubTooltipSetup = null;
        hideSubSubTooltip();
    }

    /** Pin the sub-tooltip: store HTML and source for hover-preview restore */
    function pinSubTooltip(html, srcEl, setupFn) {
        subTooltipPinned = true;
        pinnedSubTooltipHtml = html;
        pinnedSubTooltipSrc = srcEl || null;
        pinnedSubTooltipSetup = setupFn || null;
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) tip.style.pointerEvents = 'auto';
    }

    /** Show a hover preview over a pinned sub-tooltip (temporary replacement) */
    function showHoverPreview(html, event) {
        hideSubSubTooltip();
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        positionSubTooltip(event);
        attachSubTooltipHandlers();
    }

    /** Restore the pinned sub-tooltip after a hover preview ends */
    function restorePinnedSubTooltip() {
        if (!subTooltipPinned || !pinnedSubTooltipHtml) return;
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;
        tip.innerHTML = pinnedSubTooltipHtml;
        tip.style.pointerEvents = 'auto';
        if (pinnedSubTooltipSetup) pinnedSubTooltipSetup(tip);
        attachSubTooltipHandlers();
    }

    // ═══════════════════════════════════════════════════════════
    // SUB-SUB-TOOLTIP — Third-level drill-down (Provider → Peers)
    // ═══════════════════════════════════════════════════════════

    /** Show the sub-sub-tooltip with peer list for a specific provider */
    function showSubSubTooltip(html, event) {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'as-sub-sub-tooltip';
            tip.className = 'as-sub-tooltip as-sub-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        tip.style.pointerEvents = 'auto';
        positionSubSubTooltip(event);
        attachSubSubTooltipHandlers();
    }

    function positionSubSubTooltip(event) {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) return;
        var subTip = document.getElementById('as-sub-tooltip');
        var rect = tip.getBoundingClientRect();
        var pad = 12;
        // Position to the left of the sub-tooltip
        var anchor = subTip ? subTip.getBoundingClientRect() : (panelEl ? panelEl.getBoundingClientRect() : { left: window.innerWidth });
        var x = anchor.left - rect.width - pad;
        if (x < pad) x = pad;
        var y = event ? event.clientY - rect.height / 2 : anchor.top;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hideSubSubTooltip() {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (tip) {
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        subSubTooltipPinned = false;
        subSubFilterPeerIds = null;
        subSubFilterAsNum = null;
        subSubFilterColor = null;
        // Clear legend focus when sub-sub dismisses
        if (legendFocusAs) {
            legendFocusAs = null;
            renderLegend();
        }
    }

    /** Attach peer-click and expand handlers to the sub-sub-tooltip */
    function attachSubSubTooltipHandlers() {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) return;

        // Peer ID click → zoom to peer on map and open the large peer detail popup
        var idLinks = tip.querySelectorAll('.as-sub-tt-id-link');
        for (var li = 0; li < idLinks.length; li++) {
            (function (link) {
                link.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerId = parseInt(link.dataset.peerId);
                    if (isNaN(peerId)) return;
                    // Zoom to peer on map — panel stays open for navigation
                    if (_zoomToPeerOnly) _zoomToPeerOnly(peerId);
                    // Find the peer data and open the large popup
                    var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                    if (peer) {
                        openPeerDetailPanel(peer, 'panel');
                    }
                });
            })(idLinks[li]);
        }

        // Peer row hover → preview line to individual peer
        attachPeerRowHoverHandlers(tip);

        var showMore = tip.querySelector('.as-sub-tt-show-more');
        var showLess = tip.querySelector('.as-sub-tt-show-less');
        if (!showMore || !showLess) return;

        showMore.addEventListener('click', function (e) {
            e.stopPropagation();
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) extras[i].style.display = '';
            showMore.style.display = 'none';
            showLess.style.display = '';
            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.add('as-sub-tt-expanded');
        });

        showLess.addEventListener('click', function (e) {
            e.stopPropagation();
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) extras[i].style.display = 'none';
            showLess.style.display = 'none';
            showMore.style.display = '';
            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.remove('as-sub-tt-expanded');
        });
    }

    /** Build peer list HTML with rank numbers for the sub-tooltip.
     *  peerEntries: [{peer, duration}] — sorted by duration desc */
    function buildRankedPeerListHtml(peerEntries) {
        var html = '';
        var initialShow = 6;
        var hasMore = peerEntries.length > initialShow;

        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < peerEntries.length; pi++) {
            var ep = peerEntries[pi];
            var p = ep.peer;
            var ct = p.connection_type || 'unknown';
            var ctLabel = CONN_TYPE_LABELS[ct] || ct;
            var peerAs = parseAsNumber(p.as) || '';
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + p.id + '" data-as="' + peerAs + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '" style="min-width:70px">#' + (pi + 1) + ' ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + fmtDuration(ep.duration) + '</span>';
            html += '<span class="as-sub-tt-loc">' + ctLabel + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = peerEntries.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Build provider list HTML for the sub-tooltip in summary drill-down mode.
     *  providers: [{asNumber, name, color, peerCount, peerIds, peers}] */
    function buildProviderListHtml(providers, catLabel) {
        var html = '';
        html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + catLabel + '</div>';
        html += '</div>';

        html += '<div class="as-sub-tt-scroll">';
        for (var i = 0; i < providers.length; i++) {
            var prov = providers[i];
            var peerIdsJson = JSON.stringify(prov.peerIds || prov.pi).replace(/"/g, '&quot;');
            html += '<div class="as-sub-tt-peer as-provider-row" data-as="' + (prov.asNumber || prov.a) + '" data-peer-ids="' + peerIdsJson + '">';
            html += '<span class="as-grid-dot" style="background:' + (prov.color || prov.c) + '"></span>';
            html += '<span class="as-sub-tt-id as-provider-click" style="cursor:pointer">' + (prov.asNumber || prov.a) + '</span>';
            var name = (prov.name || prov.n || '');
            if (name.length > 18) name = name.substring(0, 17) + '\u2026';
            html += '<span class="as-sub-tt-loc" title="' + (prov.name || prov.n || '') + '">' + name + '</span>';
            html += '<span class="as-sub-tt-type">' + (prov.peerCount || prov.pc) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    /** Build peer list HTML for the sub-sub-tooltip */
    function buildPeerListHtmlForSubSub(peers) {
        var html = '';
        var initialShow = 6;
        var hasMore = peers.length > initialShow;

        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var ct = p.connection_type || 'unknown';
            var ctLabel = CONN_TYPE_LABELS[ct] || ct;
            var loc = (p.city || '') + (p.city && p.country ? ', ' : '') + (p.country || '');
            if (loc.length > 16) loc = loc.substring(0, 15) + '\u2026';
            var peerAs = parseAsNumber(p.as) || '';
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + p.id + '" data-as="' + peerAs + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + ctLabel + '</span>';
            if (loc) html += '<span class="as-sub-tt-loc">' + loc + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = peers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // HOVER PREVIEW HELPERS — draw lines and filter peer table
    // without changing sub-filter state, purely visual preview
    // ═══════════════════════════════════════════════════════════

    /** Preview lines/filter for a set of peer IDs in summary mode (grouped by AS) */
    function previewSummaryLines(peerIds) {
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        if (_drawLinesForAllAs && donutSegments.length > 0) {
            var idSet = {};
            for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
            var groups = [];
            for (var si = 0; si < donutSegments.length; si++) {
                var seg = donutSegments[si];
                var filteredIds = [];
                for (var pi = 0; pi < seg.peerIds.length; pi++) {
                    if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                }
                if (filteredIds.length > 0) {
                    groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                }
            }
            _drawLinesForAllAs(groups);
        }
    }

    /** Preview lines/filter for a set of peer IDs in provider mode (single AS) */
    function previewProviderLines(peerIds) {
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        if (selectedAs && _drawLinesForAs) {
            var color = getColorForAsNum(selectedAs);
            _drawLinesForAs(selectedAs, peerIds, color);
        }
    }

    /** Restore lines/filter/dim after a hover preview ends (summary mode) */
    function restoreSummaryFromPreview() {
        if (subSubFilterPeerIds && subSubFilterAsNum) {
            // Was showing sub-sub (e.g. a specific provider within a category)
            var ssColor = subSubFilterColor || getColorForAsNum(subSubFilterAsNum);
            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, subSubFilterPeerIds, ssColor);
            if (_filterPeerTable) _filterPeerTable(subSubFilterPeerIds);
            if (_dimMapPeers) _dimMapPeers(subSubFilterPeerIds);
        } else if (subFilterPeerIds && subFilterPeerIds.length > 0) {
            // Was showing a category filter (e.g. IPv6)
            previewSummaryLines(subFilterPeerIds);
        } else if (subTooltipPinned && (subFilterCategory === 'insight-fastest' || (subFilterCategory && subFilterCategory.indexOf('insight-data-') === 0))) {
            // Rank list pinned — default to showing #1 ranked provider
            var tip = document.getElementById('as-sub-tooltip');
            if (tip) {
                var firstRow = tip.querySelector('.as-fastest-prov-row, .as-data-prov-row');
                if (firstRow) {
                    var asNum = firstRow.dataset.as;
                    var peerIds = JSON.parse(firstRow.dataset.peerIds || '[]');
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    if (donutFocused && asNum && insightRectVisible) {
                        restoreInsightRectProvider();
                    } else if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                    return;
                }
            }
            // Fallback: show all
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
        } else if (insightActiveAsNum) {
            // Insight is active (e.g. Most Stable clicked) — restore to showing the insight's provider
            var asNum = insightActiveAsNum;
            var peerIds = getPeerIdsForAnyAs(asNum);
            var color = getColorForAsNum(asNum);
            if (asNum) setLegendFocus(asNum);
            if (peerIds.length > 0 && _drawLinesForAs) {
                _drawLinesForAs(asNum, peerIds, color);
            }
            if (_filterPeerTable) _filterPeerTable(peerIds);
            if (_dimMapPeers) _dimMapPeers(peerIds);
            if (donutFocused && insightRectVisible) {
                restoreInsightRectProvider();
            } else if (donutFocused) {
                showFocusedCenterText(asNum);
                animateDonutExpand(asNum);
            }
        } else {
            // No filter — show all
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
        }
    }

    /** Restore lines/filter/dim after a hover preview ends (provider mode) */
    function restoreProviderFromPreview() {
        if (subFilterPeerIds && subFilterPeerIds.length > 0) {
            previewProviderLines(subFilterPeerIds);
        } else if (selectedAs) {
            var allPeerIds = getPeerIdsForAnyAs(selectedAs);
            var color = getColorForAsNum(selectedAs);
            if (_filterPeerTable) _filterPeerTable(allPeerIds);
            if (_dimMapPeers) _dimMapPeers(allPeerIds);
            if (_drawLinesForAs) _drawLinesForAs(selectedAs, allPeerIds, color);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY DRILL-DOWN HANDLERS
    // ═══════════════════════════════════════════════════════════

    /** Attach hover/click handlers to summary interactive rows (sections 3-7).
     *  These rows drill down to provider list, not peer list. */
    function attachSummaryRowHandlers(bodyEl) {
        var rows = bodyEl.querySelectorAll('.as-summary-row');
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    if (subTooltipPinned) {
                        // Hover preview over pinned tooltip
                        var providers = JSON.parse(rowEl.dataset.providers);
                        var catLabel = rowEl.dataset.catLabel;
                        var html = buildProviderListHtml(providers, catLabel);
                        showHoverPreview(html, e);
                        // Preview lines/filter for hovered category
                        previewSummaryLines(peerIds);
                        return;
                    }
                    var providers = JSON.parse(rowEl.dataset.providers);
                    var catLabel = rowEl.dataset.catLabel;
                    var html = buildProviderListHtml(providers, catLabel);
                    showSubTooltip(html, e);
                    // Preview lines/filter for hovered category
                    previewSummaryLines(peerIds);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (subTooltipPinned) {
                        restorePinnedSubTooltip();
                        restoreSummaryFromPreview();
                        return;
                    }
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var providers = JSON.parse(rowEl.dataset.providers);
                    var catLabel = rowEl.dataset.catLabel;

                    // Toggle: clicking same row unpins
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        clearSummarySubFilter();
                        return;
                    }

                    // Apply sub-filter for all peers in this category
                    applySummarySubFilter(peerIds, catLabel);

                    // Pin the sub-tooltip with provider list
                    var html = buildProviderListHtml(providers, catLabel);
                    showSubTooltip(html, e);
                    pinSubTooltip(html, rowEl, function (tip) {
                        attachProviderClickHandlers(tip);
                    });
                    attachProviderClickHandlers(document.getElementById('as-sub-tooltip'));
                });
            })(rows[ri]);
        }
    }

    /** Attach click handlers for provider rows in the sub-tooltip (summary mode).
     *  Hovering previews lines on the map; clicking opens the sub-sub-tooltip with that provider's peers. */
    function attachProviderClickHandlers(tip) {
        var provRows = tip.querySelectorAll('.as-provider-row');
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                // Hover preview: show lines + filter for this provider's peers
                provRow.addEventListener('mouseenter', function () {
                    var asNum = provRow.dataset.as;
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                provRow.addEventListener('mouseleave', function () {
                    clearLegendFocus();
                    restoreSummaryFromPreview();
                    // In focused mode, revert donut animation
                    if (donutFocused) {
                        animateDonutRevert();
                        renderCenter();
                    }
                });
                provRow.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(provRow.dataset.peerIds);

                    // Find matching peer objects from lastPeersRaw
                    var idSet = {};
                    for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                    var matchedPeers = [];
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }

                    var asNum = provRow.dataset.as;
                    // Keep legend focused on this provider while sub-sub is pinned
                    legendFocusAs = asNum;
                    renderLegend();

                    var html = buildPeerListHtmlForSubSub(matchedPeers);
                    showSubSubTooltip(html, e);
                    subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    subSubFilterPeerIds = peerIds;
                    subSubFilterAsNum = asNum;
                    subSubFilterColor = getColorForAsNum(asNum);

                    // Draw lines for just this provider's peers
                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                });
            })(provRows[pi]);
        }
    }

    /** Attach handlers for the Connections by Provider section (Section 2 of summary panel) */
    function attachGridHandlers(bodyEl) {
        // Provider total rows — hover/click shows all peers for this provider
        var connProvRows = bodyEl.querySelectorAll('.as-conn-prov-row');
        for (var cpi = 0; cpi < connProvRows.length; cpi++) {
            (function (rowEl) {
                function buildProvPeerHtml() {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    if (peerIds.length === 0) return null;
                    var asNum = rowEl.dataset.as;
                    var idSet = {};
                    for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                    var matchedPeers = [];
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    // Find the provider name for the header
                    var provName = asNum;
                    var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                    if (grp) provName = grp.asShort || grp.asName || asNum;
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + provName + ' Peers</div>';
                    html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + asNum + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
                    html += '</div>';
                    html += buildPeerListHtmlForSubSub(matchedPeers);
                    return html;
                }
                rowEl.addEventListener('mouseenter', function (e) {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var asNum = rowEl.dataset.as;
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (subTooltipPinned) {
                        var html = buildProvPeerHtml();
                        if (html) showHoverPreview(html, e);
                    } else {
                        var html = buildProvPeerHtml();
                        if (html) showSubTooltip(html, e);
                    }
                    // Preview lines for this provider
                    if (asNum && peerIds.length > 0) {
                        var color = getColorForAsNum(asNum);
                        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                        if (_filterPeerTable) _filterPeerTable(peerIds);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                    }
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    clearLegendFocus();
                    if (subTooltipPinned) {
                        restorePinnedSubTooltip();
                        restoreSummaryFromPreview();
                    } else {
                        hideSubTooltip();
                        restoreSummaryFromPreview();
                    }
                    // In focused mode, revert donut animation
                    if (donutFocused) {
                        animateDonutRevert();
                        renderCenter();
                    }
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
                        return;
                    }
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var html = buildProvPeerHtml();
                    if (!html) return;
                    showSubTooltip(html, e);
                    pinSubTooltip(html, rowEl, function (tip) {
                        attachSubTooltipHandlers();
                        attachProviderNavHandlers(tip);
                    });
                    attachSubTooltipHandlers();
                    var tipEl = document.getElementById('as-sub-tooltip');
                    if (tipEl) attachProviderNavHandlers(tipEl);
                    // Clear any active insight state when selecting a provider
                    if (insightActiveAsNum || insightActiveType) {
                        insightActiveAsNum = null;
                        insightActiveType = null;
                        hideInsightRect();
                    }
                    // Clear all highlights before setting new ones
                    var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    // Track sub-filter state for data refresh preservation
                    var asNum = rowEl.dataset.as;
                    subFilterPeerIds = peerIds;
                    subFilterCategory = 'conn-provider';
                    subFilterLabel = asNum || '';
                    // Draw lines for this provider's peers
                    if (asNum && _drawLinesForAs) {
                        var color = getColorForAsNum(asNum);
                        _drawLinesForAs(asNum, peerIds, color);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // Keep donut expanded for this provider while viewing its peers
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
            })(connProvRows[cpi]);
        }

        // Out rows — hover/click shows outbound subtypes breakdown
        var connOutRows = bodyEl.querySelectorAll('.as-conn-out-row');
        for (var coi = 0; coi < connOutRows.length; coi++) {
            (function (rowEl) {
                function buildOutSubHtml() {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    if (peerIds.length === 0) return null;
                    var subtypes = JSON.parse(rowEl.dataset.outSubtypes);
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Outbound Peers</div>';
                    html += '</div>';
                    html += '<div class="as-sub-tt-scroll">';
                    for (var si = 0; si < subtypes.length; si++) {
                        var st = subtypes[si];
                        html += '<div class="as-sub-tt-peer">';
                        html += '<span class="as-sub-tt-id" style="font-weight:600; min-width:60px">' + st.label + '</span>';
                        html += '<span class="as-sub-tt-type">' + st.count + ' peer' + (st.count !== 1 ? 's' : '') + '</span>';
                        html += '</div>';
                    }
                    html += '</div>';
                    // Also include full peer list below subtypes
                    var idSet = {};
                    for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                    var matchedPeers = [];
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    html += '<div style="border-top:1px solid rgba(88,166,255,0.1); margin-top:4px; padding-top:4px">';
                    html += buildPeerListHtmlForSubSub(matchedPeers);
                    html += '</div>';
                    return html;
                }
                rowEl.addEventListener('mouseenter', function (e) {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var asNum = rowEl.dataset.as;
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (subTooltipPinned) {
                        var html = buildOutSubHtml();
                        if (html) showHoverPreview(html, e);
                    } else {
                        var html = buildOutSubHtml();
                        if (html) showSubTooltip(html, e);
                    }
                    // Preview lines for this provider's outbound peers
                    if (asNum && peerIds.length > 0) {
                        var color = getColorForAsNum(asNum);
                        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                        if (_filterPeerTable) _filterPeerTable(peerIds);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                    }
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    clearLegendFocus();
                    if (subTooltipPinned) {
                        restorePinnedSubTooltip();
                        restoreSummaryFromPreview();
                    } else {
                        hideSubTooltip();
                        restoreSummaryFromPreview();
                    }
                    // In focused mode, revert donut animation unless insight is active
                    if (donutFocused && !insightActiveAsNum) {
                        animateDonutRevert();
                        renderCenter();
                    } else if (donutFocused && insightActiveAsNum) {
                        // Restore to insight provider
                        showFocusedCenterText(insightActiveAsNum);
                        animateDonutExpand(insightActiveAsNum);
                    }
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
                        return;
                    }
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var html = buildOutSubHtml();
                    if (!html) return;
                    showSubTooltip(html, e);
                    pinSubTooltip(html, rowEl, function (tip) { attachSubTooltipHandlers(); });
                    attachSubTooltipHandlers();
                    // Clear insight state
                    if (insightActiveAsNum || insightActiveType) { insightActiveAsNum = null; insightActiveType = null; hideInsightRect(); }
                    var activeBodyOut = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyOut) { var prev = activeBodyOut.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    // Track sub-filter state for data refresh preservation
                    subFilterPeerIds = peerIds;
                    subFilterCategory = 'conn-out';
                    subFilterLabel = rowEl.dataset.as || '';
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // Keep donut expanded for the parent provider
                    var asNum = rowEl.dataset.as;
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
            })(connOutRows[coi]);
        }

        // In rows already have .as-interactive-row class — handled by attachInteractiveRowHandlers if in provider panel,
        // but here in summary we need explicit handling. The .as-conn-dir-row In rows:
        var connDirRows = bodyEl.querySelectorAll('.as-conn-dir-row');
        for (var cdi = 0; cdi < connDirRows.length; cdi++) {
            (function (rowEl) {
                function buildDirPeerHtml() {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    if (peerIds.length === 0) return null;
                    var idSet = {};
                    for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                    var matchedPeers = [];
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Inbound Peers</div>';
                    html += '</div>';
                    html += buildPeerListHtmlForSubSub(matchedPeers);
                    return html;
                }
                rowEl.addEventListener('mouseenter', function (e) {
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var asNum = rowEl.dataset.as;
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (subTooltipPinned) {
                        var html = buildDirPeerHtml();
                        if (html) showHoverPreview(html, e);
                    } else {
                        var html = buildDirPeerHtml();
                        if (html) showSubTooltip(html, e);
                    }
                    // Preview lines for this provider's inbound peers
                    if (asNum && peerIds.length > 0) {
                        var color = getColorForAsNum(asNum);
                        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                        if (_filterPeerTable) _filterPeerTable(peerIds);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                    }
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    clearLegendFocus();
                    if (subTooltipPinned) {
                        restorePinnedSubTooltip();
                        restoreSummaryFromPreview();
                    } else {
                        hideSubTooltip();
                        restoreSummaryFromPreview();
                    }
                    // In focused mode, revert donut animation unless insight is active
                    if (donutFocused && !insightActiveAsNum) {
                        animateDonutRevert();
                        renderCenter();
                    } else if (donutFocused && insightActiveAsNum) {
                        showFocusedCenterText(insightActiveAsNum);
                        animateDonutExpand(insightActiveAsNum);
                    }
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
                        return;
                    }
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var html = buildDirPeerHtml();
                    if (!html) return;
                    showSubTooltip(html, e);
                    pinSubTooltip(html, rowEl, function (tip) { attachSubTooltipHandlers(); });
                    attachSubTooltipHandlers();
                    // Clear insight state
                    if (insightActiveAsNum || insightActiveType) { insightActiveAsNum = null; insightActiveType = null; hideInsightRect(); }
                    var activeBodyIn = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyIn) { var prev = activeBodyIn.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    // Track sub-filter state for data refresh preservation
                    subFilterPeerIds = peerIds;
                    subFilterCategory = 'conn-in';
                    subFilterLabel = rowEl.dataset.as || '';
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // Keep donut expanded for the parent provider
                    var asNum = rowEl.dataset.as;
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
            })(connDirRows[cdi]);
        }
    }

    /** Attach handlers for clickable links in the summary panel (provider nav, peer select, all-providers, longest peers, data insights) */
    function attachSummaryLinkHandlers(bodyEl) {
        // "Navigate to provider" links — hover previews lines to that provider's peers, click navigates
        var navLinks = bodyEl.querySelectorAll('.as-navigate-provider');
        for (var i = 0; i < navLinks.length; i++) {
            (function (el) {
                el.addEventListener('mouseenter', function () {
                    if (subTooltipPinned) return;
                    var asNum = el.dataset.as;
                    if (!asNum) return;
                    // Focus legend on this provider
                    setLegendFocus(asNum);
                    var peerIds = getPeerIdsForAnyAs(asNum);
                    var color = getColorForAsNum(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs) {
                        _drawLinesForAs(asNum, peerIds, color);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                el.addEventListener('mouseleave', function () {
                    if (subTooltipPinned) return;
                    clearLegendFocus();
                    restoreSummaryFromPreview();
                    // In focused mode, revert donut animation unless insight is active
                    if (donutFocused && !insightActiveAsNum) {
                        animateDonutRevert();
                        renderCenter();
                    } else if (donutFocused && insightActiveAsNum) {
                        showFocusedCenterText(insightActiveAsNum);
                        animateDonutExpand(insightActiveAsNum);
                    }
                });
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var asNum = el.dataset.as;
                    if (asNum) navigateToProvider(asNum);
                });
            })(navLinks[i]);
        }

        // "All providers" links — opens sub-tooltip with all providers
        var allProvLinks = bodyEl.querySelectorAll('.as-all-providers-link');
        for (var i = 0; i < allProvLinks.length; i++) {
            (function (el) {
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    // Toggle: clicking same link unpins
                    if (subTooltipPinned && pinnedSubTooltipSrc === el) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
                        return;
                    }
                    var allProvs = asGroups.map(function (g) {
                        return { asNumber: g.asNumber, name: g.asShort || g.asName || g.asNumber, color: getColorForAsNum(g.asNumber), peerCount: g.peerCount, peerIds: g.peerIds, peers: g.peers };
                    });
                    var html = buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                    showSubTooltip(html, e);
                    pinSubTooltip(html, el, function (tip) {
                        attachProviderClickHandlers(tip);
                        attachProviderNavHandlers(tip);
                    });
                    var tip = document.getElementById('as-sub-tooltip');
                    if (tip) {
                        attachProviderClickHandlers(tip);
                        attachProviderNavHandlers(tip);
                    }
                    // Track sub-filter state for data refresh preservation
                    subFilterPeerIds = [];
                    subFilterCategory = 'all-providers';
                    subFilterLabel = 'all-providers';
                });
            })(allProvLinks[i]);
        }

        // Header provider links
        if (panelEl) {
            var headerProvLinks = panelEl.querySelectorAll('.as-detail-header-info .as-all-providers-link');
            for (var i = 0; i < headerProvLinks.length; i++) {
                (function (el) {
                    el.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (subTooltipPinned && pinnedSubTooltipSrc === el) {
                            hideSubTooltip();
                            subFilterPeerIds = null;
                            subFilterCategory = null;
                            subFilterLabel = null;
                            if (_filterPeerTable) _filterPeerTable(null);
                            if (_dimMapPeers) _dimMapPeers(null);
                            if (summarySelected) activateHoverAll();
                            return;
                        }
                        var allProvs = asGroups.map(function (g) {
                            return { asNumber: g.asNumber, name: g.asShort || g.asName || g.asNumber, color: getColorForAsNum(g.asNumber), peerCount: g.peerCount, peerIds: g.peerIds, peers: g.peers };
                        });
                        var html = buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                        showSubTooltip(html, e);
                        pinSubTooltip(html, el, function (tip) {
                            attachProviderClickHandlers(tip);
                            attachProviderNavHandlers(tip);
                        });
                        var tip = document.getElementById('as-sub-tooltip');
                        if (tip) {
                            attachProviderClickHandlers(tip);
                            attachProviderNavHandlers(tip);
                        }
                        // Track sub-filter state for data refresh preservation
                        subFilterPeerIds = [];
                        subFilterCategory = 'all-providers';
                        subFilterLabel = 'all-providers';
                    });
                })(headerProvLinks[i]);
            }
        }

        // "Fastest connection" link — hover shows providers ranked by avg ping, click pins
        var fastestLink = bodyEl.querySelector('.as-fastest-link');
        if (fastestLink) {
            function buildFastestProvHtml() {
                var data = computeSummaryData();
                var fastInsight = null;
                for (var j = 0; j < data.insights.length; j++) {
                    if (data.insights[j].type === 'fastest') { fastInsight = data.insights[j]; break; }
                }
                if (!fastInsight || !fastInsight.topProviders) return null;
                var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Fastest Connection \u2014 Avg Ping</div>';
                html += '</div>';
                html += '<div class="as-sub-tt-scroll">';
                for (var pi = 0; pi < fastInsight.topProviders.length; pi++) {
                    var prov = fastInsight.topProviders[pi];
                    var peerIdsJson = JSON.stringify(prov.peerIds.slice(0, 20)).replace(/"/g, '&quot;');
                    html += '<div class="as-sub-tt-peer as-provider-row as-fastest-prov-row" data-as="' + prov.asNumber + '" data-peer-ids="' + peerIdsJson + '" data-rank="' + (pi + 1) + '" data-avg-ping="' + prov.avgPing.toFixed(1) + '">';
                    html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
                    html += '<span class="as-grid-dot" style="background:' + prov.color + '"></span>';
                    var name = prov.provName.length > 14 ? prov.provName.substring(0, 13) + '\u2026' : prov.provName;
                    html += '<span class="as-sub-tt-loc" title="' + prov.provName + '">' + name + '</span>';
                    html += '<span class="as-sub-tt-type">' + Math.round(prov.avgPing) + 'ms</span>';
                    html += '</div>';
                }
                html += '</div>';
                return html;
            }
            fastestLink.addEventListener('mouseenter', function (e) {
                if (subTooltipPinned) {
                    var html = buildFastestProvHtml();
                    if (html) showHoverPreview(html, e);
                } else {
                    var html = buildFastestProvHtml();
                    if (html) showSubTooltip(html, e);
                }
                // Preview lines for the #1 fastest provider + focus legend
                var data = computeSummaryData();
                for (var j = 0; j < data.insights.length; j++) {
                    if (data.insights[j].type === 'fastest' && data.insights[j].topProviders && data.insights[j].topProviders.length > 0) {
                        var top = data.insights[j].topProviders[0];
                        setLegendFocus(top.asNumber);
                        if (_drawLinesForAs) _drawLinesForAs(top.asNumber, top.peerIds, top.color);
                        if (_filterPeerTable) _filterPeerTable(top.peerIds);
                        if (_dimMapPeers) _dimMapPeers(top.peerIds);
                        // In focused mode, show provider in donut center + animate
                        if (donutFocused) {
                            showFocusedCenterText(top.asNumber);
                            animateDonutExpand(top.asNumber);
                        }
                        break;
                    }
                }
            });
            fastestLink.addEventListener('mouseleave', function () {
                clearLegendFocus();
                if (subTooltipPinned) {
                    restorePinnedSubTooltip();
                    restoreSummaryFromPreview();
                } else {
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                }
                // In focused mode, revert donut if no insight is active
                if (donutFocused && !insightActiveAsNum) {
                    animateDonutRevert();
                    renderCenter();
                } else if (donutFocused && insightActiveAsNum) {
                    showFocusedCenterText(insightActiveAsNum);
                    animateDonutExpand(insightActiveAsNum);
                }
            });
            fastestLink.addEventListener('click', function (e) {
                e.stopPropagation();
                if (subTooltipPinned && pinnedSubTooltipSrc === fastestLink) {
                    hideSubTooltip();
                    fastestLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                    subFilterPeerIds = null;
                    subFilterCategory = null;
                    subFilterLabel = null;
                    insightActiveAsNum = null;
                    insightActiveType = null;
                    hideInsightRect();
                    if (donutFocused) animateDonutRevert();
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (summarySelected) activateHoverAll();
                    renderCenter();
                    return;
                }
                var html = buildFastestProvHtml();
                if (!html) return;
                showSubTooltip(html, e);
                pinSubTooltip(html, fastestLink, function (tip) {
                    attachFastestProvRowHandlers(tip);
                });
                attachFastestProvRowHandlers(document.getElementById('as-sub-tooltip'));
                // Clear any other active highlights before adding ours
                var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                fastestLink.closest('.as-summary-insight').classList.add('sub-filter-active');
                // Track sub-filter state for data refresh preservation
                subFilterPeerIds = [];
                subFilterCategory = 'insight-fastest';
                subFilterLabel = 'fastest';
                // Activate insight donut state — show insight rectangle for #1 fastest provider
                var insData = computeSummaryData();
                for (var ij = 0; ij < insData.insights.length; ij++) {
                    if (insData.insights[ij].type === 'fastest' && insData.insights[ij].topProviders && insData.insights[ij].topProviders.length > 0) {
                        var topProv = insData.insights[ij].topProviders[0];
                        insightActiveAsNum = topProv.asNumber;
                        insightActiveType = 'fastest';
                        if (donutFocused) {
                            showInsightRect('fastest', {
                                provName: topProv.provName,
                                asNumber: topProv.asNumber,
                                peerIds: topProv.peerIds,
                                avgPing: topProv.avgPing,
                                rank: 1,
                                color: topProv.color || getColorForAsNum(topProv.asNumber)
                            });
                        }
                        setLegendFocus(topProv.asNumber);
                        // Also draw lines for #1 provider immediately
                        if (_drawLinesForAs) _drawLinesForAs(topProv.asNumber, topProv.peerIds, topProv.color);
                        if (_filterPeerTable) _filterPeerTable(topProv.peerIds);
                        if (_dimMapPeers) _dimMapPeers(topProv.peerIds);
                        break;
                    }
                }
            });
        }

        // "Most stable" link — hover shows peer list for that provider, click pins sub-panel
        var stableLink = bodyEl.querySelector('.as-stable-link');
        if (stableLink) {
            function buildStablePeersHtml() {
                var data = computeSummaryData();
                var stableInsight = null;
                for (var j = 0; j < data.insights.length; j++) {
                    if (data.insights[j].type === 'stable') { stableInsight = data.insights[j]; break; }
                }
                if (!stableInsight) return null;
                var peerIds = stableInsight.peerIds;
                var idSet = {};
                for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                var matchedPeers = [];
                for (var i = 0; i < lastPeersRaw.length; i++) {
                    if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                }
                var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + stableInsight.provName + ' Peers</div>';
                html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + stableInsight.asNumber + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
                html += '</div>';
                html += buildPeerListHtmlForSubSub(matchedPeers);
                return { html: html, peerIds: peerIds, asNum: stableInsight.asNumber };
            }
            stableLink.addEventListener('mouseenter', function (e) {
                var asNum = stableLink.dataset.as;
                // Focus legend on this provider
                if (asNum) setLegendFocus(asNum);
                if (subTooltipPinned) {
                    var result = buildStablePeersHtml();
                    if (result) showHoverPreview(result.html, e);
                } else {
                    var result = buildStablePeersHtml();
                    if (result) showSubTooltip(result.html, e);
                }
                // Preview lines + filter for this provider
                if (asNum) {
                    var peerIds = getPeerIdsForAnyAs(asNum);
                    var color = getColorForAsNum(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs) {
                        _drawLinesForAs(asNum, peerIds, color);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                }
            });
            stableLink.addEventListener('mouseleave', function () {
                clearLegendFocus();
                if (subTooltipPinned) {
                    restorePinnedSubTooltip();
                    restoreSummaryFromPreview();
                } else {
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                }
                // In focused mode, revert donut if no insight is active
                if (donutFocused && !insightActiveAsNum) {
                    animateDonutRevert();
                    renderCenter();
                } else if (donutFocused && insightActiveAsNum) {
                    showFocusedCenterText(insightActiveAsNum);
                    animateDonutExpand(insightActiveAsNum);
                }
            });
            stableLink.addEventListener('click', function (e) {
                e.stopPropagation();
                // Toggle
                if (subTooltipPinned && pinnedSubTooltipSrc === stableLink) {
                    hideSubTooltip();
                    stableLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                    subFilterPeerIds = null;
                    subFilterCategory = null;
                    subFilterLabel = null;
                    insightActiveAsNum = null;
                    insightActiveType = null;
                    hideInsightRect();
                    if (donutFocused) animateDonutRevert();
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (summarySelected) activateHoverAll();
                    renderCenter();
                    return;
                }
                var result = buildStablePeersHtml();
                if (!result) return;
                showSubTooltip(result.html, e);
                pinSubTooltip(result.html, stableLink, function (tip) {
                    attachSubTooltipHandlers();
                    attachProviderNavHandlers(tip);
                });
                attachSubTooltipHandlers();
                var tip = document.getElementById('as-sub-tooltip');
                if (tip) attachProviderNavHandlers(tip);
                // Clear any other active highlights before adding ours
                var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                stableLink.closest('.as-summary-insight').classList.add('sub-filter-active');
                // Track sub-filter state for data refresh preservation
                subFilterPeerIds = result.peerIds;
                subFilterCategory = 'insight-stable';
                subFilterLabel = result.asNum;
                if (_filterPeerTable) _filterPeerTable(result.peerIds);
                if (_dimMapPeers) _dimMapPeers(result.peerIds);
                // Draw lines for this provider
                var color = getColorForAsNum(result.asNum);
                if (_drawLinesForAs && result.asNum) {
                    _drawLinesForAs(result.asNum, result.peerIds, color);
                }
                // Activate insight donut state — show insight rectangle
                insightActiveAsNum = result.asNum;
                insightActiveType = 'stable';
                if (donutFocused) {
                    var insData = computeSummaryData();
                    var stableIns = null;
                    for (var ij = 0; ij < insData.insights.length; ij++) {
                        if (insData.insights[ij].type === 'stable') { stableIns = insData.insights[ij]; break; }
                    }
                    if (stableIns) {
                        showInsightRect('stable', {
                            provName: stableIns.provName,
                            asNumber: stableIns.asNumber,
                            peerIds: stableIns.peerIds,
                            durText: stableIns.durText,
                            color: color
                        });
                    }
                }
                setLegendFocus(result.asNum);
            });
        }

        // Data insight provider sub-panels (Most sent/recv — hover shows providers ranked by bytes)
        var dataProvLinks = bodyEl.querySelectorAll('.as-data-providers-link');
        for (var i = 0; i < dataProvLinks.length; i++) {
            (function (el) {
                var field = el.dataset.field;
                var isRecv = field === 'bytesrecv';

                function buildDataProviderHtml() {
                    var data = computeSummaryData();
                    var insight = null;
                    for (var j = 0; j < data.insights.length; j++) {
                        if (data.insights[j].type === 'data-providers' && data.insights[j].field === field) {
                            insight = data.insights[j]; break;
                        }
                    }
                    if (!insight || !insight.topProviders) return null;

                    var title = isRecv ? 'Top Providers \u2014 Total Recv' : 'Top Providers \u2014 Total Sent';
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + title + '</div>';
                    html += '</div>';
                    html += '<div class="as-sub-tt-scroll">';
                    for (var pi = 0; pi < insight.topProviders.length; pi++) {
                        var prov = insight.topProviders[pi];
                        var peerIdsJson = JSON.stringify(prov.peers.slice(0, 20).map(function (p) { return p.id; })).replace(/"/g, '&quot;');
                        html += '<div class="as-sub-tt-peer as-provider-row as-data-prov-row" data-as="' + prov.asNumber + '" data-peer-ids="' + peerIdsJson + '" data-field="' + field + '" data-rank="' + (pi + 1) + '" data-total-bytes="' + prov.totalBytes + '">';
                        html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
                        html += '<span class="as-grid-dot" style="background:' + prov.color + '"></span>';
                        var name = prov.provName.length > 14 ? prov.provName.substring(0, 13) + '\u2026' : prov.provName;
                        html += '<span class="as-sub-tt-loc" title="' + prov.provName + '">' + name + '</span>';
                        html += '<span class="as-sub-tt-type">' + fmtBytes(prov.totalBytes) + '</span>';
                        html += '</div>';
                    }
                    html += '</div>';
                    return { html: html, insight: insight };
                }

                el.addEventListener('mouseenter', function (e) {
                    if (subTooltipPinned) {
                        var result = buildDataProviderHtml();
                        if (result) showHoverPreview(result.html, e);
                    } else {
                        var result = buildDataProviderHtml();
                        if (!result) return;
                        showSubTooltip(result.html, e);
                    }
                    // Preview lines for the #1 data provider + focus legend
                    var result2 = buildDataProviderHtml();
                    if (result2 && result2.insight && result2.insight.topProviders && result2.insight.topProviders.length > 0) {
                        var top = result2.insight.topProviders[0];
                        setLegendFocus(top.asNumber);
                        var topPeerIds = top.peers.slice(0, 20).map(function (p) { return p.id; });
                        if (_drawLinesForAs) _drawLinesForAs(top.asNumber, topPeerIds, top.color);
                        if (_filterPeerTable) _filterPeerTable(topPeerIds);
                        if (_dimMapPeers) _dimMapPeers(topPeerIds);
                        // In focused mode, show provider in donut center + animate
                        if (donutFocused) {
                            showFocusedCenterText(top.asNumber);
                            animateDonutExpand(top.asNumber);
                        }
                    }
                });
                el.addEventListener('mouseleave', function () {
                    clearLegendFocus();
                    if (subTooltipPinned) {
                        restorePinnedSubTooltip();
                        restoreSummaryFromPreview();
                    } else {
                        hideSubTooltip();
                        restoreSummaryFromPreview();
                    }
                    // In focused mode, revert donut if no insight is active
                    if (donutFocused && !insightActiveAsNum) {
                        animateDonutRevert();
                        renderCenter();
                    } else if (donutFocused && insightActiveAsNum) {
                        showFocusedCenterText(insightActiveAsNum);
                        animateDonutExpand(insightActiveAsNum);
                    }
                });
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    // Toggle: clicking same link unpins
                    if (subTooltipPinned && pinnedSubTooltipSrc === el) {
                        hideSubTooltip();
                        el.closest('.as-summary-insight').classList.remove('sub-filter-active');
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        insightActiveAsNum = null;
                        insightActiveType = null;
                        hideInsightRect();
                        if (donutFocused) animateDonutRevert();
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
                        renderCenter();
                        return;
                    }
                    var result = buildDataProviderHtml();
                    if (!result) return;
                    showSubTooltip(result.html, e);
                    pinSubTooltip(result.html, el, function (tip) {
                        attachDataProviderRowHandlers(tip, field);
                    });
                    attachDataProviderRowHandlers(document.getElementById('as-sub-tooltip'), field);
                    // Clear any other active highlights before adding ours
                    var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    // Highlight this insight as active
                    el.closest('.as-summary-insight').classList.add('sub-filter-active');
                    // Track sub-filter state for data refresh preservation
                    subFilterPeerIds = [];
                    subFilterCategory = 'insight-data-' + field;
                    subFilterLabel = field;
                    // Activate insight donut state — show insight rectangle for #1 data provider
                    var insDataResult = buildDataProviderHtml();
                    if (insDataResult && insDataResult.insight && insDataResult.insight.topProviders && insDataResult.insight.topProviders.length > 0) {
                        var topDataProv = insDataResult.insight.topProviders[0];
                        insightActiveAsNum = topDataProv.asNumber;
                        insightActiveType = 'data-' + field;
                        if (donutFocused) {
                            var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                            showInsightRect(rectType, {
                                provName: topDataProv.provName,
                                asNumber: topDataProv.asNumber,
                                peers: topDataProv.peers,
                                totalBytes: topDataProv.totalBytes,
                                rank: 1,
                                color: topDataProv.color || getColorForAsNum(topDataProv.asNumber)
                            });
                        }
                        setLegendFocus(topDataProv.asNumber);
                        var topDataPeerIds = topDataProv.peers.slice(0, 20).map(function (p) { return p.id; });
                        if (_drawLinesForAs) _drawLinesForAs(topDataProv.asNumber, topDataPeerIds, topDataProv.color);
                        if (_filterPeerTable) _filterPeerTable(topDataPeerIds);
                        if (_dimMapPeers) _dimMapPeers(topDataPeerIds);
                    }
                });
            })(dataProvLinks[i]);
        }
    }

    /** Attach handlers for fastest connection provider rows.
     *  Clicking a provider shows sub-sub-tooltip with its peers ranked by ping. */
    function attachFastestProvRowHandlers(tip) {
        var provRows = tip.querySelectorAll('.as-fastest-prov-row');
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                provRow.addEventListener('mouseenter', function () {
                    var asNum = provRow.dataset.as;
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var rank = parseInt(provRow.dataset.rank) || 0;
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, update insight rect for this provider
                    if (donutFocused && asNum && insightRectVisible) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var avgPing = parseFloat(provRow.dataset.avgPing) || 0;
                        showInsightRect('fastest', {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peerIds: peerIds,
                            avgPing: avgPing,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        });
                        insightActiveAsNum = asNum;
                    } else if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                provRow.addEventListener('mouseleave', function () {
                    // On leave, restore to the pinned insight provider
                    if (insightRectVisible) {
                        restoreInsightRectProvider();
                    } else {
                        restoreSummaryFromPreview();
                    }
                });
                provRow.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var asNum = provRow.dataset.as;
                    var rank = parseInt(provRow.dataset.rank) || 0;

                    // Keep legend focused on this provider while sub-sub is pinned
                    legendFocusAs = asNum;
                    renderLegend();

                    var idSet = {};
                    for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                    var matchedPeers = [];
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    matchedPeers.sort(function (a, b) { return (a.ping_ms || 9999) - (b.ping_ms || 9999); });

                    // Build sub-sub-tooltip with peers ranked by ping
                    var html = buildPingPeerListHtml(matchedPeers.slice(0, 20));
                    showSubSubTooltip(html, e);
                    subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    subSubFilterPeerIds = peerIds;
                    subSubFilterAsNum = asNum;
                    subSubFilterColor = getColorForAsNum(asNum);

                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);

                    // Update insight rect to show selected provider
                    if (donutFocused && insightRectVisible) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var avgPing = parseFloat(provRow.dataset.avgPing) || 0;
                        insightActiveAsNum = asNum;
                        showInsightRect('fastest', {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peerIds: peerIds,
                            avgPing: avgPing,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        });
                    }
                });
            })(provRows[pi]);
        }
    }

    /** Build peer list HTML for ping sub-sub-tooltip. */
    function buildPingPeerListHtml(peers) {
        var html = '';
        var initialShow = 8;
        var hasMore = peers.length > initialShow;

        html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Peers \u2014 By Ping</div>';
        html += '</div>';
        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + (p.ping_ms > 0 ? Math.round(p.ping_ms) + 'ms' : '\u2014') + '</span>';
            var ct = p.connection_type || 'unknown';
            html += '<span class="as-sub-tt-loc">' + (CONN_TYPE_LABELS[ct] || ct) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = peers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Attach click handlers for data provider rows in the sub-tooltip.
     *  Clicking a provider shows sub-sub-tooltip with that provider's top 20 peers. */
    function attachDataProviderRowHandlers(tip, field) {
        var provRows = tip.querySelectorAll('.as-data-prov-row');
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                // Hover preview: show lines + filter for this provider's peers
                provRow.addEventListener('mouseenter', function () {
                    var asNum = provRow.dataset.as;
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var rank = parseInt(provRow.dataset.rank) || 0;
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, update insight rect for this provider
                    if (donutFocused && asNum && insightRectVisible) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var totalBytes = parseInt(provRow.dataset.totalBytes) || 0;
                        var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                        insightActiveAsNum = asNum;
                        showInsightRect(rectType, {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peers: peerIds,
                            totalBytes: totalBytes,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        });
                    } else if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                provRow.addEventListener('mouseleave', function () {
                    // On leave, restore to the pinned insight provider
                    if (insightRectVisible) {
                        restoreInsightRectProvider();
                    } else {
                        restoreSummaryFromPreview();
                    }
                });
                provRow.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var asNum = provRow.dataset.as;
                    var rowField = provRow.dataset.field;

                    // Keep legend focused on this provider while sub-sub is pinned
                    legendFocusAs = asNum;
                    renderLegend();

                    // Find matching peer objects from lastPeersRaw
                    var idSet = {};
                    for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                    var matchedPeers = [];
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    // Sort by the relevant field
                    matchedPeers.sort(function (a, b) { return (b[rowField] || 0) - (a[rowField] || 0); });

                    // Build sub-sub-tooltip showing top 20 peers with bytes amounts
                    var html = buildDataPeerListHtml(matchedPeers.slice(0, 20), rowField);
                    showSubSubTooltip(html, e);
                    subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    subSubFilterPeerIds = peerIds;
                    subSubFilterAsNum = asNum;
                    subSubFilterColor = getColorForAsNum(asNum);

                    // Draw lines for this provider's peers
                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);

                    // Update insight rect to show selected data provider
                    if (donutFocused && insightRectVisible) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var totalBytes = parseInt(provRow.dataset.totalBytes) || 0;
                        var rank = parseInt(provRow.dataset.rank) || 0;
                        var rectType = rowField === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                        insightActiveAsNum = asNum;
                        showInsightRect(rectType, {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peers: peerIds,
                            totalBytes: totalBytes,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        });
                    }
                });
            })(provRows[pi]);
        }
    }

    /** Build peer list HTML for data sub-sub-tooltip showing bytes amounts.
     *  Shows 6-10 initially with scroll for the rest. */
    function buildDataPeerListHtml(peers, field) {
        var html = '';
        var initialShow = 8;
        var hasMore = peers.length > initialShow;
        var isRecv = field === 'bytesrecv';
        var title = isRecv ? 'Top Peers \u2014 Bytes Received' : 'Top Peers \u2014 Bytes Sent';

        html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + title + '</div>';
        html += '</div>';
        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + fmtBytes(p[field]) + '</span>';
            var ct = p.connection_type || 'unknown';
            html += '<span class="as-sub-tt-loc">' + (CONN_TYPE_LABELS[ct] || ct) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = peers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Attach provider navigation handlers (clicking a provider name navigates to its panel) */
    function attachProviderNavHandlers(tip) {
        var provRows = tip.querySelectorAll('.as-provider-row');
        for (var i = 0; i < provRows.length; i++) {
            (function (provRow) {
                var nameEl = provRow.querySelector('.as-provider-click');
                if (nameEl) {
                    nameEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var asNum = provRow.dataset.as;
                        if (asNum) {
                            hideSubTooltip();
                            navigateToProvider(asNum);
                        }
                    });
                }
            })(provRows[i]);
        }
        // Also handle standalone provider-click links (e.g. "Open provider panel" in sub-tooltips)
        var provClicks = tip.querySelectorAll('.as-grid-provider-click');
        for (var i = 0; i < provClicks.length; i++) {
            (function (el) {
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var asNum = el.dataset.as;
                    if (asNum) {
                        hideSubTooltip();
                        navigateToProvider(asNum);
                    }
                });
            })(provClicks[i]);
        }
    }

    /** Apply a sub-filter in summary mode */
    function applySummarySubFilter(peerIds, label) {
        if (subFilterPeerIds && label === subFilterLabel) {
            clearSummarySubFilter();
            return;
        }
        // Clear any active insight state when switching to a different category
        if (insightActiveAsNum || insightActiveType) {
            insightActiveAsNum = null;
            insightActiveType = null;
            hideInsightRect();
            if (donutFocused) animateDonutRevert();
        }
        subFilterPeerIds = peerIds;
        subFilterCategory = 'summary';
        subFilterLabel = label;
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        // Draw lines for the filtered peers — group by AS for colored lines
        if (_drawLinesForAllAs && donutSegments.length > 0) {
            var idSet = {};
            for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
            var groups = [];
            for (var si = 0; si < donutSegments.length; si++) {
                var seg = donutSegments[si];
                var filteredIds = [];
                for (var pi = 0; pi < seg.peerIds.length; pi++) {
                    if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                }
                if (filteredIds.length > 0) {
                    groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                }
            }
            _drawLinesForAllAs(groups);
        }
        highlightActiveSummaryRow();
    }

    function clearSummarySubFilter() {
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        insightActiveAsNum = null;
        insightActiveType = null;
        hideSubTooltip();
        hideInsightRect();
        // Restore to showing all peers
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        // Re-draw all lines
        if (summarySelected) activateHoverAll();
        // Remove active highlights from both summary rows and insight rows
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        if (bodyEl) {
            var rows = bodyEl.querySelectorAll('.sub-filter-active');
            for (var ri = 0; ri < rows.length; ri++) rows[ri].classList.remove('sub-filter-active');
        }
    }

    function highlightActiveSummaryRow() {
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        if (!bodyEl) return;
        // Clear ALL highlights first (summary rows + insight rows + grid rows)
        var allActive = bodyEl.querySelectorAll('.sub-filter-active');
        for (var ai = 0; ai < allActive.length; ai++) allActive[ai].classList.remove('sub-filter-active');
        // Re-apply highlight only to matching summary row
        var rows = bodyEl.querySelectorAll('.as-summary-row');
        for (var ri = 0; ri < rows.length; ri++) {
            if (subFilterLabel && rows[ri].dataset.catLabel === subFilterLabel) {
                rows[ri].classList.add('sub-filter-active');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /** Select the Summary Analysis view */
    function selectSummary() {
        if (selectedAs) deselect();
        summarySelected = true;
        hoveredAll = false;

        // Draw all lines (persistent)
        activateHoverAll();

        // Open the summary panel
        openSummaryPanel();

        // Update donut center to show SUMMARY ANALYSIS as active
        renderCenter();
    }

    /** Deselect the Summary Analysis view */
    function deselectSummary() {
        if (!summarySelected) return;
        summarySelected = false;
        panelHistory = [];
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        insightActiveAsNum = null;
        insightActiveType = null;
        hideSubTooltip();
        hideSubSubTooltip();
        hideInsightRect();
        closePanel();
        deactivateHoverAll();
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        renderCenter();
    }

    /** Handle click on title, donut center, or SUMMARY ANALYSIS text */
    function onSummaryClick(e) {
        e.stopPropagation();
        if (summarySelected) {
            deselectSummary();
        } else {
            selectSummary();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PANEL NAVIGATION — Back button, history, provider links
    // ═══════════════════════════════════════════════════════════

    /** Get peer IDs for any AS number (works for "Others" sub-providers too) */
    function getPeerIdsForAnyAs(asNum) {
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        if (seg) return seg.peerIds;
        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
        return grp ? grp.peerIds : [];
    }

    /** Navigate to a provider's panel (with back button to return) */
    function navigateToProvider(asNum) {
        // Close any open map peer tooltip when navigating
        if (_hideMapTooltip) _hideMapTooltip();

        // Save current panel state to history
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        var scrollTop = bodyEl ? bodyEl.scrollTop : 0;

        if (summarySelected) {
            panelHistory.push({ type: 'summary', scrollTop: scrollTop });
            summarySelected = false;
        } else if (selectedAs) {
            panelHistory.push({ type: 'provider', asNumber: selectedAs, scrollTop: scrollTop });
        }

        // Clear sub-filters and tooltips
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        hideSubTooltip();
        hideSubSubTooltip();

        // Navigate to provider panel
        selectedAs = asNum;
        openPanel(asNum);

        // Draw lines for this provider
        var peerIds = getPeerIdsForAnyAs(asNum);
        var color = getColorForAsNum(asNum);
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);

        // Animate donut to expand this provider's segment
        animateDonutExpand(asNum);

        if (containerEl) containerEl.classList.add('as-legend-visible');
        renderCenter();
        renderLegend();
    }

    /** Navigate back — always returns to diversity summary */
    function navigateBack() {
        // Close any open map peer tooltip when navigating back
        if (_hideMapTooltip) _hideMapTooltip();

        // Always go back to diversity summary (clear all state)
        peerDetailActive = false;
        selectedAs = null;
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        insightActiveAsNum = null;
        insightActiveType = null;
        panelHistory = [];
        hideSubTooltip();
        hideSubSubTooltip();
        hideInsightRect();

        if (donutFocused) {
            summarySelected = true;
            openSummaryPanel();
            animateDonutRevert();
            activateHoverAll();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            renderCenter();
            renderLegend();
            if (_resetMapZoom) _resetMapZoom();
        } else {
            // Not in focused mode — exit fully
            deselect();
        }
    }

    /** Render the back button in the panel header (shown when history exists) */
    function renderBackButton() {
        if (!panelEl) return;
        var existing = panelEl.querySelector('.as-detail-back');
        if (panelHistory.length > 0) {
            if (!existing) {
                existing = document.createElement('button');
                existing.className = 'as-detail-back';
                existing.title = 'Back';
                existing.innerHTML = '\u2190';  // ← left arrow = back
                existing.addEventListener('click', function (e) {
                    e.stopPropagation();
                    navigateBack();
                });
                var headerInfo = panelEl.querySelector('.as-detail-header-info');
                if (headerInfo) headerInfo.parentNode.insertBefore(existing, headerInfo);
            }
            existing.style.display = '';
        } else {
            if (existing) existing.style.display = 'none';
        }
    }

    /** Collapse sub-tooltips but keep the main panel open.
     *  Used when selecting a peer from within sub-panels. */
    function collapseToMainPanel() {
        hideSubSubTooltip();
        hideSubTooltip();
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        // Remove active highlights
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        if (bodyEl) {
            var rows = bodyEl.querySelectorAll('.sub-filter-active');
            for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
        }
        // Restore lines
        if (summarySelected) {
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
        } else if (selectedAs) {
            clearSubFilter();
        }
    }

    /** Handle map click — gradual collapse:
     *  In focused mode:
     *    1st click: close sub-panels, back to panel top level
     *    2nd click: exit focused mode entirely
     *  In default mode:
     *    1st click: close sub-panels
     *    2nd click: close main panel */
    function onMapClick() {
        // Stage 1: If sub-tooltips are visible, close them
        if (subTooltipPinned || subSubTooltipPinned) {
            hideSubTooltip();
            hideSubSubTooltip();
            // Restore to main state (summary or single AS)
            if (summarySelected) {
                subFilterPeerIds = null;
                subFilterLabel = null;
                subFilterCategory = null;
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
                // Remove active highlights
                var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                if (bodyEl) {
                    var rows = bodyEl.querySelectorAll('.sub-filter-active');
                    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                }
            } else if (selectedAs) {
                clearSubFilter();
            }
            return true; // handled — don't close main panel
        }

        // Stage 1.5: If peer detail popup is active, close it
        if (peerDetailActive) {
            closePeerPopup();
            return true;
        }

        // Stage 2: If in a provider view, go back to summary
        if (selectedAs) {
            if (donutFocused) {
                // In focused mode, go back to summary instead of closing
                if (othersListOpen) closeOthersListInDonut();
                panelHistory = [];
                var wasAs = selectedAs;
                selectedAs = null;
                hoveredAs = null;
                animateDonutRevert();
                renderCenter();
                renderLegend();
                selectSummary();
                return true;
            }
            panelHistory = [];
            deselect();
            return true;
        }

        // Stage 3: Close summary / exit focused mode
        if (summarySelected) {
            if (donutFocused) {
                exitFocusedMode();
            } else {
                deselectSummary();
            }
            return true;
        }

        // Stage 4: If just in focused mode with nothing selected, exit it
        if (donutFocused) {
            exitFocusedMode();
            return true;
        }

        return false;
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
        if (!seg && selectedAs) {
            var grp = asGroups.find(function (g) { return g.asNumber === selectedAs; });
            if (grp) {
                var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
                seg = { asNumber: selectedAs, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
            }
        }
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
            if (!seg) {
                var grp = asGroups.find(function (g) { return g.asNumber === selectedAs; });
                if (grp) {
                    var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
                    seg = { asNumber: selectedAs, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
                }
            }
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
    // FOCUSED MODE CENTER TEXT
    // ═══════════════════════════════════════════════════════════

    /** Show provider name in donut center during focused mode hover.
     *  Handles multi-line display for long names with dashes. */
    function showFocusedCenterText(asNum) {
        if (!donutCenter) return;
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        if (!seg) return;

        var diversityEl = donutCenter.querySelector('.as-score-diversity');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');

        if (diversityEl) diversityEl.style.display = 'none';

        // Build display name — smart line-breaking for names with dashes
        var name = seg.isOthers ? 'Others' : (seg.asShort || seg.asName || seg.asNumber);
        var displayLines = formatNameForDonut(name);

        if (headingEl) {
            headingEl.textContent = seg.peerCount + ' peer' + (seg.peerCount !== 1 ? 's' : '');
            headingEl.style.color = seg.color;
        }
        if (scoreVal) {
            scoreVal.textContent = displayLines;
            scoreVal.className = 'as-score-value as-focused-provider';
            scoreVal.style.color = seg.color;
            scoreVal.title = (seg.asName || seg.asNumber) + '\n' + seg.peerCount + ' peers (' + seg.percentage.toFixed(1) + '%)';
        }
        if (qualityEl) {
            qualityEl.textContent = seg.asNumber === 'Others' ? (seg.asName || '') : seg.asNumber;
            qualityEl.className = 'as-score-quality';
            qualityEl.style.color = seg.color;
        }
        if (scoreLbl) {
            scoreLbl.textContent = '';
            scoreLbl.classList.remove('as-summary-link');
        }
    }

    /** Show scrollable Others list inside the donut center (focused mode only).
     *  Each item is hoverable (preview lines) and clickable (opens provider panel). */
    function showOthersListInDonut() {
        if (!donutCenter) return;
        var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
        if (!othersSeg || !othersSeg._othersGroups) return;

        othersListOpen = true;

        // Hide normal center elements
        var diversityEl = donutCenter.querySelector('.as-score-diversity');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');
        if (diversityEl) diversityEl.style.display = 'none';
        if (headingEl) headingEl.style.display = 'none';
        if (scoreVal) scoreVal.style.display = 'none';
        if (qualityEl) qualityEl.style.display = 'none';
        if (scoreLbl) scoreLbl.style.display = 'none';

        // Remove any existing list
        var existing = donutCenter.querySelector('.as-donut-others-list');
        if (existing) existing.remove();

        // Build scrollable list
        var listDiv = document.createElement('div');
        listDiv.className = 'as-donut-others-list visible';

        // Back arrow
        var backEl = document.createElement('div');
        backEl.className = 'as-donut-others-back';
        backEl.textContent = '\u2190 Back';
        backEl.addEventListener('click', function (e) {
            e.stopPropagation();
            closeOthersListInDonut();
        });
        listDiv.appendChild(backEl);

        // Provider items
        var groups = othersSeg._othersGroups;
        for (var i = 0; i < groups.length; i++) {
            (function (g) {
                var item = document.createElement('div');
                item.className = 'as-donut-others-item';
                var name = g.asShort || g.asName || g.asNumber;
                if (name.length > 22) name = name.substring(0, 21) + '\u2026';
                item.textContent = name + ' (' + g.peerCount + ')';
                item.title = g.asNumber + ' \u00b7 ' + (g.asName || g.asShort || '') + ' \u00b7 ' + g.peerCount + ' peer' + (g.peerCount !== 1 ? 's' : '');

                // Hover: preview lines to this provider's peers
                item.addEventListener('mouseenter', function () {
                    if (_drawLinesForAs) _drawLinesForAs(g.asNumber, g.peerIds, othersSeg.color);
                    if (_dimMapPeers) _dimMapPeers(g.peerIds);
                });
                item.addEventListener('mouseleave', function () {
                    // Restore all-lines for Others
                    if (selectedAs === 'Others') {
                        if (_drawLinesForAs) _drawLinesForAs('Others', othersSeg.peerIds, othersSeg.color);
                        if (_dimMapPeers) _dimMapPeers(othersSeg.peerIds);
                    } else {
                        activateHoverAll();
                        if (_dimMapPeers) _dimMapPeers(null);
                    }
                });

                // Click: navigate to this provider's panel
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    closeOthersListInDonut();
                    navigateToProvider(g.asNumber);
                    animateDonutExpand(g.asNumber);
                });

                listDiv.appendChild(item);
            })(groups[i]);
        }

        donutCenter.appendChild(listDiv);
    }

    /** Close the Others list in donut center and restore normal display */
    function closeOthersListInDonut() {
        othersListOpen = false;
        if (!donutCenter) return;

        var listEl = donutCenter.querySelector('.as-donut-others-list');
        if (listEl) listEl.remove();

        // Restore center element visibility
        var diversityEl = donutCenter.querySelector('.as-score-diversity');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');
        if (diversityEl) diversityEl.style.display = '';
        if (headingEl) headingEl.style.display = '';
        if (scoreVal) scoreVal.style.display = '';
        if (qualityEl) qualityEl.style.display = '';
        if (scoreLbl) scoreLbl.style.display = '';

        renderCenter();
    }

    /** Format a provider name to fit inside the donut center.
     *  Breaks long names at dashes or spaces. */
    function formatNameForDonut(name) {
        if (!name) return '';
        // If it fits, just return it
        if (name.length <= 12) return name;
        // Try breaking at dashes first
        if (name.indexOf('-') !== -1) {
            var parts = name.split('-');
            var lines = [];
            var current = parts[0];
            for (var i = 1; i < parts.length; i++) {
                if ((current + '-' + parts[i]).length <= 12) {
                    current += '-' + parts[i];
                } else {
                    lines.push(current);
                    current = parts[i];
                }
            }
            lines.push(current);
            return lines.join('\n');
        }
        // Try breaking at spaces
        if (name.indexOf(' ') !== -1) {
            var words = name.split(' ');
            var lines = [];
            var current = words[0];
            for (var i = 1; i < words.length; i++) {
                if ((current + ' ' + words[i]).length <= 14) {
                    current += ' ' + words[i];
                } else {
                    lines.push(current);
                    current = words[i];
                }
            }
            lines.push(current);
            return lines.join('\n');
        }
        // Last resort: just return truncated
        return name.length > 16 ? name.substring(0, 15) + '\u2026' : name;
    }

    // ═══════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════

    function onSegmentHover(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;
        // Don't show AS hover tooltip when a sub-tooltip is pinned
        if (subTooltipPinned) return;
        hoveredAs = asNum;
        // No floating tooltip — legend highlighting replaces it
        highlightLegendItem(asNum);

        // In focused mode, show provider name in donut center on hover
        if (donutFocused && !selectedAs) {
            focusedHoverAs = asNum;
            showFocusedCenterText(asNum);
        }

        // Temporarily remove all-hovered highlight so only this segment is bright
        if ((hoveredAll || summarySelected) && containerEl) {
            containerEl.classList.remove('as-all-hovered');
        }

        // Draw hover lines if nothing is selected, or if summary is selected (temporary override)
        if (!selectedAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
            if (seg && _drawLinesForAs) {
                _drawLinesForAs(asNum, seg.peerIds, seg.color);
            }
        }
    }

    function onSegmentLeave() {
        if (subTooltipPinned) return;
        hoveredAs = null;
        clearLegendHighlight();

        // In focused mode, restore center text to default score display
        if (donutFocused && !selectedAs) {
            focusedHoverAs = null;
            renderCenter();
        }

        // If hoveredAll or summarySelected is active, restore all-lines state
        if ((hoveredAll || summarySelected) && !selectedAs) {
            activateHoverAll();
            return;
        }

        // ONLY clear lines if nothing is selected — selection keeps its lines
        if (!selectedAs) {
            if (_clearAsLines) _clearAsLines();
        }
    }

    /** Add highlight class to the matching legend item */
    function highlightLegendItem(asNum) {
        if (!legendEl) return;
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.as === asNum) {
                items[i].classList.add('highlighted');
            } else {
                items[i].classList.add('dimmed');
            }
        }
    }

    /** Remove highlight class from all legend items */
    function clearLegendHighlight() {
        if (!legendEl) return;
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.remove('highlighted');
            items[i].classList.remove('dimmed');
        }
    }

    /** Activate hover-all visual state: highlight all segments + draw all lines */
    function activateHoverAll() {
        if (containerEl) containerEl.classList.add('as-all-hovered');
        if (containerEl) containerEl.classList.add('as-legend-visible');
        // Build groups array and draw all lines
        if (_drawLinesForAllAs && donutSegments.length > 0) {
            var groups = [];
            for (var i = 0; i < donutSegments.length; i++) {
                var seg = donutSegments[i];
                if (seg.peerIds && seg.peerIds.length > 0) {
                    groups.push({ asNum: seg.asNumber, peerIds: seg.peerIds, color: seg.color });
                }
            }
            _drawLinesForAllAs(groups);
        }
    }

    /** Deactivate hover-all visual state */
    function deactivateHoverAll() {
        if (containerEl) containerEl.classList.remove('as-all-hovered');
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (_clearAsLines) _clearAsLines();
    }

    function onTitleEnter() {
        if (selectedAs || summarySelected) return; // Don't override an active selection or summary
        hoveredAll = true;
        activateHoverAll();
    }

    function onTitleLeave() {
        if (!hoveredAll || summarySelected) return;
        hoveredAll = false;
        deactivateHoverAll();
    }

    function onSegmentClick(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;

        // Auto-enter focused mode if not already
        if (!donutFocused) {
            donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        // If summary is active, close it and select this AS
        if (summarySelected) {
            deselectSummary();
        }

        if (selectedAs === asNum) {
            // Deselect — go back to summary in focused mode
            if (donutFocused) {
                if (othersListOpen) closeOthersListInDonut();
                selectedAs = null;
                subFilterPeerIds = null;
                subFilterLabel = null;
                subFilterCategory = null;
                hideSubTooltip();
                closePanel();
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                animateDonutRevert();
                selectSummary();
                renderCenter();
                renderLegend();
            } else {
                animateDonutRevert();
                deselect();
            }
        } else {
            // Select this AS — clear any sub-filter from previous selection
            subFilterPeerIds = null;
            subFilterLabel = null;
            subFilterCategory = null;
            hideSubTooltip();
            if (othersListOpen) closeOthersListInDonut();
            selectedAs = asNum;
            var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
            if (seg) {
                openPanel(asNum);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(asNum, seg.peerIds, seg.color);

                // In focused mode, Others segment shows scrollable provider list inside donut
                if (donutFocused && seg.isOthers) {
                    showOthersListInDonut();
                }
            }
            // Animate donut expansion
            animateDonutExpand(asNum);
            // Keep legend visible while selected
            if (containerEl) containerEl.classList.add('as-legend-visible');
            renderCenter();
            renderLegend();
        }
    }

    function deselect() {
        if (summarySelected) {
            deselectSummary();
            return;
        }
        peerDetailActive = false;
        selectedAs = null;
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        hideSubTooltip();
        hideInsightRect();
        closePanel();
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        if (_clearAsLines) _clearAsLines();
        if (donutAnimState !== 'idle' && donutAnimState !== 'reverting') {
            animateDonutRevert();
        } else {
            renderDonut();
        }
        renderCenter();
        renderLegend();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            // Close peer popup first
            if (peerDetailActive && peerPopupEl) {
                closePeerPopup();
                return;
            }
            if (subSubTooltipPinned) {
                hideSubSubTooltip();
                // Restore to parent sub-filter state
                if (summarySelected && subFilterPeerIds && subFilterPeerIds.length > 0) {
                    if (_filterPeerTable) _filterPeerTable(subFilterPeerIds);
                    if (_dimMapPeers) _dimMapPeers(subFilterPeerIds);
                    // Re-draw lines for the parent sub-filter (not all lines)
                    if (_drawLinesForAllAs && donutSegments.length > 0) {
                        var idSet = {};
                        for (var i = 0; i < subFilterPeerIds.length; i++) idSet[subFilterPeerIds[i]] = true;
                        var groups = [];
                        for (var si = 0; si < donutSegments.length; si++) {
                            var seg = donutSegments[si];
                            var filteredIds = [];
                            for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                            }
                            if (filteredIds.length > 0) {
                                groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                            }
                        }
                        _drawLinesForAllAs(groups);
                    }
                } else if (summarySelected) {
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    activateHoverAll();
                }
                return;
            }
            if (subTooltipPinned) {
                hideSubTooltip();
                // Restore to full summary or AS state
                if (summarySelected) {
                    clearSummarySubFilter();
                } else if (selectedAs) {
                    clearSubFilter();
                }
                return;
            }
            if (summarySelected) {
                if (donutFocused) {
                    exitFocusedMode();
                } else {
                    deselectSummary();
                }
                return;
            }
            if (selectedAs) {
                deselect();
                return;
            }
            if (donutFocused) {
                exitFocusedMode();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FOCUSED MODE — Donut moves to top-center, layout rearranges
    // ═══════════════════════════════════════════════════════════

    /** Enter focused mode: donut to top-center, BTC price to left, map controls to right */
    function enterFocusedMode() {
        if (donutFocused) return;
        donutFocused = true;
        document.body.classList.add('donut-focused');

        // Hide the legend (top 8 list) — it only shows in default mode or on interaction
        if (legendEl) {
            legendEl.style.display = '';
        }

        // Activate hover-all to show lines from donut center in focused mode
        hoveredAll = false;
        activateHoverAll();

        // Open summary panel automatically
        selectSummary();
    }

    /** Exit focused mode: everything returns to default positions */
    function exitFocusedMode() {
        if (!donutFocused) return;
        donutFocused = false;
        focusedHoverAs = null;
        peerDetailActive = false;
        if (othersListOpen) closeOthersListInDonut();
        document.body.classList.remove('donut-focused');

        // Revert donut animation
        stopDonutAnimation();
        hideInsightRect();

        // Deselect everything
        if (summarySelected) deselectSummary();
        if (selectedAs) deselect();
        hoveredAll = false;
        deactivateHoverAll();

        // Auto zoom-out to default map view
        if (_resetMapZoom) _resetMapZoom();

        // Reset center display
        renderDonut();
        renderCenter();
        renderLegend();
    }

    /** Check if focused mode is active */
    function isFocusedMode() {
        return donutFocused;
    }

    // ═══════════════════════════════════════════════════════════
    // PEER DETAIL POPUP — Floating popup for peer info
    // ═══════════════════════════════════════════════════════════

    var peerPopupEl = null;   // Current peer popup DOM element

    /** Close the peer detail popup */
    function closePeerPopup() {
        peerDetailActive = false;
        if (peerPopupEl) {
            peerPopupEl.classList.remove('visible');
            setTimeout(function () {
                if (peerPopupEl && peerPopupEl.parentNode) {
                    peerPopupEl.parentNode.removeChild(peerPopupEl);
                }
                peerPopupEl = null;
            }, 200);
        }
        // Restore previous line/filter state
        if (summarySelected) {
            if (insightActiveAsNum) {
                var peerIds = getPeerIdsForAnyAs(insightActiveAsNum);
                var color = getColorForAsNum(insightActiveAsNum);
                if (_drawLinesForAs) _drawLinesForAs(insightActiveAsNum, peerIds, color);
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
            } else {
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
            }
            renderCenter();
        } else if (selectedAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            if (seg) {
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
            }
            renderCenter();
        } else {
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            if (_clearAsLines) _clearAsLines();
            renderCenter();
        }
    }

    /** Open a floating popup showing full peer detail info.
     *  Does NOT take over the right panel — the summary/provider panel stays open.
     *  @param {Object} peer — raw peer data from lastPeersRaw
     *  @param {string} source — 'peerlist' | 'map' | 'panel' */
    function openPeerDetailPanel(peer, source) {
        // Close any existing peer popup
        if (peerPopupEl && peerPopupEl.parentNode) {
            peerPopupEl.parentNode.removeChild(peerPopupEl);
            peerPopupEl = null;
        }

        peerDetailActive = true;

        // Find the provider for this peer
        var asNum = parseAsNumber(peer.as);
        var asOrg = parseAsOrg(peer.as);
        var asShort = peer.asname || '';
        var provColor = asNum ? getColorForAsNum(asNum) : '#6e7681';

        // Determine network color
        var netColors = {
            'ipv4': 'var(--net-ipv4, #58a6ff)',
            'ipv6': 'var(--net-ipv6, #3fb950)',
            'onion': 'var(--net-tor, #da3633)',
            'tor': 'var(--net-tor, #da3633)',
            'i2p': 'var(--net-i2p, #d29922)',
            'cjdns': 'var(--net-cjdns, #bc8cff)'
        };
        var netColor = netColors[(peer.network || 'ipv4').toLowerCase()] || 'var(--accent, #58a6ff)';

        // Enter focused mode if not already (for line drawing)
        if (!donutFocused) {
            donutFocused = true;
            document.body.classList.add('donut-focused');
            if (!summarySelected && !selectedAs) {
                selectSummary();
            }
        }

        // Draw a single line to this peer
        if (_drawLinesForAs && asNum) {
            _drawLinesForAs(asNum, [peer.id], provColor);
        }
        if (_filterPeerTable) _filterPeerTable([peer.id]);
        if (_dimMapPeers) _dimMapPeers([peer.id]);

        // Show peer in donut center
        showPeerInDonutCenter(peer, provColor);

        // Build popup HTML
        var html = '';
        html += '<div class="peer-popup-header">';
        html += '<div class="peer-popup-circle" style="background:' + netColor + '"></div>';
        html += '<div class="peer-popup-title">';
        html += '<div class="peer-popup-name" style="color:' + provColor + '">Peer #' + peer.id + '</div>';
        html += '<div class="peer-popup-addr">' + escHtml(peer.addr || '') + '</div>';
        html += '<div class="peer-popup-meta">' + (peer.network || 'ipv4').toUpperCase() + ' \u00b7 ' + (peer.direction === 'IN' ? 'Inbound' : 'Outbound') + '</div>';
        html += '</div>';
        html += '</div>';

        html += '<div class="peer-popup-scroll">';

        // Identity section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Identity</div>';
        html += peerDetailRow('Peer ID', '#' + peer.id);
        html += peerDetailRow('Address', peer.addr || '\u2014');
        html += peerDetailRow('Network', (peer.network || 'ipv4').toUpperCase());
        html += peerDetailRow('Direction', peer.direction === 'IN' ? 'Inbound' : 'Outbound');
        html += peerDetailRow('Conn Type', CONN_TYPE_FULL[peer.connection_type] || peer.connection_type || '\u2014');
        html += '</div>';

        // Performance section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Performance</div>';
        html += peerDetailRow('Ping', peer.ping_ms ? peer.ping_ms + ' ms' : '\u2014');
        html += peerDetailRow('Min Ping', peer.minping ? (peer.minping * 1000).toFixed(1) + ' ms' : '\u2014');
        html += peerDetailRow('Connected', peer.conntime_fmt || fmtDuration(peer.conntime ? (Math.floor(Date.now() / 1000) - peer.conntime) : 0));
        html += peerDetailRow('Last Send', peer.lastsend ? fmtDuration(Math.floor(Date.now() / 1000) - peer.lastsend) + ' ago' : '\u2014');
        html += peerDetailRow('Last Recv', peer.lastrecv ? fmtDuration(Math.floor(Date.now() / 1000) - peer.lastrecv) + ' ago' : '\u2014');
        html += peerDetailRow('Bytes Sent', peer.bytessent_fmt || fmtBytes(peer.bytessent));
        html += peerDetailRow('Bytes Recv', peer.bytesrecv_fmt || fmtBytes(peer.bytesrecv));
        html += '</div>';

        // Software section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Software</div>';
        html += peerDetailRow('Version', peer.subver || '\u2014');
        html += peerDetailRow('Protocol', peer.version || '\u2014');
        html += peerDetailRow('Services', expandServiceFlags(peer.services_abbrev || ''));
        html += peerDetailRow('Start Height', peer.startingheight || '\u2014');
        html += peerDetailRow('Synced Hdrs', peer.synced_headers || '\u2014');
        html += peerDetailRow('Synced Blks', peer.synced_blocks || '\u2014');
        if (peer.transport_protocol_type) html += peerDetailRow('Transport', peer.transport_protocol_type);
        if (peer.session_id) html += peerDetailRow('Session ID', '<span style="font-size:9px;word-break:break-all">' + escHtml(peer.session_id) + '</span>');
        html += '</div>';

        // Location section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Location</div>';
        html += peerDetailRow('Country', peer.country || '\u2014');
        html += peerDetailRow('Region', peer.regionName || '\u2014');
        html += peerDetailRow('City', peer.city || '\u2014');
        html += peerDetailRow('ISP', peer.isp || '\u2014');
        html += peerDetailRow('AS', asNum ? (asNum + ' ' + (asOrg || asShort || '')) : '\u2014');
        if (peer.mapped_as) html += peerDetailRow('Mapped AS', 'AS' + peer.mapped_as);
        html += '</div>';

        // Status section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Status</div>';
        html += peerDetailRow('Addrman', peer.in_addrman ? 'Yes' : 'No');
        html += peerDetailRow('Addr Relay', peer.addr_relay_enabled != null ? (peer.addr_relay_enabled ? 'Yes' : 'No') : '\u2014');
        html += peerDetailRow('BIP152 HB', peer.bip152_hb_from ? 'From: Yes' : 'From: No');
        if (peer.hosting) html += peerDetailRow('Hosting', 'Cloud/Hosting');
        if (peer.proxy) html += peerDetailRow('Proxy', 'VPN/Proxy');
        if (peer.mobile) html += peerDetailRow('Mobile', 'Mobile network');
        html += '</div>';

        html += '</div>'; // end peer-popup-scroll

        // Fixed bottom buttons
        html += '<div class="peer-popup-footer">';
        html += '<button class="peer-popup-disconnect" data-peer-id="' + peer.id + '">\u2716 Disconnect</button>';
        html += '<button class="peer-popup-close">Close</button>';
        html += '</div>';

        // Create popup element
        var popup = document.createElement('div');
        popup.className = 'peer-detail-popup';
        popup.style.borderColor = netColor;
        popup.innerHTML = html;
        document.body.appendChild(popup);
        peerPopupEl = popup;

        // Animate in
        requestAnimationFrame(function () {
            popup.classList.add('visible');
        });

        // Prevent clicks from propagating to map
        popup.addEventListener('click', function (e) {
            e.stopPropagation();
        });

        // Bind close button
        var closeBtn = popup.querySelector('.peer-popup-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                closePeerPopup();
            });
        }

        // Bind disconnect button — shows Disconnect Only / Disconnect + Ban 24h / Cancel dialog
        var disconnBtn = popup.querySelector('.peer-popup-disconnect');
        if (disconnBtn) {
            disconnBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var peerId = parseInt(disconnBtn.dataset.peerId);
                if (isNaN(peerId)) return;
                var peerNet = (peer.network || 'ipv4').toLowerCase();
                var canBan = (peerNet === 'ipv4' || peerNet === 'ipv6');
                // Remove any existing dialog
                var existingDlg = document.getElementById('disconnect-dialog');
                if (existingDlg) existingDlg.remove();
                // Create the dialog overlay
                var overlay = document.createElement('div');
                overlay.id = 'disconnect-dialog';
                overlay.className = 'dialog-overlay';
                overlay.innerHTML = '<div class="dialog-box">' +
                    '<div class="dialog-title">Disconnect Peer ' + peerId + '</div>' +
                    '<div class="dialog-text">Choose an action for this peer:</div>' +
                    '<div class="dialog-actions">' +
                    '<button class="dialog-btn dialog-btn-disconnect" data-choice="disconnect">Disconnect Only</button>' +
                    (canBan ? '<button class="dialog-btn dialog-btn-ban" data-choice="ban">Disconnect + Ban 24h</button>' : '') +
                    '<button class="dialog-btn dialog-btn-cancel" data-choice="cancel">Cancel</button>' +
                    '</div></div>';
                document.body.appendChild(overlay);
                overlay.addEventListener('click', function (ev) {
                    var btn = ev.target.closest('.dialog-btn');
                    if (!btn && ev.target === overlay) { overlay.remove(); return; }
                    if (!btn) return;
                    var choice = btn.dataset.choice;
                    overlay.remove();
                    if (choice === 'cancel') return;
                    if (choice === 'ban') {
                        fetch('/api/peer/ban', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ peer_id: peerId })
                        }).then(function (r) { return r.json(); }).then(function (banData) {
                            if (!banData.success) {
                                disconnBtn.textContent = 'Ban failed: ' + (banData.error || '');
                                return;
                            }
                            fetch('/api/peer/disconnect', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ peer_id: peerId })
                            }).then(function (r) { return r.json(); }).then(function (dcData) {
                                if (dcData.success) {
                                    disconnBtn.textContent = '\u2714 Banned + Disconnected';
                                    disconnBtn.classList.add('disconnected');
                                    disconnBtn.disabled = true;
                                } else {
                                    disconnBtn.textContent = 'Banned but DC failed';
                                }
                            });
                        }).catch(function () { disconnBtn.textContent = 'Error'; });
                    } else {
                        fetch('/api/peer/disconnect', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ peer_id: peerId })
                        }).then(function (r) { return r.json(); }).then(function (data) {
                            if (data.success) {
                                disconnBtn.textContent = '\u2714 Disconnected';
                                disconnBtn.classList.add('disconnected');
                                disconnBtn.disabled = true;
                            } else {
                                disconnBtn.textContent = 'Failed: ' + (data.error || '');
                            }
                        }).catch(function () { disconnBtn.textContent = 'Error'; });
                    }
                });
            });
        }
    }

    /** Show peer ID and provider in donut center */
    function showPeerInDonutCenter(peer, color) {
        if (!donutCenter) return;
        var diversityEl = donutCenter.querySelector('.as-score-diversity');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');

        if (diversityEl) diversityEl.style.display = 'none';
        if (headingEl) {
            headingEl.textContent = 'PEER #' + peer.id;
            headingEl.style.color = color;
        }
        if (scoreVal) {
            var provName = peer.asname || parseAsOrg(peer.as) || '';
            scoreVal.textContent = formatNameForDonut(provName);
            scoreVal.className = 'as-score-value as-focused-provider';
            scoreVal.style.color = color;
        }
        if (qualityEl) {
            qualityEl.textContent = parseAsNumber(peer.as) || '';
            qualityEl.className = 'as-score-quality';
            qualityEl.style.color = color;
        }
        if (scoreLbl) {
            scoreLbl.textContent = '';
            scoreLbl.classList.remove('as-summary-link');
        }
    }

    /** Build a simple key-value row for peer detail panel */
    function peerDetailRow(label, value) {
        return '<div class="as-detail-sub-row"><span class="as-detail-sub-label">' + escHtml(label) + '</span><span class="as-detail-sub-val">' + value + '</span></div>';
    }

    /** HTML-escape a string */
    function escHtml(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** Expand service flag abbreviations to full descriptions */
    function expandServiceFlags(abbrev) {
        if (!abbrev || abbrev === '\u2014') return '\u2014';
        var flags = abbrev.split('/');
        var expanded = [];
        for (var i = 0; i < flags.length; i++) {
            var flag = flags[i].trim();
            var found = false;
            for (var key in SERVICE_FLAGS) {
                if (SERVICE_FLAGS[key].abbr === flag) {
                    expanded.push(SERVICE_FLAGS[key].desc);
                    found = true;
                    break;
                }
            }
            if (!found) expanded.push(flag);
        }
        return expanded.join('<br>');
    }

    // ═══════════════════════════════════════════════════════════
    // PUBLIC API — Called by bitapp.js
    // ═══════════════════════════════════════════════════════════

    /** Initialize — cache DOM refs and attach events. Call once on page load. */
    function init() {
        containerEl = document.getElementById('as-diversity-container');
        titleEl = document.getElementById('as-donut-title');
        donutWrapEl = document.getElementById('as-donut-wrap');
        donutSvg = document.getElementById('as-donut');
        donutCenter = document.getElementById('as-donut-center');
        legendEl = document.getElementById('as-legend');
        tooltipEl = document.getElementById('as-tooltip');
        panelEl = document.getElementById('as-detail-panel');
        loadingEl = containerEl ? containerEl.querySelector('.as-loading') : null;
        focusedCloseBtn = document.getElementById('as-focused-close');
        insightRectEl = document.getElementById('as-insight-rect');

        // Hover-all: title triggers all-segments highlight; click enters focused mode
        if (titleEl) {
            titleEl.addEventListener('mouseenter', onTitleEnter);
            titleEl.addEventListener('mouseleave', onTitleLeave);
            titleEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!donutFocused) {
                    enterFocusedMode();
                }
            });
        }
        // Donut center: hover previews all lines, click enters focused mode
        // NOTE: We intentionally do NOT add separate mouseenter/mouseleave on as-score-label,
        // because donutCenter already covers it. Adding handlers on the child causes
        // lines to disappear when the mouse moves from the label to the score value
        // (child mouseleave fires while still inside the parent).
        if (donutCenter) {
            donutCenter.addEventListener('mouseenter', onTitleEnter);
            donutCenter.addEventListener('mouseleave', onTitleLeave);
            donutCenter.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!donutFocused) {
                    enterFocusedMode();
                }
            });
        }

        // Focused mode close button (back arrow near donut)
        if (focusedCloseBtn) {
            focusedCloseBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                exitFocusedMode();
            });
        }

        // Close button on detail panel — exit fully
        var closeBtn = panelEl ? panelEl.querySelector('.as-detail-close') : null;
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                if (donutFocused) {
                    exitFocusedMode();
                } else {
                    deselect();
                }
            });
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
        _drawLinesForAllAs = hooks.drawLinesForAllAs || null;
        _clearAsLines = hooks.clearAsLines || null;
        _filterPeerTable = hooks.filterPeerTable || null;
        _dimMapPeers = hooks.dimMapPeers || null;
        _getWorldToScreen = hooks.getWorldToScreen || null;
        _selectPeerById = hooks.selectPeerById || null;
        _zoomToPeerOnly = hooks.zoomToPeerOnly || null;
        _resetMapZoom = hooks.resetMapZoom || null;
        _hideMapTooltip = hooks.hideMapTooltip || null;
    }

    /** Update with new peer data. Called after each fetchPeers(). */
    function update(peers) {
        if (!isActive) return;
        lastPeersRaw = peers;

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

        // Clear transient legend hover focus unless tooltips are pinned (DOM preserved).
        // When pinned, hover listeners are still attached so legendFocusAs stays valid.
        // The persistent sub-sub check in renderLegend handles the pinned case via subSubFilterAsNum.
        if (legendFocusAs && !subTooltipPinned && !subSubTooltipPinned) {
            legendFocusAs = null;
        }
        renderLegend();

        // If peer detail popup is open, don't rebuild filters/lines — popup manages its own state
        // But still allow the underlying panel (summary/provider) to update if needed.
        if (peerDetailActive) {
            // Keep the popup lines/filter for the single peer intact
            return;
        }

        // If a selection is active, refresh the panel + filter + keep lines
        if (selectedAs) {
            var savedCategory = subFilterCategory;
            var savedLabel = subFilterLabel;

            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            // If not in top-8 donut segments, check full asGroups (e.g. provider inside "Others" bucket)
            if (!seg) {
                var grp = asGroups.find(function (g) { return g.asNumber === selectedAs; });
                if (grp) {
                    var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
                    seg = { asNumber: selectedAs, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff', isOthers: false, _synthetic: true };
                }
            }
            if (seg) {
                if (subTooltipPinned || subSubTooltipPinned) {
                    // Sub-tooltip is open — DON'T rebuild panel DOM or change filters.
                    // Keep current peer table filter and dim state intact so drill-down
                    // (e.g. Country > Provider > Peer) isn't disrupted by data refresh.
                    // Just keep lines drawing for the current selection.
                    if (savedCategory && savedLabel) {
                        var freshPeerIds = findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            subFilterPeerIds = freshPeerIds;
                            subFilterCategory = savedCategory;
                            subFilterLabel = savedLabel;
                        }
                    }
                } else {
                    // No sub-tooltip pinned — safe to rebuild panel
                    openPanel(selectedAs);

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
                        } else {
                            subFilterPeerIds = null;
                            subFilterCategory = null;
                            subFilterLabel = null;
                            hideSubTooltip();
                            if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                            if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                            if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
                        }
                    } else {
                        if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                        if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                        if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
                    }
                }
            } else {
                deselect();
            }
        }

        // If summary is active, refresh — but DON'T rebuild the panel DOM if a
        // sub-tooltip is pinned (that destroys pinnedSubTooltipSrc and resets state).
        // Instead, just refresh lines/filters with fresh peer data.
        if (summarySelected) {
            if (subTooltipPinned || subSubTooltipPinned) {
                // Sub-tooltip is open — preserve DOM. Refresh lines/filters with fresh peer data.

                // PRIORITY 1: Sub-sub-tooltip pinned (e.g. IPv6 → Provider → Peers)
                // Draw lines only for the specific provider, not the entire category.
                if (subSubTooltipPinned && subSubFilterAsNum) {
                    var provGroup = asGroups.find(function (g) { return g.asNumber === subSubFilterAsNum; });
                    if (provGroup) {
                        var freshProvPeerIds = provGroup.peerIds;
                        // If there's a parent category filter (e.g. "IPv6"), intersect
                        if (subFilterCategory === 'summary' && subFilterLabel) {
                            var freshSumData = computeSummaryData();
                            var freshCatPeerIds = null;
                            var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                            for (var ci = 0; ci < allCats.length; ci++) {
                                if (!allCats[ci]) continue;
                                for (var ri = 0; ri < allCats[ci].length; ri++) {
                                    if (allCats[ci][ri].label === subFilterLabel) {
                                        freshCatPeerIds = allCats[ci][ri].peerIds;
                                        break;
                                    }
                                }
                                if (freshCatPeerIds) break;
                            }
                            if (freshCatPeerIds) {
                                subFilterPeerIds = freshCatPeerIds;
                                var catSet = {};
                                for (var i = 0; i < freshCatPeerIds.length; i++) catSet[freshCatPeerIds[i]] = true;
                                freshProvPeerIds = [];
                                for (var i = 0; i < provGroup.peerIds.length; i++) {
                                    if (catSet[provGroup.peerIds[i]]) freshProvPeerIds.push(provGroup.peerIds[i]);
                                }
                            }
                        }
                        subSubFilterPeerIds = freshProvPeerIds;
                        var ssColor = subSubFilterColor || getColorForAsNum(subSubFilterAsNum);
                        // If a peer is currently being hovered, preserve that single-peer view
                        if (hoveredPeerId && freshProvPeerIds.indexOf(hoveredPeerId) >= 0) {
                            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, [hoveredPeerId], ssColor);
                            if (_filterPeerTable) _filterPeerTable([hoveredPeerId]);
                            if (_dimMapPeers) _dimMapPeers([hoveredPeerId]);
                        } else {
                            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, freshProvPeerIds, ssColor);
                            if (_filterPeerTable) _filterPeerTable(freshProvPeerIds);
                            if (_dimMapPeers) _dimMapPeers(freshProvPeerIds);
                        }
                    }
                }
                // PRIORITY 2: Sub-tooltip pinned at category level (e.g. "IPv6" showing providers)
                else if (subFilterPeerIds && subFilterCategory && subFilterLabel) {
                    if (subFilterCategory === 'summary') {
                        // Standard summary category — look up fresh peer IDs
                        var freshSumData = computeSummaryData();
                        var freshPeerIds = null;
                        var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                        for (var ci = 0; ci < allCats.length; ci++) {
                            if (!allCats[ci]) continue;
                            for (var ri = 0; ri < allCats[ci].length; ri++) {
                                if (allCats[ci][ri].label === subFilterLabel) {
                                    freshPeerIds = allCats[ci][ri].peerIds;
                                    break;
                                }
                            }
                            if (freshPeerIds) break;
                        }
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            subFilterPeerIds = freshPeerIds;
                            if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                            if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                            if (_drawLinesForAllAs && donutSegments.length > 0) {
                                var idSet = {};
                                for (var i = 0; i < freshPeerIds.length; i++) idSet[freshPeerIds[i]] = true;
                                var groups = [];
                                for (var si = 0; si < donutSegments.length; si++) {
                                    var seg = donutSegments[si];
                                    var filteredIds = [];
                                    for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                        if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                                    }
                                    if (filteredIds.length > 0) {
                                        groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                                    }
                                }
                                _drawLinesForAllAs(groups);
                            }
                        }
                    } else if (subFilterCategory === 'insight-stable') {
                        // "Most stable" insight — refresh by AS number stored in subFilterLabel
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            subFilterPeerIds = provGroup.peerIds;
                            var color = getColorForAsNum(subFilterLabel);
                            if (_drawLinesForAs) _drawLinesForAs(subFilterLabel, provGroup.peerIds, color);
                            if (_filterPeerTable) _filterPeerTable(provGroup.peerIds);
                            if (_dimMapPeers) _dimMapPeers(provGroup.peerIds);
                            // Preserve insight rect state
                            insightActiveAsNum = subFilterLabel;
                            if (donutFocused && insightRectVisible) {
                                var insRectData = getInsightDataForActive();
                                if (insRectData) showInsightRect(insightActiveType, insRectData);
                            } else if (donutFocused) {
                                showFocusedCenterText(subFilterLabel);
                                animateDonutExpand(subFilterLabel);
                            }
                        }
                    } else if (subFilterCategory === 'conn-provider') {
                        // Connection by Provider row — refresh by AS number in subFilterLabel
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            subFilterPeerIds = provGroup.peerIds;
                            var color = getColorForAsNum(subFilterLabel);
                            if (_drawLinesForAs) _drawLinesForAs(subFilterLabel, provGroup.peerIds, color);
                            if (_filterPeerTable) _filterPeerTable(provGroup.peerIds);
                            if (_dimMapPeers) _dimMapPeers(provGroup.peerIds);
                            // Preserve donut state for this provider
                            if (donutFocused) {
                                showFocusedCenterText(subFilterLabel);
                                animateDonutExpand(subFilterLabel);
                            }
                        }
                    } else if (subFilterCategory === 'conn-out') {
                        // Outbound connection row — refresh outbound peers for the AS
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            var outPeerIds = [];
                            for (var i = 0; i < provGroup.peers.length; i++) {
                                if (provGroup.peers[i].direction === 'outbound') outPeerIds.push(provGroup.peers[i].id);
                            }
                            subFilterPeerIds = outPeerIds;
                            if (_filterPeerTable) _filterPeerTable(outPeerIds);
                            if (_dimMapPeers) _dimMapPeers(outPeerIds);
                            // Preserve donut state for this provider
                            if (donutFocused) {
                                showFocusedCenterText(subFilterLabel);
                                animateDonutExpand(subFilterLabel);
                            }
                        }
                    } else if (subFilterCategory === 'conn-in') {
                        // Inbound connection row — refresh inbound peers for the AS
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            var inPeerIds = [];
                            for (var i = 0; i < provGroup.peers.length; i++) {
                                if (provGroup.peers[i].direction === 'inbound') inPeerIds.push(provGroup.peers[i].id);
                            }
                            subFilterPeerIds = inPeerIds;
                            if (_filterPeerTable) _filterPeerTable(inPeerIds);
                            if (_dimMapPeers) _dimMapPeers(inPeerIds);
                            // Preserve donut state for this provider
                            if (donutFocused) {
                                showFocusedCenterText(subFilterLabel);
                                animateDonutExpand(subFilterLabel);
                            }
                        }
                    }
                    // For insight-fastest, insight-data-*, all-providers: just preserve DOM, no filter change
                    // But DO preserve insight rect state for insight providers
                    if (insightActiveAsNum && donutFocused) {
                        if (insightRectVisible) {
                            var insRectData = getInsightDataForActive();
                            if (insRectData) showInsightRect(insightActiveType, insRectData);
                        } else {
                            showFocusedCenterText(insightActiveAsNum);
                            animateDonutExpand(insightActiveAsNum);
                        }
                        // Also re-draw lines for the insight provider (may have shifted after data refresh)
                        var insProvGroup = asGroups.find(function (g) { return g.asNumber === insightActiveAsNum; });
                        if (insProvGroup) {
                            var insColor = getColorForAsNum(insightActiveAsNum);
                            if (_drawLinesForAs) _drawLinesForAs(insightActiveAsNum, insProvGroup.peerIds, insColor);
                            if (_filterPeerTable) _filterPeerTable(insProvGroup.peerIds);
                            if (_dimMapPeers) _dimMapPeers(insProvGroup.peerIds);
                        }
                    }
                } else {
                    // No sub-filter, just keep all-lines going
                    activateHoverAll();
                }
            } else {
                // No sub-tooltip pinned — safe to rebuild the panel
                var savedSumCategory = subFilterCategory;
                var savedSumLabel = subFilterLabel;
                var savedInsightAsNum = insightActiveAsNum;
                var savedInsightType = insightActiveType;

                openSummaryPanel();

                // Restore insight state after panel rebuild
                insightActiveAsNum = savedInsightAsNum;
                insightActiveType = savedInsightType;

                if (savedSumCategory === 'summary' && savedSumLabel) {
                    var freshSumData = computeSummaryData();
                    var freshPeerIds = null;
                    var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                    for (var ci = 0; ci < allCats.length; ci++) {
                        if (!allCats[ci]) continue;
                        for (var ri = 0; ri < allCats[ci].length; ri++) {
                            if (allCats[ci][ri].label === savedSumLabel) {
                                freshPeerIds = allCats[ci][ri].peerIds;
                                break;
                            }
                        }
                        if (freshPeerIds) break;
                    }
                    if (freshPeerIds && freshPeerIds.length > 0) {
                        subFilterPeerIds = freshPeerIds;
                        subFilterCategory = savedSumCategory;
                        subFilterLabel = savedSumLabel;
                        if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                        if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                        highlightActiveSummaryRow();
                        if (_drawLinesForAllAs && donutSegments.length > 0) {
                            var idSet = {};
                            for (var i = 0; i < freshPeerIds.length; i++) idSet[freshPeerIds[i]] = true;
                            var groups = [];
                            for (var si = 0; si < donutSegments.length; si++) {
                                var seg = donutSegments[si];
                                var filteredIds = [];
                                for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                    if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                                }
                                if (filteredIds.length > 0) {
                                    groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                                }
                            }
                            _drawLinesForAllAs(groups);
                        }
                    } else {
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        hideSubTooltip();
                        hideSubSubTooltip();
                        activateHoverAll();
                    }
                } else if (savedInsightAsNum) {
                    // Insight was active (e.g. Most Stable, Fastest) — preserve its rect/line state
                    var insightPeerIds = getPeerIdsForAnyAs(savedInsightAsNum);
                    var insightColor = getColorForAsNum(savedInsightAsNum);
                    if (insightPeerIds.length > 0 && _drawLinesForAs) {
                        _drawLinesForAs(savedInsightAsNum, insightPeerIds, insightColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(insightPeerIds);
                    if (_dimMapPeers) _dimMapPeers(insightPeerIds);
                    setLegendFocus(savedInsightAsNum);
                    if (donutFocused) {
                        if (insightRectVisible) {
                            var insRectData = getInsightDataForActive();
                            if (insRectData) showInsightRect(insightActiveType, insRectData);
                        } else {
                            showFocusedCenterText(savedInsightAsNum);
                            animateDonutExpand(savedInsightAsNum);
                        }
                    }
                } else {
                    activateHoverAll();
                }
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

    /** Get the line origin position for a given AS number.
     *  - If asNum is a top-8 segment, returns that segment's legend dot.
     *  - If asNum is in the "Others" group, returns the "Others" legend dot.
     *  - Final fallback: donut center (only when legend genuinely not rendered). */
    function getLineOriginForAs(asNum) {
        // In focused mode, lines always come from donut center (legend is hidden)
        if (donutFocused) return getDonutCenter();

        // First: direct legend dot match (works for top-8 and selected AS)
        var direct = getLegendDotPosition(asNum);
        if (direct) return direct;

        // Second: check if this AS is inside the "Others" bucket
        if (donutSegments) {
            for (var i = 0; i < donutSegments.length; i++) {
                var seg = donutSegments[i];
                if (seg.isOthers && seg._othersGroups) {
                    for (var j = 0; j < seg._othersGroups.length; j++) {
                        if (seg._othersGroups[j].asNumber === asNum) {
                            // Found in Others — use the Others legend dot
                            return getLegendDotPosition('Others');
                        }
                    }
                }
            }
        }

        // Final fallback: donut center (only when legend genuinely not rendered)
        return getDonutCenter();
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
        hasSubTooltip: function () { return subTooltipPinned || subSubTooltipPinned; },
        onMapClick: onMapClick,
        isViewActive: isViewActive,
        getDonutCenter: getDonutCenter,
        getLegendDotPosition: getLegendDotPosition,
        getLineOriginForAs: getLineOriginForAs,
        getHoveredAs: getHoveredAs,
        getHoveredAll: function () { return hoveredAll || summarySelected; },
        getSelectedAs: getSelectedAs,
        getSummarySelected: function () { return summarySelected; },
        getPeerIdsForAs: getPeerIdsForAs,
        getColorForAs: getColorForAs,
        getSegments: getSegments,
        collapseToMainPanel: collapseToMainPanel,
        // Focused mode
        enterFocusedMode: enterFocusedMode,
        exitFocusedMode: exitFocusedMode,
        isFocusedMode: isFocusedMode,
        // Peer detail popup (from peer list or map dot)
        openPeerDetailPanel: openPeerDetailPanel,
        closePeerPopup: closePeerPopup,
        getLastPeersRaw: function () { return lastPeersRaw; },
    };
})();
