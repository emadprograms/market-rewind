# Technical Specification: Chart Header Layout Refactor (Optimized)

## 1. Objective
Refactor the `ChartHeader.tsx` component to maximize horizontal space and minimize cognitive load. The goal is to transition from a flat, crowded layout to a streamlined, hierarchical structure that prioritizes primary controls and hides low-frequency settings in a unified "Settings" menu.

## 2. Current State Analysis
### 2.1 Element Inventory
| Element | Category | Type | Key Props/Handlers |
| :--- | :--- | :--- | :--- |
| Ticker Select | Core | Custom Dropdown | `ticker`, `setTicker`, `onTickerChange` |
| Timeframe Select | Core | Custom Dropdown | `timeframe`, `setTimeframe` |
| Group Picker | Utility | Dot Cluster | `groupColor`, `onGroupChange` |
| ETH Toggle | Analysis | Switch | `showEth`, `setShowEth` |
| VP Toggle | Analysis | Switch | `showVP`, `setShowVP` |
| Ray Tool | Drawing | Switch | `isDrawingMode`, `setIsDrawingMode`, `setDrawType('ray')` |
| Rect Tool | Drawing | Switch | `isDrawingMode`, `setIsDrawingMode`, `setDrawType('rect')` |
| Clear Tool | Drawing | Button/Switch | `onUpdateDrawings` |
| Max/Min Button | Window | Icon Button | `isMaximized`, `onToggleMaximize` |

### 2.2 Bottlenecks
- **Horizontal Crowding:** In `Grid-4` layout, the header exceeds available width, causing wrapping or overlap.
- **Cognitive Load:** Analysis and Drawing tools are mixed, creating a "busy" interface.
- **Discovery Gap:** Powerful keyboard shortcuts (`Alt+J`, etc.) are hidden in a separate help modal rather than integrated into the UI.

## 3. Proposed Architecture

### 3.1 Logical Grouping
The header will be divided into three distinct zones:

**Zone A: Primary Controls (Always Visible)**
- Ticker Select
- Timeframe Select
- Group Picker (Essential for visual sync identification)

**Zone B: Unified Settings Menu (Dropdown)**
A single, icon-triggered menu containing three categorized sections:
1.  **Analysis**: ETH Toggle, Volume Profile (VP) Toggle.
2.  **Tools**: Horizontal Ray, Rectangle (with shortcut hints).
3.  **Danger Zone**: Clear All Drawings (visually distinct).

**Zone C: Window Actions (Right Aligned)**
- Maximize/Minimize Button

### 3.2 Visual Blueprint
`[ Ticker ▾ ] [ Timeframe ▾ ] [ Group Dots ] [ ⚙️ ▾ ] ... [ Max/Min ]`

## 4. Implementation Detail

### 4.1 JSX Restructuring (`ChartHeader.tsx`)
1.  **State & Refs:**
    - Replace multiple open states with a single `isSettingsOpen` (boolean).
    - Use `settingsRef` (`useRef<HTMLDivElement>(null)`) for the dropdown container.
2.  **Click-Outside Logic:**
    - Update the `useEffect` mousedown listener to close the `settingsRef` dropdown when clicking elsewhere.
3.  **Dropdown Content Structure:**
    - Create a single `.custom-dropdown-container` triggered by a `Settings` (gear) icon.
    - **Section 1 (Analysis):** Group ETH and VP switches.
    - **Section 2 (Tools):** Group Ray and Rect switches. Add text labels for shortcuts (e.g., "Alt+J").
    - **Section 3 (Danger Zone):** Add the "Clear All" action with a `Trash2` icon and red text.
4.  **Active State Logic:**
    - The `Settings` trigger button should receive the `.active` class if `isDrawingMode` is true or if any analysis toggle is on.
    - *Advanced:* Change the trigger border color to match the active tool (e.g., Orange for Ray/Rect).

### 4.2 CSS Specification (`index.css`)
- **Dropdown Layout:**
  - `position: absolute`, `top: calc(100% + 8px)`, `left: 0`, `z-index: 1000`.
  - Use `.dropdown-section-label` for "Analysis", "Tools", and "Danger Zone" headers (small, muted caps).
  - Implement horizontal separators (`border-bottom: 1px solid var(--border-color)`) between sections.
- **Item Styling:**
  - `.dropdown-item` should use `display: flex; justify-content: space-between; align-items: center`.
  - Shortcut hints should be styled with a muted color and small font.
  - The "Clear" item should have `color: var(--danger-red)`.
- **Grid-4 Optimization:**
  - Set `flex-shrink: 0` on Primary Controls.
  - Use `gap: 8px` in `.chart-controls` for maximum density.

### 4.3 Functional Requirements & Constraints
- **Persistence:** All toggles must maintain their state visually within the dropdown.
- **Synchronicity:** Keep `setDrawType` and `setIsDrawingMode` calls identical to ensure `useKeyboardShortcuts.ts` continues to function.
- **Destructive Action:** Preserve the `window.confirm` dialog for the Clear button.

## 5. Verification & Regression Suite

### 5.1 Functional Checklist
- [ ] **Primary Controls:** Ticker/Timeframe/Group Picker still update state correctly.
- [ ] **Settings Menu:** Single dropdown opens/closes and closes on click-outside.
- [ ] **Analysis:** ETH/VP toggles correctly update chart view.
- [ ] **Tools:** Ray/Rect mode updates cursor and drawing state.
- [ ] **Clear Action:** Confirmation dialog appears and drawings are wiped.
- [ ] **Window Control:** Maximize/Minimize still functions.

### 5.2 Interaction Checklist
- [ ] **Keyboard Sync:** `Alt+J` and `Alt+Shift+R` trigger tools and update the `Settings` trigger button's active state.
- [ ] **Z-Index:** Dropdown floats correctly over the `ChartCanvas` without clipping.
- [ ] **Visual Cues:** Clear action is red; shortcut hints are visible and accurate.

### 5.3 Layout Checklist
- [ ] **Single Chart:** Header looks clean and balanced.
- [ ] **Grid-4:** Header does not wrap; all primary controls are fully visible.
- [ ] **Maximize Mode:** Header remains functional and aligned.
