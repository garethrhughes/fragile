import { create } from 'zustand'

/** Filter values for a single report, keyed by filter.key */
export type ReportFilterValues = Record<string, string | string[] | undefined>

export interface CustomReportFiltersState {
  /** Map from reportId → { filterKey → selected value(s) } */
  valuesByReport: Record<string, ReportFilterValues>
  setFilterValue: (reportId: string, key: string, value: string | string[] | undefined) => void
  resetFilters: (reportId: string) => void
}

export const useCustomReportFiltersStore = create<CustomReportFiltersState>((set) => ({
  valuesByReport: {},

  setFilterValue: (reportId, key, value) =>
    set((state) => ({
      valuesByReport: {
        ...state.valuesByReport,
        [reportId]: {
          ...state.valuesByReport[reportId],
          [key]: value,
        },
      },
    })),

  resetFilters: (reportId) =>
    set((state) => {
      const next = { ...state.valuesByReport }
      delete next[reportId]
      return { valuesByReport: next }
    }),
}))
