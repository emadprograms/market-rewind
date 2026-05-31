# Technical Specification: Chart Header Layout Refactor

## 1. Objective
Refactor the `ChartHeader.tsx` component to optimize horizontal space and reduce visual clutter. The goal is to transition from a flat layout to a grouped, hierarchical structure without removing any existing functionality.

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
- **Horizontal Crowding:** In `Grid-4` layout, the header exceeds the available width, leading to potential wrapping or overlap.
- **Cognitive Load:** Analysis toggles (ETH/VP) are mixed with Drawing tools (Ray/Rect), making the interface feel "busy".
- **Repetitive UI Patterns:** Multiple `.switch-container` elements are used for fundamentally different actions (toggling a view vs. entering a tool mode vs. triggering a destructive action).

## 3. Proposed Architecture

### 3.1 Logical Grouping
The header will be divided into three distinct zones:

**Zone A: Primary Controls (Always Visible)**
- Ticker Select
- Timeframe Select
- Group Picker (Essential for visual sync identification)

**Zone B: Analysis Menu (Dropdown)**
- ETH Toggle
- Volume Profile (VP) Toggle

**Zone C: Tools Menu (Dropdown)**
- Horizontal Ray Tool
- Rectangle Tool
- Clear All Drawings (Destructive Action)

**Zone D: Window Actions (Right Aligned)**
- Maximize/Minimize Button

### 3.2 Visual Blueprint
`[ Ticker ▾ ] [ Timeframe ▾ ] [ Group Dots ] [ Analysis ▾ ] [ Tools ▾ ] ... [ Max/Min ]`

## 4. Implementation Detail

### 4.1 JSX Restructuring (`ChartHeader.tsx`)
1.  **State Expansion:**
    - Add `isAnalysisOpen` (boolean) and `isToolsOpen` (boolean) states.
    - Add `analysisRef` and `toolsRef` using `useRef<HTMLDivElement>(null)`.
2.  **Click-Outside Logic:**
    - Update the existing `useEffect` hook to include `analysisRef` and `toolsRef` in the `mousedown` listener to ensure dropdowns close when clicking elsewhere.
3.  **Structural Changes:**
    - Wrap ETH and VP toggles inside a new `.custom-dropdown-container` (Analysis).
    - Wrap Ray, Rect, and Clear inside a new `.custom-dropdown-container` (Tools).
    - Replace the trigger for these groups with a `.custom-select` style button (e.g., "Analysis" and "Tools" with `ChevronDown` icons).

### 4.2 CSS Specification (`index.css`)
To ensure the dropdowns are usable and aesthetically consistent:
- **Dropdown Positioning:** Use `position: absolute` with `top: calc(100% + 8px)` and `left: 0`.
- **Z-Index Management:** Ensure `.dropdown-menu` has `z-index: 1000` to float above the `ChartCanvas`.
- **Menu Styling:** 
    - Use the existing `.dropdown-menu` and `.dropdown-item` classes.
    - For toggles inside dropdowns, the `.switch-container` should be modified to occupy the full width of the `.dropdown-item` for a better hit-box.
- **Grid-4 Optimization:** 
    - In narrow views, ensure the `.chart-controls` container uses `gap: 8px` instead of `12px`.
    - Implement `flex-shrink: 0` on primary controls to prevent them from squishing.

### 4.3 Functional Requirements & Constraints
- **Persistence:** Toggles must maintain their `active` state visual in the trigger button if any item inside the dropdown is active.
    - *Example:* If `isDrawingMode` is true, the "Tools" trigger button should have the `.active` class (border-color: var(--accent-green)).
- **Synchronicity:** Ensure the `setDrawType` and `setIsDrawingMode` calls remain identical to prevent breaking `useKeyboardShortcuts.ts`.
- **Destructive Action:** The `window.confirm` for the Clear button must be preserved.

## 5. Verification & Regression Suite

### 5.1 Functional Checklist
- [ ] **Ticker/Timeframe:** Verify dropdowns still open/close and update state correctly.
- [ ] **Analysis Group:** Verify ETH/VP toggles still update the chart view.
- [ ] **Tools Group:** Verify entering Ray/Rect mode updates the cursor and drawing state.
- [ ] **Clear Action:** Verify confirmation dialog appears and drawings are wiped.
- [ ] **Window Control:** Verify Maximize/Minimize still functions.
- [ ] **Group Picker:** Verify color dots still assign sync groups.

### 5.2 Interaction Checklist
- [ ] **Click-Outside:** Verify all 4 dropdowns close when clicking the chart.
- [ ] **Keyboard Sync:** Verify `Alt+J` and `Alt+Shift+R` still trigger the correct tools and that the UI reflects this state (e.g., the "Tools" dropdown trigger becomes active).
- [ ] **Z-Index:** Verify dropdowns are not clipped by the `ChartCanvas` or `ChartUnit` borders.

### 5.3 Layout Checklist
- [ ] **Single Chart:** Header looks balanced.
- [ ] **Grid-4:** Header does not wrap; all elements are accessible.
- [ ] **Maximize Mode:** Header remains functional and correctly aligned.
