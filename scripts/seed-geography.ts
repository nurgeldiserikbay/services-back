import {createHash} from 'node:crypto';
import {Client} from 'pg';

/** Deterministic v5-style UUID from fixed namespace + stable semantic ID. */
export function stableGeoId(name: string): string {
  const namespace = Buffer.from('72e850918a0948a6bf554f6e3b9159a0','hex');
  const hash = createHash('sha1').update(namespace).update(name,'utf8').digest();
  const bytes = Uint8Array.from(hash.subarray(0,16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Buffer.from(bytes).toString('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}

/** Curated starter set: deliberately incomplete, NOT worldwide geography.
 * Do not silently infer coordinates or legal market availability from city names.
 */
export const starterGeography = {
  countries:[{iso2:'KZ',name:'Kazakhstan'}],
  cities:[
    {iso2:'KZ',code:'astana',name:'Astana',timezone:'Asia/Almaty'},
    {iso2:'KZ',code:'almaty',name:'Almaty',timezone:'Asia/Almaty'},
    {iso2:'KZ',code:'shymkent',name:'Shymkent',timezone:'Asia/Almaty'},
  ],
} as const;

export async function seedStarterGeography(connectionString: string):Promise<void> {
  if(!connectionString) throw new Error('DATABASE_URL must be configured');
  const client = new Client({connectionString,connectionTimeoutMillis:4000,statement_timeout:8000});
  try {
    await client.connect();
    await client.query('BEGIN');
    // One writer only; a retry is safe.
    await client.query('SELECT pg_advisory_xact_lock($1::integer,$2::integer)',[7315,1]);
    const ids=new Map<string,string>();
    for(const country of starterGeography.countries){
      await client.query(
        'INSERT INTO countries(id,iso2,name) VALUES($1::uuid,$2,$3) ON CONFLICT(iso2) DO NOTHING',
        [stableGeoId('country:'+country.iso2),country.iso2,country.name],
      );
      const result = await client.query<{id:string}>(
        'SELECT id::text FROM countries WHERE iso2=$1',[country.iso2]);
      if(result.rows.length!==1)throw new Error('Canonical country lookup failed');
      ids.set(country.iso2,result.rows[0].id);
    }
    for(const city of starterGeography.cities){
      const countryId=ids.get(city.iso2);
      if(!countryId)throw new Error('Unknown country '+city.iso2);
      await client.query(
        'INSERT INTO cities(id,country_id,area_id,name,timezone) VALUES($1::uuid,$2::uuid,NULL,$3,$4) ON CONFLICT(id) DO NOTHING',
        [stableGeoId('city:'+city.iso2+':'+city.code),countryId,city.name,city.timezone],
      );
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(()=>{});
    throw new Error('Starter geography seed failed (rolled back)');
  } finally {
    await client.end().catch(()=>{});
  }
}
const invokedScript = process.argv[1]?.replaceAll(String.fromCharCode(92), '/');
if(invokedScript?.endsWith('/seed-geography.ts') || invokedScript?.endsWith('/seed-geography.js')){
  seedStarterGeography(process.env.DATABASE_URL??'')
    .then(()=>console.info('Starter geography seed completed'))
    .catch(()=>{console.error('Starter geography seed failed');process.exitCode=1;});
}
