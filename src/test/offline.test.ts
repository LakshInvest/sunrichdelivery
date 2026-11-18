import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),upload:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc,storage:{from:()=>({upload:mocks.upload})}}}));
import {bindQueueUser,queueRpc,replayQueue,pendingEntries,pendingCount,queuePhoto} from '../lib/offline';
describe('durable once-only offline queue',()=>{
 beforeEach(()=>{localStorage.clear();bindQueueUser(null);mocks.rpc.mockReset();mocks.upload.mockReset();Object.defineProperty(navigator,'onLine',{configurable:true,value:false});});
 it('never replays another user’s pending action',async()=>{bindQueueUser('driver-one');await queueRpc('mark_arrived',{p_stop_id:'qa'});bindQueueUser('driver-two');expect(pendingEntries()).toHaveLength(0);bindQueueUser('driver-one');expect(pendingEntries()).toHaveLength(1);});
 it('never deletes failed action sync',async()=>{await queueRpc('record_stop_arrival',{p_stop_id:'qa'});Object.defineProperty(navigator,'onLine',{value:true,configurable:true});mocks.rpc.mockResolvedValue({error:{message:'Not allowed'}});await replayQueue();expect(pendingEntries()).toHaveLength(1);expect(pendingEntries()[0]?.error).toBe('Not allowed');});
 it('never deletes a failed photo',async()=>{queuePhoto('qa/photo','data:image/jpeg;base64,eA==','image/jpeg');mocks.upload.mockResolvedValue({error:{message:'Storage unavailable'}});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({blob:async()=>new Blob(['x'])}));await replayQueue();expect(pendingCount()).toBe(1);vi.unstubAllGlobals();});
 it('duplicate offline taps keep a single operation',async()=>{await queueRpc('mark_arrived',{p_stop_id:'qa'});await queueRpc('mark_arrived',{p_stop_id:'qa'});expect(pendingEntries()).toHaveLength(1);});
 it('retries preserve the original id and remove only after success',async()=>{await queueRpc('mark_arrived',{p_stop_id:'qa'});const id=pendingEntries()[0]?.id;mocks.rpc.mockResolvedValueOnce({error:{message:'Failed to fetch'}}).mockResolvedValueOnce({error:null});await replayQueue();await replayQueue();expect(mocks.rpc.mock.calls.map(c=>c[1].p_op_id)).toEqual([id,id]);expect(pendingEntries()).toHaveLength(0);});
});