import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import type { Response } from 'express';
import { HttpStatus } from '@nestjs/common';

function mockResponse(): jest.Mocked<Response> {
  return {
    status: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Response>;
}

describe('SyncController', () => {
  let controller: SyncController;
  let syncService: {
    isSyncRunning: boolean;
    syncAll: jest.Mock;
    getStatus: jest.Mock;
  };

  beforeEach(() => {
    syncService = {
      isSyncRunning: false,
      syncAll: jest.fn().mockResolvedValue({ boards: [], results: [] }),
      getStatus: jest.fn().mockResolvedValue([]),
    };
    controller = new SyncController(syncService as unknown as SyncService);
  });

  describe('triggerSync', () => {
    it('defaults to a full sync when no mode is provided', () => {
      const res = mockResponse();

      const result = controller.triggerSync(res, {});

      expect(syncService.syncAll).toHaveBeenCalledWith('full');
      expect(result.status).toBe('accepted');
    });

    it('starts a full sync when mode=full', () => {
      const res = mockResponse();

      controller.triggerSync(res, { mode: 'full' });

      expect(syncService.syncAll).toHaveBeenCalledWith('full');
    });

    it('starts an incremental sync when mode=incremental', () => {
      const res = mockResponse();

      controller.triggerSync(res, { mode: 'incremental' });

      expect(syncService.syncAll).toHaveBeenCalledWith('incremental');
    });

    it('returns 409 and does not start a sync when one is already running', () => {
      syncService.isSyncRunning = true;
      const res = mockResponse();

      const result = controller.triggerSync(res, { mode: 'incremental' });

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(result.status).toBe('conflict');
      expect(syncService.syncAll).not.toHaveBeenCalled();
    });
  });
});
