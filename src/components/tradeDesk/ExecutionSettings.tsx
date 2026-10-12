import React, { useState } from 'react';
import { pilotReferenceProfile, trainingProfile } from '../../lib/orderSimulator/profiles';
import { PILOT_EVIDENCE_CARDS, settingDescriptors } from '../../lib/orderSimulator/uiViewModels';
import type { LatencyProfile } from '../../lib/orderSimulator/types';

/**
 * SIM-UI-05 — execution settings and provenance.
 *
 * The distinction this panel exists to make visible: an observed value and a chosen value are not the
 * same kind of number. Observed evidence is displayed, labelled with its provenance and its sample
 * count, and is NOT editable — the user must not be able to relabel a measurement as a preference or
 * a preference as a measurement. Everything else is editable and labelled as an assumption.
 *
 * The evidence cards are structurally separated from the settings grid, so a screenshot of one cannot
 * be mistaken for the other.
 */

export interface ExecutionSettingsProps {
  profile: LatencyProfile;
  onChangeProfile: (profile: LatencyProfile) => void;
}

export function ExecutionSettings({ profile, onChangeProfile }: ExecutionSettingsProps) {
  const [draft, setDraft] = useState<LatencyProfile>(profile);
  const descriptors = settingDescriptors(draft);

  const edit = (key: string, valueMs: number) => {
    const next = { ...draft, [key]: { ...(draft as never as Record<string, { value: number }>)[key], value: valueMs } } as LatencyProfile;
    setDraft(next);
    onChangeProfile(next);
  };

  const useProfile = (which: 'training' | 'pilot') => {
    const next = which === 'training' ? trainingProfile() : pilotReferenceProfile('MARKET');
    setDraft(next);
    onChangeProfile(next);
  };

  return (
    <section aria-labelledby="settings-heading" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h2 id="settings-heading" style={{ fontSize: '13px', margin: 0, color: '#e2e8f0' }}>
        Execution settings
      </h2>

      <div role="group" aria-label="Latency profile" style={{ display: 'flex', gap: '6px' }}>
        <button
          type="button"
          onClick={() => useProfile('training')}
          aria-pressed={draft.id === 'training'}
          style={{ flex: 1, fontSize: '11px', background: draft.id === 'training' ? '#1e293b' : 'transparent', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '4px', padding: '5px 0', cursor: 'pointer' }}
        >
          Training values
        </button>
        <button
          type="button"
          onClick={() => useProfile('pilot')}
          aria-pressed={draft.id !== 'training'}
          style={{ flex: 1, fontSize: '11px', background: draft.id !== 'training' ? '#1e293b' : 'transparent', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '4px', padding: '5px 0', cursor: 'pointer' }}
        >
          Pilot reference envelope
        </button>
      </div>

      <p data-testid="settings-profile" style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>
        Active profile: <strong>{draft.label}</strong> ({draft.id})
      </p>

      <ul data-testid="settings-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {descriptors.map((setting) => (
          <li key={setting.key} style={{ border: '1px solid #334155', borderRadius: '4px', padding: '6px 8px', background: '#0f172a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <label htmlFor={`setting-${setting.key}`} style={{ fontSize: '11px', color: '#e2e8f0' }}>
                {setting.label}
              </label>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {setting.editable ? (
                  <input
                    id={`setting-${setting.key}`}
                    type="number"
                    min={0}
                    step={5}
                    value={setting.valueMs}
                    onChange={(e) => edit(setting.key, Number(e.target.value))}
                    style={{ width: '76px', background: '#020617', border: '1px solid #334155', color: '#fff', borderRadius: '4px', padding: '2px 5px', fontSize: '11px' }}
                  />
                ) : (
                  <output
                    id={`setting-${setting.key}`}
                    data-testid={`setting-value-${setting.key}`}
                    style={{ fontSize: '12px', color: '#e2e8f0' }}
                  >
                    {setting.valueMs}
                  </output>
                )}
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>ms</span>
              </span>
            </div>
            <div data-testid={`provenance-${setting.key}`} style={{ fontSize: '10px', color: setting.provenance === 'OBSERVED_SAMPLE' ? '#38bdf8' : '#64748b' }}>
              {setting.provenance}
              {setting.provenance === 'OBSERVED_SAMPLE' ? ' — evidence, not editable' : ''}
              {setting.sampleCount !== null ? ` — ${setting.sampleCount} sample` : ''}
            </div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>{setting.note}</div>
          </li>
        ))}
      </ul>

      <section aria-labelledby="evidence-heading" style={{ borderTop: '1px dashed #334155', paddingTop: '8px' }}>
        <h3 id="evidence-heading" style={{ fontSize: '12px', margin: 0, color: '#e2e8f0' }}>
          Evidence from the demo pilot
        </h3>
        <p style={{ margin: '3px 0 6px', fontSize: '10px', color: '#94a3b8' }}>
          What was actually measured, kept separate from anything this simulator produces. These are
          single samples and are not a distribution.
        </p>
        <ul data-testid="evidence-cards" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {PILOT_EVIDENCE_CARDS.map((card) => (
            <li key={card.id} data-testid={`evidence-${card.id}`} style={{ border: '1px solid #334155', borderRadius: '4px', padding: '5px 8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#e2e8f0' }}>{card.title}</span>
                <strong style={{ fontSize: '11px', color: '#38bdf8' }}>{card.valueText}</strong>
              </div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>
                {card.provenance} — {card.detail}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
