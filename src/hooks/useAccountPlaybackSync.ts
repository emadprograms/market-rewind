import { useEffect } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { useAccountStore } from '../store/useAccountStore';
import type { PlaybackSnapshot } from '../lib/orderSimulator/playbackBridge';

/**
 * Keep the simulated account in step with the chart playhead.
 *
 * This is the wire that was missing. The account store and the playback store are independent, and
 * although every piece of the engine was built and tested, nothing in the application ever moved the
 * account's clock: the chart advanced, the tape streamed, and the account sat still. The visible
 * consequences were the ones a browser found rather than the unit suite — orders stayed unfilled, no
 * position ever opened, the trade badge never appeared, and the ticket showed no quote to price
 * against.
 *
 * It subscribes with `subscribe` rather than through React state on purpose. At 25x playback the
 * playhead moves every frame; pushing that through a selector would re-render the tree sixty times a
 * second for no reason. The store decides what is worth announcing (`syncFromPlayback`), and React is
 * told only when the account actually changed.
 *
 * Mount once, above both the charts and the trade desk.
 */
export function useAccountPlaybackSync(): void {
  useEffect(() => {
    let prev: PlaybackSnapshot | null = null;

    const snapshotOf = (state: ReturnType<typeof usePlaybackStore.getState>): PlaybackSnapshot => ({
      currentTime: state.currentTime,
      currentTickIndex: state.currentTickIndex,
      currentTick: state.currentTick,
      bufferedTicks: state.bufferedTicks,
      seekEpoch: state.seekEpoch,
      isPaused: state.isPaused,
    });

    const sync = (state: ReturnType<typeof usePlaybackStore.getState>) => {
      const next = snapshotOf(state);
      // Read the store fresh every time: `configure` replaces the session, so a captured reference
      // would advance an engine nobody is looking at.
      useAccountStore.getState().syncFromPlayback(prev, next);
      prev = next;
    };

    // Take up the current position rather than waiting for the next movement.
    sync(usePlaybackStore.getState());

    return usePlaybackStore.subscribe(sync);
  }, []);
}
