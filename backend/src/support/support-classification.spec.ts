import { describe, it, expect } from '@jest/globals';
import {
  classifySupport,
  type SupportClassifierConfig,
  type SupportClassifiableIssue,
} from './support-classification.js';
import type { JiraIssueLink } from '../database/entities/index.js';

function link(linkTypeName: string, targetIssueKey: string): JiraIssueLink {
  return { linkTypeName, targetIssueKey } as JiraIssueLink;
}

const emptyConfig: SupportClassifierConfig = {
  supportEpics: [],
  supportLabels: [],
  supportLinkTypes: [],
  triageBoardKey: null,
};

describe('classifySupport', () => {
  it('returns no match when no signals are configured', () => {
    const issue: SupportClassifiableIssue = { epicKey: 'PROJ-1', labels: ['support'] };
    const result = classifySupport(issue, [link('clones', 'TTB-9')], emptyConfig);
    expect(result.isSupport).toBe(false);
    expect(result.matchReason).toBeNull();
  });

  it('matches on epic (case-insensitive) and reports reason "epic"', () => {
    const config = { ...emptyConfig, supportEpics: ['PROJ-1'] };
    const issue: SupportClassifiableIssue = { epicKey: 'proj-1', labels: [] };
    const result = classifySupport(issue, [], config);
    expect(result.isSupport).toBe(true);
    expect(result.matchReason).toBe('epic');
    expect(result.isTtbSupport).toBe(false);
  });

  it('does not match epic when epicKey is null', () => {
    const config = { ...emptyConfig, supportEpics: ['PROJ-1'] };
    const issue: SupportClassifiableIssue = { epicKey: null, labels: [] };
    expect(classifySupport(issue, [], config).isSupport).toBe(false);
  });

  it('matches on label intersection and reports reason "label"', () => {
    const config = { ...emptyConfig, supportLabels: ['support'] };
    const issue: SupportClassifiableIssue = { epicKey: null, labels: ['x', 'support'] };
    const result = classifySupport(issue, [], config);
    expect(result.isSupport).toBe(true);
    expect(result.matchReason).toBe('label');
  });

  it('matches on TTB link (link type + triage prefix) and flags isTtbSupport', () => {
    const config = { ...emptyConfig, supportLinkTypes: ['clones'], triageBoardKey: 'TTB' };
    const issue: SupportClassifiableIssue = { epicKey: null, labels: [] };
    const result = classifySupport(issue, [link('clones', 'TTB-42')], config);
    expect(result.isSupport).toBe(true);
    expect(result.matchReason).toBe('link');
    expect(result.isTtbSupport).toBe(true);
  });

  it('does not match link when target is not on the triage board', () => {
    const config = { ...emptyConfig, supportLinkTypes: ['clones'], triageBoardKey: 'TTB' };
    const issue: SupportClassifiableIssue = { epicKey: null, labels: [] };
    expect(classifySupport(issue, [link('clones', 'PROJ-42')], config).isSupport).toBe(false);
  });

  it('joins multiple reasons with "+" in signal order epic+label+link', () => {
    const config: SupportClassifierConfig = {
      supportEpics: ['PROJ-1'],
      supportLabels: ['support'],
      supportLinkTypes: ['clones'],
      triageBoardKey: 'TTB',
    };
    const issue: SupportClassifiableIssue = { epicKey: 'PROJ-1', labels: ['support'] };
    const result = classifySupport(issue, [link('clones', 'TTB-1')], config);
    expect(result.matchReason).toBe('epic+label+link');
    expect(result.isTtbSupport).toBe(true);
  });
});
