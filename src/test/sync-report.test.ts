import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client', () => ({supabase:{rpc:mocks.rpc,storage:{from:()=>({upload:vi.fn()})}}}));
import { bindQueueUser, installSyncReporting, registerSyncTrip, queueRpc, queuePhoto, replayQueue } from '@/lib/offline';
import { syncReportPayload, SYNC_REPORT_INTERVAL } from '@/lib/sync-report-policy';
describe('driver pending reports', () => {
  let stop: (()=>void) | undefined;
  beforeEach(() => {localStorage.clear();bindQueueUser('qa-driver');mocks.rpc.mockReset();mocks.rpc.mockResolvedValue({error:null});Object.defineProperty(navigator,'onLine',{configurable:true,value:true});});
  afterEach(() => {stop?.();stop=undefined;vi.useRealTimers();});
  it('counts actions and photos, with oldest timestamp and distinct kinds', () => {
    expect(syncReportPayload('qa',[{rpc:'deliver_stop',createdAt:2000},{rpc:'collect_stop_payment',createdAt:3000}],[{createdAt:1000}])).toEqual({p_trip_id:'qa',p_pending:3,p_oldest:'1970-01-01T00:00:01.000Z',p_kinds:['delivery','payment','photo'],p_app_version:'1.0'});
  });
  it('reports empty queues with zero and no oldest entry', () => {
    expect(syncReportPayload('qa',[],[])).toMatchObject({p_pending:0,p_oldest:null,p_kinds:[]});
  });
  it('reports queue changes and reports zero after successful replay', async () => {
    registerSyncTrip('qa');stop=installSyncReporting();await vi.waitFor(()=>expect(mocks.rpc).toHaveBeenCalled());
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});await queueRpc('deliver_stop',{p_stop_id:'stop'});
    Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));
    await vi.waitFor(()=>expect(mocks.rpc.mock.calls.some(c=>c[0]==='driver_report_sync'&&c[1].p_pending===1)).toBe(true));
    await replayQueue();await vi.waitFor(()=>expect(mocks.rpc.mock.calls.at(-1)?.[1].p_pending).toBe(0));
  });
  it('continues work when reports fail and retries every two minutes', async () => {
    vi.useFakeTimers();registerSyncTrip('qa');mocks.rpc.mockRejectedValue(new Error('Unavailable'));stop=installSyncReporting();await vi.advanceTimersByTimeAsync(0);
    queuePhoto('qa/photo','data:image/jpeg;base64,eA==','image/jpeg');await vi.advanceTimersByTimeAsync(0);
    const before=mocks.rpc.mock.calls.length;await vi.advanceTimersByTimeAsync(SYNC_REPORT_INTERVAL);expect(mocks.rpc.mock.calls.length).toBeGreaterThan(before);expect(SYNC_REPORT_INTERVAL).toBe(120000);
  });
  it('does not report the previous user’s trip after changing users', async () => {
    registerSyncTrip('qa');bindQueueUser('other');stop=installSyncReporting();await Promise.resolve();expect(mocks.rpc).not.toHaveBeenCalled();
  });
});