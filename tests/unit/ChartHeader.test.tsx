import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChartHeader } from '../../src/components/ChartHeader';
import { Timeframe, DrawType, GroupColor } from '../../src/types';
import React from 'react';

describe('ChartHeader', () => {
  const defaultProps = {
    ticker: 'AAPL',
    setTicker: vi.fn(),
    timeframe: '5min' as Timeframe,
    setTimeframe: vi.fn(),
    showEth: false,
    setShowEth: vi.fn(),
    showVP: false,
    setShowVP: vi.fn(),
    isDrawingMode: false,
    setIsDrawingMode: vi.fn(),
    drawType: 'ray' as DrawType,
    setDrawType: vi.fn(),
    tickers: ['AAPL', 'MSFT', 'TSLA'],
    groupColor: 'none' as GroupColor,
    onGroupChange: vi.fn(),
    onTickerChange: vi.fn(),
    onUpdateDrawings: vi.fn(),
    isMaximized: false,
    onToggleMaximize: vi.fn(),
  };

  it('renders primary controls in Zone A', () => {
    render(<ChartHeader {...defaultProps} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
    expect(screen.getByText('Group')).toBeInTheDocument();
  });

  it('opens group dropdown and selects a color', () => {
    render(<ChartHeader {...defaultProps} />);
    const groupBtn = screen.getByText('Group');
    fireEvent.click(groupBtn);

    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Blue')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Red'));
    expect(defaultProps.onGroupChange).toHaveBeenCalledWith('red');
  });

  it('opens settings dropdown when clicking Settings button', () => {
    render(<ChartHeader {...defaultProps} />);
    const settingsBtn = screen.getByTitle('Settings & Tools');
    fireEvent.click(settingsBtn);

    expect(screen.getByText('Analysis')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByText('Clear All Drawings')).toBeInTheDocument();
  });

  it('toggles ETH when clicked in dropdown', () => {
    render(<ChartHeader {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Settings & Tools'));

    const ethToggle = screen.getByText('Extended Hours (ETH)');
    fireEvent.click(ethToggle);

    expect(defaultProps.setShowEth).toHaveBeenCalledWith(true);
  });

  it('activates Horizontal Ray tool when clicked in dropdown', () => {
    render(<ChartHeader {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Settings & Tools'));

    const rayTool = screen.getByText('Horizontal Ray');
    fireEvent.click(rayTool);

    expect(defaultProps.setIsDrawingMode).toHaveBeenCalledWith(true);
    expect(defaultProps.setDrawType).toHaveBeenCalledWith('ray');
  });

  it('triggers clear drawings confirmation', () => {
    window.confirm = vi.fn().mockReturnValue(true);
    render(<ChartHeader {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Settings & Tools'));

    const clearBtn = screen.getByText('Clear All Drawings');
    fireEvent.click(clearBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(defaultProps.onUpdateDrawings).toHaveBeenCalled();
  });
});
