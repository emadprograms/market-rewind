# Technical Specification: Chart Header Layout Refactor (v2 - Polished)

## 1. Objective
Refactor the `ChartHeader.tsx` component to maximize horizontal space and eliminate visual noise. The goal is to transition from a cluttered, "button-heavy" layout to a streamlined, professional trading terminal interface that utilizes hierarchical menus and universal iconography.

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
- **Visual Noise:** The 5-dot group picker is aesthetically jarring and looks amateur.
- **Unnecessary Text:** The "Settings" label is redundant given the universal nature of the cogwheel icon.
- **Horizontal Crowding:** In `Grid-4` layout, every pixel of the header is critical.

## 3. Proposed Architecture

### 3.1 Logical Grouping
The header will be divided into three distinct zones:

**Zone A: Primary Controls (Always Visible)**
- Ticker Select
- Timeframe Select
- **Group Selector (Dropdown)**: Replaces the dot cluster with a compact, labeled dropdown.

**Zone B: Unified Settings Menu (Icon-Only Dropdown)**
A single, gear-icon triggered menu containing three categorized sections:
1.  **Analysis**: ETH Toggle, Volume Profile (VP) Toggle.
2.  **Tools**: Horizontal Ray, Rectangle (with shortcut hints).
3.  **Danger Zone**: Clear All Drawings (visually distinct).

**Zone C: Window Actions (Right Aligned)**
- Maximize/Minimize Button

### 3.2 Visual Blueprint
`[ Ticker ▾ ] [ Timeframe ▾ ] [ Group ▾ ] [ ⚙️ ▾ ] ... [ Max/Min ]`

## 4. Implementation Detail

### 4.1 JSX Restructuring (`ChartHeader.tsx`)
1.  **State & Refs Expansion:**
    - Add `isGroupOpen` (boolean) and `groupRef` (`useRef<HTMLDivElement>(null)`).
    - Maintain `isSettingsOpen` and `settingsRef`.
2.  **Click-Outside Logic:**
    - Update the `useEffect` mousedown listener to close `tickerRef`, `tfRef`, `groupRef`, and `settingsRef`.
3.  **Group Selector Implementation:**
    - Replace `.group-picker` dots with a `.custom-dropdown-container`.
    - **Trigger:** A `.custom-select` button showing "Group" + `ChevronDown`. The border-color should dynamically match the active `groupColor`.
    - **Menu:** A `.dropdown-menu` featuring a vertical palette. Each item consists of a small colored circle (badge) followed by the color name (e.g., "🔴 Red").
4.  **Settings Trigger Cleanup:**
    - Remove the `<span>Settings</span>` text.
    - Keep the `Settings` icon and `ChevronDown`.

### 4.2 CSS Specification (`index.css`)
- **Group Dropdown Styling:**
  - **Active Glow:** The group trigger button should have a subtle `box-shadow` or `border-color` that matches the active group's color.
  - **Palette Items:** `.dropdown-item` for groups should use `display: flex; align-items: center; gap: 10px`.
  - **Group Badge:** A small `width: 10px; height: 10px; border-radius: 50%` circle preceding the label.
- **Icon-Only Trigger:**
  - Adjust `.custom-select` padding and width for the Settings trigger to ensure it looks like a balanced square/circle rather than a stretched rectangle.
- **Grid-4 Optimization:**
  - Enforce `flex-shrink: 0` on all Primary Controls.
  - Set `.chart-controls` gap to `8px`.

### 4.3 Functional Requirements & Constraints
- **Persistence:** All toggles and group assignments must maintain their state visually.
- **Synchronicity:** Keep `setDrawType` and `setIsDrawingMode` calls identical to ensure `useKeyboardShortcuts.ts` continues to function.
- **Destructive Action:** Preserve the `window.confirm` dialog for the Clear button.

## 5. Verification & Regression Suite

### 5.1 Functional Checklist
- [ ] **Primary Controls:** Ticker/Timeframe/Group update state correctly.
- [ ] **Group Dropdown:** Correct color is selected and reflected in the trigger border.
- [ ] **Settings Menu:** Icon-only trigger opens/closes and closes on click-outside.
- [ ] **Analysis/Tools:** All toggles and tool modes function as expected.
- [ ] **Clear Action:** Confirmation dialog appears and drawings are wiped.

### 5.2 Interaction Checklist
- [ ] **Keyboard Sync:** `Alt+J` and `Alt+Shift+R` trigger tools and update the `Settings` trigger's active state.
- [ ] **Visual Cues:** "Danger Zone" is red; shortcut hints are visible.
- [ ] **Symmetry:** The header feels balanced with the removal of "Settings" text.

### 5.3 Layout Checklist
- [ ] **Grid-4:** Header is compact and does not wrap; all triggers are accessible.
- [ ] **Single Chart:** Header looks lean and professional.
