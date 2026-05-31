# Technical Specification: Chart Header Layout Refactor (Final Implementation)

## 1. Objective
Refactor the `ChartHeader.tsx` component to maximize horizontal space and minimize cognitive load. The goal was to transition from a flat, crowded layout to a streamlined, hierarchical structure that prioritizes primary controls and hides low-frequency settings in a unified "Settings" menu.

## 2. Implemented Architecture

### 2.1 Logical Grouping
The header is divided into three distinct zones:

**Zone A: Primary Controls (Always Visible)**
- Ticker Select
- Timeframe Select
- Group Picker (Essential for visual sync identification)

**Zone B: Unified Settings Menu (Dropdown)**
A single, icon-triggered menu containing three categorized sections:
1.  **Analysis**: ETH Toggle, Volume Profile (VP) Toggle.
2.  **Tools**: Horizontal Ray, Rectangle (with keyboard shortcut hints like "Alt+J").
3.  **Danger Zone**: Clear All Drawings (visually distinct with red text).

**Zone C: Window Actions (Right Aligned)**
- Maximize/Minimize Button

### 2.2 Visual Blueprint
`[ Ticker ▾ ] [ Timeframe ▾ ] [ Group Dots ] [ ⚙️ Settings ▾ ] ... [ Max/Min ]`

## 3. Implementation Details

### 3.1 Component Logic (`ChartHeader.tsx`)
- **State Management:** Uses `isSettingsOpen` (boolean) to control the unified menu.
- **Refs:** `settingsRef` used with a `useEffect` click-outside listener to handle dropdown closing.
- **Active State Indicator:** The "Settings" trigger button receives `.active` (green) if analysis toggles are on, or `.active-drawing` (orange) if a drawing tool is currently active.

### 3.2 Styling (`src/index.css`)
- **Density:** Optimized `.chart-controls` with `gap: 8px` and `flex-shrink: 0` for multi-chart stability.
- **Menu Hierarchy:**
    - `.dropdown-section`: Groups related items.
    - `.dropdown-section-label`: Small, muted, uppercase labels for "Analysis" and "Tools".
    - `.dropdown-divider`: Subtle horizontal separators between sections.
    - `.shortcut-hint`: Small, mono-spaced hints for keyboard enthusiasts.
- **Z-Index:** Set to `1100` to ensure visibility over the lightweight-charts canvas.

## 4. Verification & Testing

### 4.1 Automated Tests (`tests/unit/ChartHeader.test.tsx`)
A new test suite was added to verify:
- [x] Primary controls rendering.
- [x] Settings menu open/close behavior.
- [x] Toggle functionality for ETH/VP within the menu.
- [x] Tool selection for Ray/Rect.
- [x] Clear Drawings confirmation trigger.

### 4.2 Manual Checklist
- [x] **Grid-4 Stability:** Header no longer wraps even in narrow columns.
- [x] **Keyboard Sync:** `Alt+J` and `Alt+Shift+R` correctly update the Settings trigger's "active-drawing" state.
- [x] **Click-Outside:** Dropdown closes reliably when clicking the chart or other header elements.

