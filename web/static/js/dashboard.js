/**
 * MBTC-DASH - Dashboard JavaScript
 * Handles peer data fetching, table rendering, map, and real-time updates
 */

// Configuration
const REFRESH_INTERVAL = 10000; // 10 seconds
const API_BASE = '';

// Antarctica coords for private locations
const ANTARCTICA_LAT = -82.8628;
const ANTARCTICA_LON = 135.0000;

// North Pole coords for unavailable locations
const NORTH_POLE_LAT = 90.0;
const NORTH_POLE_LON = 0.0;

// State
let currentPeers = [];
let sortColumn = 'id';
let sortDirection = 'asc';
let refreshTimer = null;
let countdown = 10;
let eventSource = null;
let map = null;
let markers = {};

// DOM Elements
const peerTbody = document.getElementById('peer-tbody');
const peerCount = document.getElementById('peer-count');
const statusIndicator = document.getElementById('status-indicator');
const connectionStatus = document.getElementById('connection-status');
const refreshTimerEl = document.getElementById('refresh-timer');
const changesTbody = document.getElementById('changes-tbody');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupTableSorting();
    initMap();
    fetchPeers();
    fetchStats();
    fetchChanges();
    setupSSE();
    startCountdown();
});

// Initialize Leaflet map
function initMap() {
    map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        minZoom: 1,
        maxZoom: 18,
        worldCopyJump: true
    });

    // Dark tile layer (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);
}

// Update map markers
function updateMap() {
    // Clear existing markers
    Object.values(markers).forEach(marker => map.removeLayer(marker));
    markers = {};

    currentPeers.forEach(peer => {
        let lat, lon, color;

        if (peer.location_status === 'private') {
            lat = ANTARCTICA_LAT + (Math.random() - 0.5) * 5;
            lon = ANTARCTICA_LON + (Math.random() - 0.5) * 30;
            color = '#d29922'; // yellow
        } else if (peer.location_status === 'unavailable') {
            lat = NORTH_POLE_LAT - Math.random() * 5;
            lon = NORTH_POLE_LON + (Math.random() - 0.5) * 180;
            color = '#6e7681'; // gray
        } else if (peer.lat && peer.lon) {
            lat = peer.lat;
            lon = peer.lon;
            color = '#3fb950'; // green
        } else {
            return; // Skip if no location
        }

        const marker = L.circleMarker([lat, lon], {
            radius: 6,
            fillColor: color,
            color: '#ffffff',
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.7
        });

        marker.bindPopup(`
            <strong>${peer.ip}</strong><br>
            ${peer.location}<br>
            ${peer.isp || '-'}<br>
            <span style="color: ${peer.direction === 'IN' ? '#3fb950' : '#58a6ff'}">${peer.direction}</span>
            | ${peer.subver}
        `);

        marker.addTo(map);
        markers[peer.id] = marker;
    });
}

// Setup table column sorting
function setupTableSorting() {
    const headers = document.querySelectorAll('.peer-table th[data-sort]');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            if (sortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = column;
                sortDirection = 'asc';
            }

            // Update header styles
            headers.forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
            header.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

            renderPeers();
        });
    });
}

// Fetch peer data from API
async function fetchPeers() {
    try {
        const response = await fetch(`${API_BASE}/api/peers`);
        if (!response.ok) throw new Error('Failed to fetch peers');

        currentPeers = await response.json();
        renderPeers();
        updateMap();

        // Update status
        statusIndicator.classList.add('connected');
        statusIndicator.classList.remove('error');
        connectionStatus.textContent = 'Connected';
    } catch (error) {
        console.error('Error fetching peers:', error);
        statusIndicator.classList.add('error');
        statusIndicator.classList.remove('connected');
        connectionStatus.textContent = 'Error';

        peerTbody.innerHTML = `
            <tr class="loading-row">
                <td colspan="10">Error loading peers. Is bitcoind running?</td>
            </tr>
        `;
    }
}

// Fetch stats from API
async function fetchStats() {
    try {
        const response = await fetch(`${API_BASE}/api/stats`);
        if (!response.ok) throw new Error('Failed to fetch stats');

        const stats = await response.json();

        document.getElementById('stat-connected').textContent = stats.connected || 0;
        document.getElementById('stat-geolocated').textContent = stats.geo_ok || 0;
        document.getElementById('stat-private').textContent = stats.private || 0;
        document.getElementById('stat-ipv4').textContent = stats.ipv4 || 0;
        document.getElementById('stat-ipv6').textContent = stats.ipv6 || 0;
        document.getElementById('stat-onion').textContent = stats.onion || 0;
        document.getElementById('stat-i2p').textContent = stats.i2p || 0;
        document.getElementById('stat-lastupdate').textContent = stats.last_update || '-';
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

// Fetch recent changes from API
async function fetchChanges() {
    try {
        const response = await fetch(`${API_BASE}/api/changes`);
        if (!response.ok) throw new Error('Failed to fetch changes');

        const changes = await response.json();
        renderChanges(changes);
    } catch (error) {
        console.error('Error fetching changes:', error);
    }
}

// Render recent changes table
function renderChanges(changes) {
    if (!changes || changes.length === 0) {
        changesTbody.innerHTML = `
            <tr class="loading-row">
                <td colspan="4">No recent changes</td>
            </tr>
        `;
        return;
    }

    const rows = changes.map(change => {
        const time = new Date(change.time * 1000).toLocaleTimeString();
        const eventClass = change.type === 'connected' ? 'event-connected' : 'event-disconnected';

        return `
            <tr>
                <td>${time}</td>
                <td class="${eventClass}">${change.type}</td>
                <td>${change.peer.ip || '-'}</td>
                <td>${change.peer.network || '-'}</td>
            </tr>
        `;
    }).join('');

    changesTbody.innerHTML = rows;
}

// Setup Server-Sent Events for real-time updates
function setupSSE() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource(`${API_BASE}/api/events`);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'connected':
                console.log('SSE connected');
                break;
            case 'peers_update':
                fetchPeers();
                fetchStats();
                fetchChanges();
                resetCountdown();
                break;
            case 'geo_update':
                // Geo data updated for a specific IP, refresh to get new data
                fetchPeers();
                break;
            case 'keepalive':
                // Just a keepalive, do nothing
                break;
        }
    };

    eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        statusIndicator.classList.remove('connected');
        connectionStatus.textContent = 'Reconnecting...';

        // Reconnect after 5 seconds
        setTimeout(setupSSE, 5000);
    };
}

// Render peers to table
function renderPeers() {
    if (currentPeers.length === 0) {
        peerTbody.innerHTML = `
            <tr class="loading-row">
                <td colspan="10">No peers connected</td>
            </tr>
        `;
        peerCount.textContent = '0 peers';
        return;
    }

    // Sort peers
    const sortedPeers = [...currentPeers].sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        // Handle numeric sorting
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }

        // Handle null/undefined
        if (aVal == null) aVal = '';
        if (bVal == null) bVal = '';

        // String comparison
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortDirection === 'asc' ? cmp : -cmp;
    });

    // Build table HTML
    const rows = sortedPeers.map(peer => {
        const networkClass = `network-${peer.network}`;
        const directionClass = peer.inbound ? 'in' : 'out';

        // Location class
        let locationClass = '';
        if (peer.location === 'PRIVATE LOCATION') {
            locationClass = 'location-private';
        } else if (peer.location === 'LOCATION UNAVAILABLE') {
            locationClass = 'location-unavailable';
        } else if (peer.location === 'Stalking location...') {
            locationClass = 'location-pending';
        }

        return `
            <tr data-id="${peer.id}">
                <td>${peer.id}</td>
                <td class="${networkClass}" title="${peer.addr}">${truncate(peer.ip, 22)}</td>
                <td class="${locationClass}" title="${peer.city ? `${peer.city}, ${peer.region}, ${peer.country}` : ''}">${truncate(peer.location, 20)}</td>
                <td title="${peer.isp}">${truncate(peer.isp || '-', 16)}</td>
                <td><span class="direction-badge ${directionClass}">${peer.direction}</span></td>
                <td>${peer.ping_ms != null ? peer.ping_ms + 'ms' : '-'}</td>
                <td>${peer.bytesrecv_fmt}</td>
                <td>${peer.bytessent_fmt}</td>
                <td>${peer.conntime_fmt}</td>
                <td title="${peer.subver}">${truncate(peer.subver, 18)}</td>
            </tr>
        `;
    }).join('');

    peerTbody.innerHTML = rows;
    peerCount.textContent = `${currentPeers.length} peers`;
}

// Truncate string
function truncate(str, maxLen) {
    if (!str) return '-';
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
}

// Countdown timer
function startCountdown() {
    countdown = REFRESH_INTERVAL / 1000;
    updateCountdownDisplay();

    refreshTimer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
            countdown = REFRESH_INTERVAL / 1000;
        }
        updateCountdownDisplay();
    }, 1000);
}

function resetCountdown() {
    countdown = REFRESH_INTERVAL / 1000;
    updateCountdownDisplay();
}

function updateCountdownDisplay() {
    refreshTimerEl.textContent = `Refreshing in ${countdown}s`;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (eventSource) {
        eventSource.close();
    }
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
});
