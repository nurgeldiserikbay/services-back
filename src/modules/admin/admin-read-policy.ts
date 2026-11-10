import type {AdminRole} from './admin-session-verification.js';

export type AdminReadCapability='moderation.read'|'audit.read'|'taxonomy.read';

/**
 * Backend-side deny-by-default capability policy for read operations.
 * This does not authenticate a session or scope returned records.
 * Query handlers must additionally enforce tenant/region/row visibility.
 * No mutation capability is granted by this policy.
 */
const READ_PERMISSIONS:Readonly<Record<AdminRole,readonly AdminReadCapability[]>>={
  owner:['moderation.read','audit.read','taxonomy.read'],
  admin:['moderation.read','audit.read','taxonomy.read'],
  operator:['moderation.read','taxonomy.read'],
  auditor:['moderation.read','audit.read','taxonomy.read'],
};

export function canReadAdminResource(
  role:unknown,capability:unknown,
):boolean{
  if(typeof role!=='string'||typeof capability!=='string')return false;
  if(!Object.hasOwn(READ_PERMISSIONS,role))return false;
  return READ_PERMISSIONS[role as AdminRole].includes(capability as AdminReadCapability);
}
