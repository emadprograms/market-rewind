# Implementation Plan: Group Sync Ticker Leak & Stability (Final)

## 1. Problem Statement
The Grouped Symbol Linking System currently suffers from several critical behavioral and logical flaws:
1. **Ticker Snap on Join (The "Inverted" Problem):** While we recently stopped charts from snapping to group tickers on join, we lost the intuitive behavior where a chart *should* adopt an existing group's ticker if that group is already occupied.
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

### 3.1 Deterministic "Smart-Sync" in `useChartData.ts`
We will implement a system that restores the intuitive auto-sync behavior when joining an existing group, while maintaining protection against race conditions.

**The Logic:**
- Use `prevGroupColorRef` to detect when a user joins/leaves a group.
- Use `prevGroupTickerRef` to anchor the group's ticker.
- **The Smart-Join Rule:** When joining a group, if the group already has a ticker and it's different from the chart's current ticker, we perform an immediate sync. This ensures the group stays unified.
- **The Sync Rule:** A chart only updates its ticker if `groupColor` is stable, is not 'none', and the `groupTicker` has changed *relative to the anchor*.
- **Dependency Array:** Omit `ticker` from dependencies to prevent the "Revert Race Condition."

### 3.2 Unified Update Pattern in `ChartUnit.tsx`
Centralize all ticker changes to ensure 100% sync parity between dropdowns and keyboard.

- **Unified Handler:** `handleTickerUpdate(newTicker: string)` will call both `data.setTicker(newTicker)` and `onTickerChange(newTicker)`.
- This handler will be the sole entry point for ticker changes in `ChartUnit`.

### 3.3 Dynamic Group Cleanup in `useWorkspace.ts`
Ensure groups are ephemeral and reset when empty.

- **The Rule:** Whenever `handleGroupChange` is called, check if the group just left (`oldGroup`) still has any members.
- If the count is 0 $ightarrow$ remove that group's ticker from `groupTickers`.

## 4. Implementation Steps

### Step 1: Modify `src/hooks/useChartData.ts`
Implement the smart-join sync logic.
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
      
      // Smart Join: If joining an existing group with a different ticker, adopt it immediately.
      if (groupColor !== 'none' && groupTicker && groupTicker !== ticker) {
        setTicker(groupTicker);
        prevGroupTickerRef.current = groupTicker; // Anchor to the new group ticker
      } else {
        prevGroupTickerRef.current = groupTicker; // Anchor at moment of joining
      }
      return; 
    }

    // 2. Sync only if the group ticker has changed since we joined or last synced
    if (groupColor !== 'none' && groupTicker && groupTicker !== prevGroupTickerRef.current) {
      setTicker(groupTicker);
      prevGroupTickerRef.current = groupTicker; // Update anchor
    }
  }, [groupColor, groupTicker]); // Omit 'ticker' to avoid revert race conditions
```

### Step 2: Modify `src/components/ChartUnit.tsx`
(Already implemented in v7.8 - ensuring it remains correct)

### Step 3: Modify `src/hooks/useWorkspace.ts`
(Already implemented in v7.8 - ensuring it remains correct)

## 5. Verification Plan

### 5.1 Test: Joining an OCCUPIED Group (Smart Join)
- **Setup:** Chart A (Green, AMD). Chart B (None, SPY).
- **Action:** Change Chart B to Green.
- **Expected:** Chart B automatically changes to AMD.

### 5.2 Test: Joining an EMPTY Group (Anchor Join)
- **Setup:** Red Group is empty (blank slate). Chart A is SPY.
- **Action:** Change Chart A to Red.
- **Expected:** Chart A stays SPY (It becomes the leader of the Red group).

### 5.3 Test: Remote Sync
- **Setup:** Chart A (Green, AMD), Chart B (Green, AMD).
- **Action:** Change Chart A to TSLA.
- **Expected:** Chart B automatically changes to TSLA.

### 5.4 Test: Group Cleanup
- **Setup:** Blue Group is MSFT. Chart A is Blue.
- **Action:** Change Chart A to 'none'.
- **Action:** Change Chart A back to Blue.
- **Expected:** Chart A stays SPY (or whatever its current ticker is) because Blue group was wiped when it became empty.
