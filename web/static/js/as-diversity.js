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
    const DONUT_SIZE = 220;      // SVG viewBox size
    const DONUT_RADIUS = 98;     // Outer radius of the donut ring
    const DONUT_WIDTH = 24;      // Width of the donut ring
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

    let isActive = false;          // Is the AS Diversity view currently shown?
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

    // Integration hooks (set by bitapp.js)
    let _drawLinesForAs = null;    // fn(asNumber, peerIds, color) — draw lines on canvas
    let _clearAsLines = null;      // fn() — clear AS lines from canvas
    let _filterPeerTable = null;   // fn(peerIds | null) — filter peer table
    let _dimMapPeers = null;       // fn(peerIds | null) — dim non-matching peers
    let _getWorldToScreen = null;  // fn(lon, lat) => {x, y}

    // ═══════════════════════════════════════════════════════════
    // PARSING & AGGREGATION
    // ═══════════════════════════════════════════════════════════

    /** Extract AS number from the "AS12345 Org Name" string */
    function parseAsNumber(asField) {
        if (!asField) return null;
        const m = asField.match(/^(AS\d+)/);
        return m ? m[1] : null;
    }

    /** Extract org name from the "AS12345 Org Name" string */
    function parseAsOrg(asField) {
        if (!asField) return '';
        const m = asField.match(/^AS\d+\s+(.+)/);
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
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm';
    }

    /** Get hosting label from peer flags */
    function getHostingLabel(peers) {
        const hostingCount = peers.filter(p => p.hosting).length;
        const ratio = hostingCount / peers.length;
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
        const map = {};
        let locatablePeers = 0;

        for (const p of peers) {
            const asNum = parseAsNumber(p.as);
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
        const groups = Object.values(map).map(g => {
            const peers = g.peers;
            const count = peers.length;
            const pct = totalPeers > 0 ? (count / totalPeers) * 100 : 0;

            // Inbound / outbound
            const inbound = peers.filter(p => p.direction === 'IN').length;
            const outbound = count - inbound;

            // Connection types
            const connTypes = {};
            for (const p of peers) {
                const t = p.connection_type || 'unknown';
                connTypes[t] = (connTypes[t] || 0) + 1;
            }

            // Performance
            const pings = peers.map(p => p.ping_ms).filter(v => v > 0);
            const avgPing = pings.length > 0 ? pings.reduce((a, b) => a + b, 0) / pings.length : 0;

            const nowSec = Math.floor(Date.now() / 1000);
            const durations = peers.map(p => p.conntime > 0 ? nowSec - p.conntime : 0).filter(v => v > 0);
            const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

            const totalSent = peers.reduce((s, p) => s + (p.bytessent || 0), 0);
            const totalRecv = peers.reduce((s, p) => s + (p.bytesrecv || 0), 0);

            // Software versions
            const verMap = {};
            for (const p of peers) {
                const v = p.subver || 'Unknown';
                verMap[v] = (verMap[v] || 0) + 1;
            }
            const versions = Object.entries(verMap)
                .map(([subver, cnt]) => ({ subver, count: cnt }))
                .sort((a, b) => b.count - a.count);

            // Countries
            const countryMap = {};
            for (const p of peers) {
                if (!p.countryCode || p.countryCode === '') continue;
                const key = p.countryCode;
                if (!countryMap[key]) countryMap[key] = { code: key, name: p.country || key, count: 0 };
                countryMap[key].count++;
            }
            const countries = Object.values(countryMap).sort((a, b) => b.count - a.count);

            // Service flag combos
            const svcMap = {};
            for (const p of peers) {
                const s = p.services_abbrev || '\u2014';
                svcMap[s] = (svcMap[s] || 0) + 1;
            }
            const servicesCombos = Object.entries(svcMap)
                .map(([abbrev, cnt]) => ({ abbrev, count: cnt }))
                .sort((a, b) => b.count - a.count);

            const risk = getRisk(pct);

            return {
                asNumber: g.asNumber,
                asName: g.asName,
                asShort: g.asShort,
                peerCount: count,
                percentage: pct,
                inboundCount: inbound,
                outboundCount: outbound,
                connTypes,
                avgPingMs: avgPing,
                avgDurationSecs: avgDuration,
                avgDurationFmt: fmtDuration(avgDuration),
                totalBytesSent: totalSent,
                totalBytesRecv: totalRecv,
                totalBytesSentFmt: fmtBytes(totalSent),
                totalBytesRecvFmt: fmtBytes(totalRecv),
                versions,
                countries,
                servicesCombos,
                hostingLabel: getHostingLabel(peers),
                riskLevel: risk.level,
                riskLabel: risk.label,
                peerIds: peers.map(p => p.id),
                color: '#6e7681',  // assigned later from palette
            };
        });

        // Sort by peer count descending
        groups.sort((a, b) => b.peerCount - a.peerCount);
        return groups;
    }

    /** Calculate Herfindahl-Hirschman diversity score (0-10) */
    function calcDiversityScore(groups) {
        if (totalPeers === 0) return 0;
        let hhi = 0;
        for (const g of groups) {
            const share = g.peerCount / totalPeers;
            hhi += share * share;
        }
        return Math.round((1 - hhi) * 100) / 10; // 0.0 to 10.0
    }

    /** Build donut segments: top N + Others bucket */
    function buildDonutSegments(groups) {
        const top = groups.slice(0, MAX_SEGMENTS);
        const rest = groups.slice(MAX_SEGMENTS);

        // Assign colors
        for (let i = 0; i < top.length; i++) {
            top[i].color = PALETTE[i % PALETTE.length];
        }

        const segments = [...top];

        if (rest.length > 0) {
            const othersCount = rest.reduce((s, g) => s + g.peerCount, 0);
            const othersPct = totalPeers > 0 ? (othersCount / totalPeers) * 100 : 0;
            segments.push({
                asNumber: 'Others',
                asName: rest.length + ' other providers',
                asShort: '',
                peerCount: othersCount,
                percentage: othersPct,
                riskLevel: 'low',
                riskLabel: '',
                color: PALETTE[PALETTE.length - 1],
                peerIds: rest.flatMap(g => g.peerIds),
                isOthers: true,
                // Store the individual groups for the detail panel
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
        const sweep = endAngle - startAngle;
        const actualEnd = sweep >= 2 * Math.PI ? startAngle + 2 * Math.PI - 0.001 : endAngle;
        const largeArc = sweep > Math.PI ? 1 : 0;

        const ox1 = cx + outerR * Math.cos(startAngle);
        const oy1 = cy + outerR * Math.sin(startAngle);
        const ox2 = cx + outerR * Math.cos(actualEnd);
        const oy2 = cy + outerR * Math.sin(actualEnd);
        const ix1 = cx + innerR * Math.cos(actualEnd);
        const iy1 = cy + innerR * Math.sin(actualEnd);
        const ix2 = cx + innerR * Math.cos(startAngle);
        const iy2 = cy + innerR * Math.sin(startAngle);

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

        const cx = DONUT_SIZE / 2;
        const cy = DONUT_SIZE / 2;
        const gap = 0.03; // gap between segments in radians
        let html = '';

        // SVG defs for drop shadow and gradients
        html += '<defs>';
        html += '<filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">';
        html += '<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.5"/>';
        html += '</filter>';
        // Subtle inner glow
        html += '<filter id="donut-glow" x="-10%" y="-10%" width="120%" height="120%">';
        html += '<feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>';
        html += '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>';
        html += '</filter>';
        html += '</defs>';

        // Background track ring (subtle)
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="rgba(88,166,255,0.04)" stroke-width="' + DONUT_WIDTH + '" />';

        // Outer decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS + 2) + '" fill="none" stroke="rgba(88,166,255,0.08)" stroke-width="1" />';

        // Inner decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (INNER_RADIUS - 2) + '" fill="none" stroke="rgba(88,166,255,0.06)" stroke-width="0.5" />';

        if (donutSegments.length === 0) {
            // Empty state — pulsing gray ring
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="#2d333b" stroke-width="' + DONUT_WIDTH + '" opacity="0.5" />';
        } else if (donutSegments.length === 1) {
            const seg = donutSegments[0];
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="' + seg.color + '" stroke-width="' + DONUT_WIDTH + '" class="as-donut-segment" data-as="' + seg.asNumber + '" filter="url(#donut-shadow)" />';
        } else {
            const totalGap = gap * donutSegments.length;
            const available = 2 * Math.PI - totalGap;
            let angle = -Math.PI / 2; // start at top

            // Group for shadow on all segments
            html += '<g filter="url(#donut-shadow)">';
            for (const seg of donutSegments) {
                const sweep = (seg.peerCount / totalPeers) * available;
                if (sweep <= 0) continue;

                const startA = angle + gap / 2;
                const endA = angle + sweep + gap / 2;
                const d = describeArc(cx, cy, DONUT_RADIUS, INNER_RADIUS, startA, endA);

                const cls = ['as-donut-segment'];
                if (selectedAs && selectedAs !== seg.asNumber) cls.push('dimmed');
                if (selectedAs === seg.asNumber) cls.push('selected');

                html += '<path d="' + d + '" fill="' + seg.color + '" class="' + cls.join(' ') + '" data-as="' + seg.asNumber + '" />';
                angle += sweep + gap;
            }
            html += '</g>';
        }

        donutSvg.innerHTML = html;

        // Hide loading once we have data
        if (donutSegments.length > 0 && loadingEl) {
            loadingEl.style.display = 'none';
            hasRenderedOnce = true;
        }

        // Attach segment event listeners
        donutSvg.querySelectorAll('.as-donut-segment').forEach(function (el) {
            el.addEventListener('mouseenter', onSegmentHover);
            el.addEventListener('mouseleave', onSegmentLeave);
            el.addEventListener('click', onSegmentClick);
        });
    }

    /** Update the donut center label */
    function renderCenter() {
        if (!donutCenter) return;
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var scoreLbl = donutCenter.querySelector('.as-score-label');
        if (!scoreVal || !scoreLbl) return;

        if (totalPeers === 0) {
            scoreVal.textContent = '\u2014';
            scoreLbl.textContent = 'NO DATA';
            scoreVal.className = 'as-score-value';
            return;
        }

        scoreVal.textContent = diversityScore.toFixed(1);

        // Remove old score classes
        scoreVal.classList.remove('as-score-excellent', 'as-score-good', 'as-score-moderate', 'as-score-poor', 'as-score-critical');

        if (diversityScore >= 8) scoreVal.classList.add('as-score-excellent');
        else if (diversityScore >= 6) scoreVal.classList.add('as-score-good');
        else if (diversityScore >= 4) scoreVal.classList.add('as-score-moderate');
        else if (diversityScore >= 2) scoreVal.classList.add('as-score-poor');
        else scoreVal.classList.add('as-score-critical');

        scoreLbl.textContent = totalPeers + ' PEERS';
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
            var shortName = displayName.length > 20 ? displayName.substring(0, 19) + '\u2026' : displayName;

            html += '<div class="' + cls.join(' ') + '" data-as="' + seg.asNumber + '">';
            html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
            html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
            html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
            html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
            html += '</div>';
        }
        legendEl.innerHTML = html;

        // Attach legend event listeners
        legendEl.querySelectorAll('.as-legend-item').forEach(function (el) {
            el.addEventListener('mouseenter', onSegmentHover);
            el.addEventListener('mouseleave', onSegmentLeave);
            el.addEventListener('click', onSegmentClick);
        });
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

        // Position near cursor
        var rect = tooltipEl.getBoundingClientRect();
        var pad = 12;
        var x = event.clientX + pad;
        var y = event.clientY + pad;
        if (x + rect.width > window.innerWidth - pad) x = event.clientX - rect.width - pad;
        if (y + rect.height > window.innerHeight - pad) y = event.clientY - rect.height - pad;
        tooltipEl.style.left = x + 'px';
        tooltipEl.style.top = y + 'px';
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.classList.add('hidden');
    }

    // ═══════════════════════════════════════════════════════════
    // DETAIL PANEL — Right slide-in
    // ═══════════════════════════════════════════════════════════

    function openPanel(asNum) {
        if (!panelEl) return;
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        if (!seg) return;

        // For "Others" bucket, show the full list of individual ASes
        // For real ASes, get the full aggregated group
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
            // Full list of all individual ASes in the Others bucket
            html += '<div class="modal-section-title">Summary</div>';
            html += row('Total Peers', seg.peerCount);
            html += row('Providers', seg._othersGroups ? seg._othersGroups.length : '?');
            html += row('Share', seg.percentage.toFixed(1) + '%');

            // List each individual AS
            if (seg._othersGroups && seg._othersGroups.length > 0) {
                html += '<div class="modal-section-title">All Providers</div>';
                for (var i = 0; i < seg._othersGroups.length; i++) {
                    var g = seg._othersGroups[i];
                    var gName = g.asShort || g.asName || g.asNumber;
                    if (gName.length > 24) gName = gName.substring(0, 23) + '\u2026';
                    html += subRow(g.asNumber + ' \u00b7 ' + gName, g.peerCount + ' peer' + (g.peerCount !== 1 ? 's' : ''));
                }
            }
        } else {
            // Full detail for a specific AS
            html += '<div class="modal-section-title">Peers</div>';
            html += row('Total', fullGroup.peerCount);
            html += row('Inbound', fullGroup.inboundCount);
            html += row('Outbound', fullGroup.outboundCount);
            // Connection type breakdown
            if (fullGroup.connTypes) {
                var typeLabels = {
                    'outbound-full-relay': 'Full Relay',
                    'block-relay-only': 'Block-Only',
                    'inbound': 'Inbound',
                    'manual': 'Manual',
                    'addr-fetch': 'Addr Fetch',
                    'feeler': 'Feeler',
                };
                for (var t in fullGroup.connTypes) {
                    if (fullGroup.connTypes.hasOwnProperty(t)) {
                        html += row(typeLabels[t] || t, fullGroup.connTypes[t]);
                    }
                }
            }

            html += '<div class="modal-section-title">Performance</div>';
            html += row('Avg Duration', fullGroup.avgDurationFmt);
            html += row('Avg Ping', fullGroup.avgPingMs > 0 ? Math.round(fullGroup.avgPingMs) + 'ms' : '\u2014');
            html += row('Data Sent', fullGroup.totalBytesSentFmt);
            html += row('Data Recv', fullGroup.totalBytesRecvFmt);

            // Software versions
            if (fullGroup.versions && fullGroup.versions.length > 0) {
                html += '<div class="modal-section-title">Software</div>';
                for (var vi = 0; vi < fullGroup.versions.length; vi++) {
                    html += subRow(fullGroup.versions[vi].subver, fullGroup.versions[vi].count + ' peer' + (fullGroup.versions[vi].count !== 1 ? 's' : ''));
                }
            }

            // Countries
            if (fullGroup.countries && fullGroup.countries.length > 0) {
                html += '<div class="modal-section-title">Countries</div>';
                for (var ci = 0; ci < fullGroup.countries.length; ci++) {
                    html += subRow(fullGroup.countries[ci].code + '  ' + fullGroup.countries[ci].name, fullGroup.countries[ci].count);
                }
            }

            // Services
            if (fullGroup.servicesCombos && fullGroup.servicesCombos.length > 0) {
                html += '<div class="modal-section-title">Services</div>';
                for (var si = 0; si < fullGroup.servicesCombos.length; si++) {
                    html += subRow(fullGroup.servicesCombos[si].abbrev, fullGroup.servicesCombos[si].count + ' peer' + (fullGroup.servicesCombos[si].count !== 1 ? 's' : ''));
                }
            }
        }

        bodyEl.innerHTML = html;

        // Show panel with animation
        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
    }

    function closePanel() {
        if (!panelEl) return;
        panelEl.classList.remove('visible');
        setTimeout(function () {
            if (!panelEl.classList.contains('visible')) {
                panelEl.classList.add('hidden');
            }
        }, 260);
    }

    function row(label, value) {
        return '<div class="modal-row"><span class="modal-label">' + label + '</span><span class="modal-val">' + value + '</span></div>';
    }

    function subRow(label, value) {
        return '<div class="as-detail-sub-row"><span class="as-detail-sub-label">' + label + '</span><span class="as-detail-sub-val">' + value + '</span></div>';
    }

    // ═══════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════

    function onSegmentHover(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;
        hoveredAs = asNum;
        showTooltip(asNum, e);

        // Only draw hover lines if nothing is selected, or if hovering a different AS than selected
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
            // Select this AS
            selectedAs = asNum;
            var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
            if (seg) {
                openPanel(asNum);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(asNum, seg.peerIds, seg.color);
            }
            renderDonut();
            renderLegend();
        }
    }

    function deselect() {
        selectedAs = null;
        closePanel();
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        if (_clearAsLines) _clearAsLines();
        renderDonut();
        renderLegend();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape' && selectedAs && isActive) {
            deselect();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PUBLIC API — Called by bitapp.js
    // ═══════════════════════════════════════════════════════════

    /** Initialize — cache DOM refs and attach events. Call once on page load. */
    function init() {
        containerEl = document.getElementById('as-diversity-container');
        donutWrapEl = containerEl ? containerEl.querySelector('.as-donut-wrap') : null;
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

        // Escape key
        document.addEventListener('keydown', onKeyDown);
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

        asGroups = aggregatePeers(peers);
        diversityScore = calcDiversityScore(asGroups);
        donutSegments = buildDonutSegments(asGroups);

        renderDonut();
        renderCenter();
        renderLegend();

        // If a selection is active, refresh the panel + filter + keep lines
        if (selectedAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            if (seg) {
                openPanel(selectedAs);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
            } else {
                deselect();
            }
        }
    }

    /** Activate the AS Diversity view */
    function activate() {
        isActive = true;
        if (containerEl) containerEl.classList.remove('hidden');
        // Show loading indicator if we haven't rendered yet
        if (!hasRenderedOnce && loadingEl) {
            loadingEl.style.display = '';
        }
    }

    /** Deactivate the AS Diversity view */
    function deactivate() {
        isActive = false;
        if (containerEl) containerEl.classList.add('hidden');
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
        isViewActive: isViewActive,
        getDonutCenter: getDonutCenter,
        getHoveredAs: getHoveredAs,
        getSelectedAs: getSelectedAs,
        getPeerIdsForAs: getPeerIdsForAs,
        getColorForAs: getColorForAs,
        getSegments: getSegments,
    };
})();
