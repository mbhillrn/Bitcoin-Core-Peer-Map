# Major Program Restructure - Implementation Plan

## Overview
Transform the UI from a static layout into a two-mode system: **Default Mode** (current layout) and **Focused Mode** (activated by clicking donut center). This involves repositioning elements, adding rich animations, creating new peer detail views, and making all state update-proof against the 10-second poll cycle.

---

## Phase 1: Cache Busting + Donut Title Rename (Quick Wins)

### 1A: Cache Busting
- **Backend** (`MBCoreServer.py`): Add `cache_bust = int(time.time())` to template context
- **Template** (`bitindex.html`): Append `?v={{ cache_bust }}` to all static asset URLs:
  - `bitstyle.css`, `as-diversity.css`, `as-diversity.js`, `bitapp.js`
- localStorage settings (themes, sliders) remain untouched - only file loads are busted

### 1B: Donut Title Rename
- **HTML** (`bitindex.html`): Change title from "Service Provider / Diversity" to "Peer Service Providers"
  - `<span class="as-title-provider">Peer Service Providers</span>` (one line, no `<br>`)
  - Remove "Diversity" from external title entirely
- **Inside donut center** (`as-diversity.js` `renderCenter()`):
  - Add "DIVERSITY" text above "SCORE:" in the donut center (new div `as-score-diversity`)
  - Remove "Diversity summary" link text, keep just the score display
- **CSS**: Style the new "PEER" word in same color/size as current "SERVICE PROVIDER", adjust title layout

---

## Phase 2: Focused Mode Architecture

### Core Concept
A CSS class `body.donut-focused` drives all layout transitions. A JS state variable `donutFocused` tracks the mode.

### 2A: Mode Toggle
- **Trigger**: Click on donut CENTER area (the score/quality text area)
- **Exit**: Close button near donut OR close button in panel OR double-click blank map space (gradual: first click = back to panel top, second = exit focused mode)
- Add small close/back arrow button near donut in focused mode (top-right of donut area)

### 2B: Layout Transitions (CSS-driven with `body.donut-focused`)

**BTC Price Bar:**
- Default: `position: fixed; top: 52px; left: 50%; transform: translateX(-50%)`
- Focused: Shrinks slightly (scale 0.85), moves under system info overlay (left: 18px, top: ~220px)
- Transition: `all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)` (slight overshoot bounce)

**Donut Container:**
- Default: `position: fixed; top: 52px; right: 14px`
- Focused: Shrinks (scale ~0.75), moves to top-center where BTC price was (`left: 50%; transform: translateX(-50%); right: auto`)
- When panel is ALSO open: centers between system info right edge and panel left edge
  - `left: calc((180px + (100vw - 320px)) / 2)` approximately
  - Dynamic recalc on resize and panel open/close
- Title disappears (opacity 0, height 0)
- Legend (top 8 list) disappears in focused default, only shows on segment interactions
- Transition: `all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)`

**Map Controls:**
- Default: `position: fixed; top: 88px; left: 50%; transform: translateX(-50%)`
- Focused: Moves to upper-right where donut title used to be (`right: 14px; left: auto`)
- Transition: `all 0.4s cubic-bezier(0.4, 0, 0.2, 1)`

**Map Canvas:**
- When panel opens in focused mode: map doesn't get smushed (stays full width)
- Donut recenters dynamically between left content and right panel edge

### 2C: Donut Center Behavior in Focused Mode
- Hovering segments: Provider name appears in center (replaces score)
  - Name displayed in segment color
  - Multi-line layout for long names: peer count / name parts / AS number
  - Smart line-breaking for names with dashes (e.g., SNCL-1-0001 → SNCL-1 / 0001)
- Lines radiate from donut center to hovered provider's peers
- Clicking segment: selects provider (see Phase 3)
- Clicking "Others" segment: scrollable provider list appears inside donut center

### 2D: "Others" Scrollable List Inside Donut
- When in focused mode and Others segment is clicked:
  - Donut center transforms into scrollable container
  - Small back arrow (←) at top of center area
  - Provider names listed, colored blue (Others color)
  - Each name hoverable (preview lines) and clickable (opens AS panel)
  - Thin custom scrollbar matching accent color
  - Max height = donut inner diameter

---

## Phase 3: Donut Segment Animation + Provider Selection

### 3A: Segment Expansion Animation
When a provider is selected (clicked):
- Selected color's arc EXPANDS to fill ~70% of the donut (bottom portion)
- Other colors COMPRESS into the top ~30%, maintaining relative proportions
- Animation via `requestAnimationFrame` interpolating segment angles over ~400ms
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`
- Center text crossfades to provider name + peer count in segment color

### 3B: Animation State Machine
States for donut animation:
- `idle` - normal proportional segments
- `animating` - transitioning to/from expanded state
- `expanded` - one segment fills bottom, rest compressed top
- `reverting` - transitioning back to idle

Key rule: The 10-second update MUST NOT interfere with animation state. `renderDonut()` checks animation state and uses animated angles instead of data-proportional angles when animating/expanded.

### 3C: Lines from Donut Center
- In focused mode, lines originate from donut center (top-center of screen)
- Creates dramatic starburst/spider-web effect across the map
- Lines fade in with alpha ramp (0 at origin → full at destination)
- When hovering a specific peer in submenu: only ONE line drawn to that peer

### 3D: Panel Opening in Focused Mode
- Right panel slides in (same 320px, same animation)
- Map does NOT get smushed/pushed
- Donut RECENTERS between left edge of map content and right panel edge
- Smooth transition for donut position change

---

## Phase 4: Peer Selection Paths

### 4A: Click Peer from Bottom Peer List
1. Donut enters focused mode (if not already)
2. Donut animates to that peer's provider (segment expands, color fills bottom)
3. Single line drawn from donut center to that peer
4. Provider name + peer ID shown in donut center
5. Right panel opens with FULL peer detail (all getpeerinfo data):
   - Peer ID, address, network type
   - Direction (inbound/outbound), connection type
   - Ping, connection time, uptime
   - Software version, services
   - Location (city, region, country)
   - ISP / AS info
   - Bytes sent/received
   - Address manager status (in_addrman)
   - Block height (if available)
   - Any other available peer data
6. Map zooms smoothly to peer location
7. Back button in panel returns to previous state

### 4B: Click Peer from Summary Panel Submenu
1. Map popup/tooltip appears near the peer on the map (existing tooltip behavior)
2. Map zooms to peer
3. Panel stays where it is (no replacement)
4. Line drawn to that single peer
5. Donut center shows peer ID + provider name
6. When selecting a different item from panel, previous peer's popup CLOSES

### 4C: Click Peer Dot on Map
- If single peer at that location:
  - Same behavior as clicking from peer list (4A) - full panel opens
  - Donut animates to provider, line drawn
- If multiple peers at location:
  - Multi-peer selection popup appears first (existing behavior)
  - After selecting one peer from that popup → same as 4A

### 4D: Peer Detail Panel Content
New panel view type: `type: 'peer-detail'`
- Full-width use of the 320px right panel
- Organized sections:
  - **Identity**: Peer ID, address, network, direction, connection type
  - **Performance**: Ping, connection duration, bytes sent/recv
  - **Software**: Version, service flags (expanded descriptions)
  - **Location**: Country, region, city, ISP, AS number + org
  - **Status**: In addrman, block height, special flags
- Back button returns to previous panel state (via panelHistory)

---

## Phase 5: Update-Proof State Management

### 5A: State Preservation Layer
Add a "UI state snapshot" that the `update()` function respects:

```javascript
let uiState = {
    mode: 'default',           // 'default' | 'focused'
    donutAnimation: 'idle',    // 'idle' | 'animating' | 'expanded' | 'reverting'
    expandedSegment: null,     // AS number of expanded segment
    selectedPeer: null,        // Peer ID if a specific peer is selected
    peerSelectSource: null,    // 'peerlist' | 'panel' | 'map'
    centerDisplay: 'score',    // 'score' | 'provider' | 'peer' | 'others-list'
    centerContent: null,       // Cached center HTML/data
    activeTooltipPeerId: null, // Peer ID of visible map tooltip
    zoomedToPeer: false,       // Whether we're zoomed to a specific peer
};
```

### 5B: Update Function Changes
In `update()` (called every 10s):
- Refresh underlying data (asGroups, donutSegments, etc.)
- Refresh segment data BUT preserve animation angles if `donutAnimation !== 'idle'`
- Do NOT call `renderCenter()` if `centerDisplay !== 'score'` (preserve provider/peer display)
- Do NOT rebuild panel DOM if sub-tooltips are pinned (already partially done)
- Do NOT clear lines or change line targets
- Do NOT change donut expansion state
- Do NOT close tooltips
- Do NOT reset zoom position
- Refresh peer counts/percentages in background (data stays fresh, visuals stay stable)

### 5C: Specific Bug Fixes
- Line revert bug: Lines should NOT snap back to all-provider lines when only a single peer was selected
- Donut text revert: Center text should NOT flash back to score during update if showing provider/peer
- Sub-panel collapse: Sub-menus should NOT rebuild or lose scroll position
- Hover state: If mouse is over a peer row, that highlight should persist through updates

---

## Phase 6: Polish & Edge Cases

### 6A: Close Buttons
- **Panel close button** (X): Already exists, ensure it fully exits focused mode
- **Donut close button**: Small arrow/X near donut in focused mode, returns to default mode
- Both trigger smooth reverse animations back to default positions

### 6B: Auto Zoom-Out
- When deselecting a peer or going back in panel: smoothly zoom out to previous zoom level
- Store pre-zoom state (zoom level + pan position) before zooming to peer
- Animated zoom-out with same lerp system

### 6C: Blank Space Click Behavior (Gradual)
- **Map blank click while peer selected through panel submenu**:
  - First click: Close peer tooltip, back to panel top-level
  - Second click: Close panel, exit focused mode, full default
- **Map blank click while peer selected from peer list**:
  - Single click: Close everything, back to default (since no panel navigation to preserve)

### 6D: Stuck Donut Animation Fix
- Track animation state machine strictly
- Any state transition that should revert (deselect, back button, close) MUST trigger revert animation
- Never leave segments in compressed state without an expanded segment
- Add safety timeout: if animation doesn't complete in 600ms, force to target state

### 6E: Hover Tooltips
- All truncated text must have hover tooltips showing full content
- Provider names in donut center: if text is multi-lined, full name in tooltip
- Panel header org names: already truncated, ensure tooltip works

### 6F: Previous Peer Popup Cleanup
- When navigating to a different item in panel: close any open map peer tooltip
- Track `activeTooltipPeerId` in uiState
- On any panel navigation change: if activeTooltipPeerId set, close that tooltip

---

## Files Modified

1. **`web/MBCoreServer.py`** - Cache bust variable in template context
2. **`web/templates/bitindex.html`** - Cache bust params, title rename, close button elements
3. **`web/static/js/as-diversity.js`** - Major changes: focused mode, animations, state machine, peer detail panel, Others list
4. **`web/static/js/bitapp.js`** - Peer selection hooks, zoom-out, map click behavior, line drawing origin changes
5. **`web/static/css/as-diversity.css`** - Focused mode positioning, donut animations, peer detail panel styles
6. **`web/static/css/bitstyle.css`** - BTC price focused position, map controls focused position, body.donut-focused rules

---

## Implementation Order
Execute phases 1→6 sequentially. Each phase builds on the previous. Test after each phase before proceeding.
