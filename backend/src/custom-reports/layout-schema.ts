import { z } from 'zod';

export const widgetLayoutOverrideSchema = z.object({
  colSpan: z.number().int().min(1).max(6).optional(),
});

export const reportLayoutSchema = z.object({
  defaultColumns: z.number().int().min(1).max(6).optional(),
  widgets: z.record(z.string(), widgetLayoutOverrideSchema).optional(),
});

export type ReportLayout = z.infer<typeof reportLayoutSchema>;
