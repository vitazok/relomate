import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormsSection } from '@/components/workspace/FormsSection';
import { buildFormsWorkspaceViewModel } from '@/lib/forms/view-model';
import { loadPersona, toCaseFacts, toProfile } from '../_personas/harness';

const TODAY = new Date('2026-06-11T00:00:00.000Z');

describe('FormsSection', () => {
  it('renders Bengaluru as CSP-integrated readiness', () => {
    const persona = loadPersona('priya-strong');
    const html = renderToStaticMarkup(
      <FormsSection
        forms={buildFormsWorkspaceViewModel({
          profile: toProfile(persona),
          caseFacts: toCaseFacts(persona),
          today: TODAY,
        })}
      />,
    );

    expect(html).toContain('Consular Services Portal readiness');
    expect(html).toContain('CSP integrated');
    expect(html).toContain('Open form guidance');
    expect(html).not.toContain('Generate preview');
  });

  it('renders Toronto as VIDEX readiness with unverified source marker', () => {
    const persona = loadPersona('toronto-strong-pretravel');
    const html = renderToStaticMarkup(
      <FormsSection
        forms={buildFormsWorkspaceViewModel({
          profile: toProfile(persona),
          caseFacts: toCaseFacts(persona),
          today: TODAY,
        })}
      />,
    );

    expect(html).toContain('VIDEX readiness');
    expect(html).toContain('VIDEX online');
    expect(html).toContain('Generate preview');
    expect(html).toContain('not user-verified yet');
  });
});
