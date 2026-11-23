import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 checkRegisteredRequestBudget,REGISTERED_REQUEST_BUDGET,
} from '../src/modules/requests/registered-customer-request.budget.js';

const actor='123e4567-e89b-42d3-a456-426614174000';
function fixture(minute:string,hour:string,day:string){
 const queries:{sql:string;values:unknown[]}[]=[];
 const client={
  query:async(sql:string,values:unknown[]=[]):Promise<{rows:unknown[]}>=>{
   queries.push({sql,values});
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('FROM service_requests'))
    return {rows:[{minute_count:minute,hour_count:hour,day_count:day}]};
   throw Error('unexpected_sql');
  },
 };
 return {client,queries};
}
test('registered request budget uses a per-person transaction lock before query',async()=>{
 const {client,queries}=fixture('0','0','0');
 const result=await checkRegisteredRequestBudget(client as never,actor);
 assert.deepEqual(result,{allowed:true,retryAfterSeconds:0,reason:'ok'});
 assert.equal(queries.length,2);
 assert.match(queries[0]!.sql,/pg_advisory_xact_lock/);
 assert.deepEqual(queries[0]!.values,['registered-request-budget:v1',actor]);
 assert.match(queries[1]!.sql,/customer_person_id=\$1::uuid/);
 assert.deepEqual(queries[1]!.values,[actor]);
 assert.match(queries[1]!.sql,/24 hours/);
 assert.deepEqual(REGISTERED_REQUEST_BUDGET,
  {perMinute:5,perHour:20,perDay:50});
});
test('minute, hour and day ceilings are inclusive and prioritized',async()=>{
 for(const [counts,reason,seconds] of [
  [['5','5','5'],'account_minute',60],
  [['0','20','20'],'account_hour',3600],
  [['0','0','50'],'account_day',86400],
  [['5','20','50'],'account_day',86400],
 ] as const){
  const {client}=fixture(...counts);
  const result=await checkRegisteredRequestBudget(client as never,actor);
  assert.deepEqual(result,{allowed:false,retryAfterSeconds:seconds,reason});
 }
});
test('malformed actors or inconsistent counters fail closed',async()=>{
 const {client,queries}=fixture('0','0','0');
 await assert.rejects(checkRegisteredRequestBudget(client as never,'../foreign'),
  /invalid_registered_request_actor/);
 assert.equal(queries.length,0);
 for(const [m,h,d] of [['-1','0','0'],['6','5','5'],
  ['0','8','5'],['NaN','0','0'],['0','0','1.5']]){
  const bad=fixture(m!,h!,d!);
  await assert.rejects(checkRegisteredRequestBudget(bad.client as never,actor),
   /registered_request_budget_invalid_counts/);
 }
});
