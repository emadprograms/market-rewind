# Implementation Plan: Group Sync Ticker Leak & Stability (Final)

## 1. Problem Statement
The Grouped Symbol Linking System currently suffers from several critical behavioral and logical flaws:
1. **Ticker Snap on Join:** Changing a chart's group (e.g., 'none' $ightarrow$ 'red') forces the chart to immediately snap to that group's current ticker.
2. **The "One-Render-Later" Snap:** Even with basic guards, the chart often snaps to the group ticker on the second render cycle after joining.
3. **Keyboard Sync Leak:** Ticker changes via keyboard shortcuts (`A-Z`) update the local chart but fail to notify the group, causing desynchronization.
4. **The "Revert Race Condition":** Over-aggressive sync effects can fight with manual user input, causing tickers to flicker or revert.
5. **Persistence of Empty Groups:** Groups retain their ticker "memory" even after all members have left, which is counter-intuitive. An empty group should be a blank slate.

## 2. Root Cause Analysis

### 2.1 Over-Aggressive Sync Effect
In `src/hooks/useChartData.ts`, the `useEffect` triggers on any change to `groupColor`. Because it doesn't anchor the ticker at the moment of joining, it forces a `setTicker` call as soon as the component re-renders with the new group color.

### 2.2 Bypass of Parent Notification
In `src/components/ChartUnit.tsx`, the keyboard action handler calls `data.setTicker(val)` but omits the call to `onTickerChange(val)`. This bypasses the synchronization logic in `useWorkspace.ts`.

### 2.3 Lack of Group Cleanup
In `src/hooks/useWorkspace.ts`, `groupTickers` are updated but never deleted. There is no logic to check if a group has become empty, leaving "ghost tickers" in the state.

## 3. Proposed Solution

### 3.1 Deterministic Sync in `useChartData.ts`
We will implement a "Double-Anchor" system to ensure joining a group is a purely visual action.

**The Logic:**
- Use `prevGroupColorRef` to detect when a user joins/leaves a group.
- Use `prevGroupTickerRef` to anchor the group's ticker at the moment of joining.
- **The Sync Rule:** A chart only updates its ticker if `groupColor` is stable, is not 'none', and the `groupTicker` has changed *relative to the anchor* saved when joining.
- **Dependency Array:** Omit `ticker` from dependencies to prevent the "Revert Race Condition."

### 3.2 Unified Update Pattern in `ChartUnit.tsx`
Centralize all ticker changes to ensure 100% sync parity between dropdowns and keyboard.

- **Unified Handler:** `handleTickerUpdate(newTicker: string)` will call both `data.setTicker(newTicker)` and `onTickerChange(newTicker)`.
- This handler will be the sole entry point for ticker changes in `ChartUnit`.

### 3.3 Dynamic Group Cleanup in `useWorkspace.ts`
Ensure groups are ephemeral and reset when empty.

- **The Rule:** Whenever `handleGroupChange` is called, check if the group just left (`oldGroup`) still has any members.
- If the count is 0 $ightarrow$ remove that group's ticker from `groupTickers`.

## 4. Implementation Steps

### Step 1: Modify `src/hooks/useChartData.ts`
Implement the double-anchor sync logic.
```typescript
  const prevGroupColorRef = useRef(groupColor);
  const prevGroupTickerRef = useRef(groupTicker);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // 1. Handle Group Change (Joining/Leaving)
    if (groupColor !== prevGroupColorRef.current) {
      prevGroupColorRef.current = groupColor;
      prevGroupTickerRef.current = groupTicker; // Anchor the ticker at moment of joining
      return; 
    }

    // 2. Sync only if the group ticker has changed since we joined or last synced
    if (groupColor !== 'none' && groupTicker && groupTicker !== prevGroupTickerRef.current) {
      setTicker(groupTicker);
      prevGroupTickerRef.current = groupTicker; // Update anchor
    }
  }, [groupColor, groupTicker]); // NO 'ticker' dependency to avoid race conditions
```

### Step 2: Modify `src/components/ChartUnit.tsx`
Unify the ticker update paths.
1. **Implement Unified Handler:**
   ```typescript
   const handleTickerUpdate = useCallback((newTicker: string) => {
     data.setTicker(newTicker);
     if (onTickerChange) {
       onTickerChange(newTicker);
     }
   }, [data, onTickerChange]);
   ```
2. **Wire to ChartHeader:** Pass `handleTickerUpdate` to `ChartHeader`'s `onTickerChange` prop.
3. **Wire to Keyboard:** Update the keyboard action `onSubmit` to call `handleTickerUpdate(val.toUpperCase())`.

### Step 3: Modify `src/hooks/useWorkspace.ts`
Implement the "Last Member" cleanup logic.
- Update `handleGroupChange`:
  ```typescript
  const handleGroupChange = useCallback((chartId: number, newGroup: GroupColor) => {
    setChartGroups(prev => {
      const oldGroup = prev[chartId];
      const next = { ...prev, [chartId]: newGroup };
      
      // Check if the old group is now empty
      if (oldGroup && oldGroup !== 'none' && oldGroup !== newGroup) {
        const isNowEmpty = Object.values(next).every(g => g !== oldGroup);
        if (isNowEmpty) {
          setGroupTickers(gt => {
            const { [oldGroup]: _, ...rest } = gt;
            return rest;
          });
        }
      }
      return next;
    });
  }, []);
  ```

## 5. Verification Plan

### 5.1 Test: Joining a Group (The "No Snap" Test)
- **Setup:** Chart A (Green, SPY), Chart B (None, AAPL).
- **Action:** Change Chart B to Green.
- **Expected:** Chart B stays AAPL (No snap on join, no one-render-later snap).

### 5.2 Test: Remote Sync (The "Group" Test)
- **Setup:** Chart A (Green, SPY), Chart B (Green, SPY).
- **Action:** Change Chart A to 'TSLA' via dropdown.
- **Expected:** Chart B automatically changes to 'TSLA'.

### 5.3 Test: Keyboard Sync (The "Leak" Test)
- **Setup:** Chart A (Green, SPY), Chart B (Green, SPY).
- **Action:** Change Chart A to 'TSLA' using keyboard shortcuts.
- **Expected:** Chart B automatically changes to 'TSLA'.

### 5.4 Test: Group Cleanup (The "Blank Slate" Test)
- **Setup:** Red Group is 'AAPL'. Chart A is Red.
- **Action:** Change Chart A to 'none'.
- **Action:** Change Chart A back to Red.
- **Expected:** Chart A does not snap to 'AAPL' (Red group was wiped when it became empty).

### 5.5 Test: Race Condition (The "Revert" Test)
- **Action:** Rapidly change tickers via dropdown.
- **Expected:** No flickering or reverting to previous tickers.
