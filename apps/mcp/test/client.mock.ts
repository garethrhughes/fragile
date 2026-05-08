import { vi } from 'vitest';
import type { ApiResponse } from '../src/client.js';

export const mockApiGet = vi.fn<
  [string, (Record<string, string | number | boolean | undefined> | undefined)?],
  Promise<ApiResponse<unknown>>
>();

export const mockApiPost = vi.fn<[string, unknown], Promise<ApiResponse<unknown>>>();
export const mockApiPatch = vi.fn<[string, unknown], Promise<ApiResponse<unknown>>>();
export const mockApiPut = vi.fn<[string, unknown], Promise<ApiResponse<unknown>>>();
export const mockApiDelete = vi.fn<[string], Promise<ApiResponse<unknown>>>();

export function mockSuccess<T>(data: T, status = 200): ApiResponse<T> {
  return { status, data };
}

export function mockPending<T>(data: T): ApiResponse<T> {
  return { status: 202, data };
}
