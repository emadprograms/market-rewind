import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GroupColor, Timeframe } from '../types';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

const TF_MINUTES: Record<string, number> = { '1min': 1, '5min': 5, '15min': 15, '30min': 30, '1H': 60, '1D': 1440 };

export function useWorkspace() {
  const [layoutMode, setLayoutMode] = useState('2v');
  const [maximizedId, setMaximizedId] = useState<number | null>(null);
  const [activeGutter, setActiveGutter] = useState<number | null>(null);
  const [chartTimeframes, setChartTimeframes] = useState<Record<number, Timeframe>>({}); 
  const [manualStepMinutes, setManualStepMinutes] = useState<number | null>(null);
  
  const [panelSizes, setPanelSizes] = useState<Record<string, number[]>>({
    '2v': [50, 50],
    '2h': [50, 50],
    '3': [33.3, 33.3, 33.4],
    '4': [50, 50, 50, 50]
  });

  // Use Workspace Store for these
  const chartGroups = useWorkspaceStore((state) => state.groups);
  const groupTickers = useWorkspaceStore((state) => state.groupTickers);
  const setGroup = useWorkspaceStore((state) => state.setGroup);
  const setGroupTicker = useWorkspaceStore((state) => state.setGroupTicker);
  const setTicker = useWorkspaceStore((state) => state.setTicker);
  const selectedChartId = useWorkspaceStore((state) => {
    const sid = state.selectedId;
    return sid ? parseInt(sid, 10) : 0;
  });
  const setSelectedChartId = (id: number) => useWorkspaceStore.getState().setSelectedId(id.toString());

  const dragInfo = useRef<{ active: boolean; mode: 'v' | 'h' | null; index: number | null }>({ active: false, mode: null, index: null });
  const workspaceRef = useRef<HTMLElement | null>(null);

  const minStepMinutes = useMemo(() => {
    const tfs = Object.values(chartTimeframes);
    return tfs.length > 0
      ? tfs.reduce((min, tf) => Math.min(min, TF_MINUTES[tf] || 1), 1440)
      : 1;
  }, [chartTimeframes]);

  const activeStepMinutes = manualStepMinutes || minStepMinutes;

  const handlePointerDown = useCallback((mode: 'v' | 'h', index: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragInfo.current = { active: true, mode, index };
    setActiveGutter(index);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragInfo.current.active || !workspaceRef.current) return;
    
    const rect = workspaceRef.current.getBoundingClientRect();
    const { mode, index } = dragInfo.current;
    if (index === null) return;
    
    let percent;
    if (mode === 'v') {
      percent = ((e.clientX - rect.left) / rect.width) * 100;
    } else {
      percent = ((e.clientY - rect.top) / rect.height) * 100;
    }
    
    setPanelSizes(prev => {
      const currentSizes = [...(prev[layoutMode] || [])];
      if (currentSizes.length < index + 2) return prev;
      
      const combinedPercent = currentSizes[index] + currentSizes[index + 1];
      
      let relativeStart = 0;
      for (let i = 0; i < index; i++) relativeStart += currentSizes[i];
      
      let newSizeA = percent - relativeStart;
      let newSizeB = combinedPercent - newSizeA;
      
      if (newSizeA < 10) { newSizeA = 10; newSizeB = combinedPercent - 10; }
      if (newSizeB < 10) { newSizeB = 10; newSizeA = combinedPercent - 10; }
      
      currentSizes[index] = newSizeA;
      currentSizes[index + 1] = newSizeB;
      
      return { ...prev, [layoutMode]: currentSizes };
    });
  }, [layoutMode]);

  const handlePointerEnd = useCallback(() => {
    dragInfo.current.active = false;
    setActiveGutter(null);
  }, []);

  const handleTickerChange = useCallback((chartId: number, newTicker: string) => {
    setTicker(chartId.toString(), newTicker);
  }, [setTicker]);

  const handleGroupChange = useCallback((chartId: number, newGroup: GroupColor) => {
    setGroup(chartId.toString(), newGroup);
  }, [setGroup]);

  const handleTimeframeChange = useCallback((chartId: number, tf: Timeframe) => {
    setChartTimeframes(prev => ({
      ...prev,
      [chartId]: tf
    }));
  }, []);

  const toggleMaximize = useCallback((id: number) => {
    setMaximizedId(prev => prev === id ? null : id);
    setSelectedChartId(id);
  }, [setSelectedChartId]);

  const handleSelectChart = useCallback((id: number) => {
    setSelectedChartId(id);
  }, [setSelectedChartId]);

  return {
    layoutMode,
    setLayoutMode,
    maximizedId,
    toggleMaximize,
    panelSizes,
    activeGutter,
    groupTickers,
    chartGroups,
    selectedChartId,
    workspaceRef,
    minStepMinutes,
    activeStepMinutes,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleTickerChange,
    handleGroupChange,
    handleTimeframeChange,
    handleSelectChart,
    setManualStepMinutes
  };
}
