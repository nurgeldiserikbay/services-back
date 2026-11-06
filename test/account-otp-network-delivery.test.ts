import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
function read(path:string):string{
 return readFileSync(new URL(path,root),'utf8');
}

test('account OTP network migration and retention both ship in same branch',()=>{
 const migration=read('prisma/migrations/20261106_account_otp_network_budget/migration.sql');
 const issuance=read('src/modules/identity/account-otp-issuance.ts');
 const cleanup=read('src/modules/identity/account-otp-network-cleanup.ts');
 const script=read('scripts/prune-account-otp-network.ts');
 assert.match(migration,/CREATE TABLE account_otp_network_issuances/);
 assert.match(issuance,/checkAccountOtpNetworkBudget\(db,input\.networkDigest\)/);
 assert.match(issuance,/recordAccountOtpNetworkIssuance\(db,input\.networkDigest\)/);
 assert.match(cleanup,/FOR UPDATE SKIP LOCKED/);
 assert.match(script,/SERVICES_ENABLE_ACCOUNT_NETWORK_CLEANUP/);
});

test('issuer acquires global, then network, then contact lock before insert',()=>{
 const src=read('src/modules/identity/account-otp-issuance.ts');
 const global=src.indexOf('checkAccountOtpGlobalBudget(db)');
 const network=src.indexOf('checkAccountOtpNetworkBudget(db,input.networkDigest)');
 const contact=src.indexOf("['account-otp-issuance:v1',digest]");
 const insert=src.indexOf('INSERT INTO account_auth_challenges');
 const ledger=src.indexOf('recordAccountOtpNetworkIssuance(db,input.networkDigest)');
 assert.ok(global>=0 && network>global && contact>network && insert>contact && ledger>insert);
});
