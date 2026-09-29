import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
import {TimeAndSales} from '../../../src/components/TimeAndSales';
import {PlaybackBar} from '../../../src/components/PlaybackBar';
import {usePlaybackStore} from '../../../src/store/usePlaybackStore';

beforeEach(()=>{usePlaybackStore.getState().reset();usePlaybackStore.setState({masterData:[]});});
it('review: opening tape after closed render must not throw',()=>{
 const hook=render(React.createElement(TimeAndSales,{isOpen:false,onClose:()=>{},symbol:'TSLA'}));
 expect(()=>hook.rerender(React.createElement(TimeAndSales,{isOpen:true,onClose:()=>{},symbol:'TSLA'}))).not.toThrow();
});
it('review: slider minimum remains09:20 after seeking09:34',()=>{
 const ms=(s:string)=>Date.parse('2026-09-15T'+s+'Z');
 usePlaybackStore.getState().setBufferedTicks([{time:'2026-09-15 13:30:00.085',price:100,volume:1,symbol:'TSLA'}, {time:'2026-09-15 19:59:59.440',price:101,volume:1,symbol:'TSLA'}] as any);
 usePlaybackStore.getState().seekTickTime(ms('13:20:00'));
 const {getByTestId}=render(React.createElement(PlaybackBar,{totalRealized:0,totalUnrealized:0,isDbLoaded:true,sessionTicker:'TSLA',onResetToOpen:()=>{},minStepMinutes:1}));
 const slider=getByTestId('playback-time-slider');
 const before=slider.getAttribute('min');
 fireEvent.change(slider,{target:{value:ms('13:34:00')}});
 console.log('REVIEW scrubber minimum before/after:',before,slider.getAttribute('min'));
 expect(slider.getAttribute('min')).toBe(before);
});
