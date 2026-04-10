export type DoraBand = 'elite' | 'high' | 'medium' | 'low';

export function classifyDeploymentFrequency(
  deploymentsPerDay: number,
): DoraBand {
  if (deploymentsPerDay >= 2) return 'elite';
  if (deploymentsPerDay >= 1 / 7) return 'high'; // at least weekly
  if (deploymentsPerDay >= 1 / 30) return 'medium'; // at least monthly
  return 'low';
}

export function classifyLeadTime(medianDays: number): DoraBand {
  if (medianDays < 1) return 'elite';
  if (medianDays <= 7) return 'high';
  if (medianDays <= 30) return 'medium';
  return 'low';
}

export function classifyChangeFailureRate(percentage: number): DoraBand {
  if (percentage <= 5) return 'elite';
  if (percentage <= 10) return 'high';
  if (percentage <= 15) return 'medium';
  return 'low';
}

export function classifyMTTR(medianHours: number): DoraBand {
  if (medianHours < 1) return 'elite';
  if (medianHours < 24) return 'high';
  if (medianHours < 168) return 'medium'; // 7 days
  return 'low';
}
