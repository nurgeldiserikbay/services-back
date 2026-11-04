import {BadRequestException,UnauthorizedException} from '@nestjs/common';
import {validateIdempotencyKey} from '../guest-requests/guest-request.validation.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSellerDecisionHttp(input:{
  authorization:unknown;requestId:unknown;version:unknown;idempotencyKey:unknown;
}):{token:string;requestId:string;expectedVersion:number;key:string}{
  if(typeof input.authorization!=='string')throw new UnauthorizedException('Authentication required');
  const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(input.authorization);
  if(!match)throw new UnauthorizedException('Authentication required');
  if(typeof input.requestId!=='string'||!UUID.test(input.requestId))
    throw new BadRequestException('Invalid request ID');
  // A strong version precondition is required for all request mutations.
  // Weak ETags and wildcard If-Match intentionally not accepted.
  if(typeof input.version!=='string'||!/^"[1-9][0-9]{0,9}"$/.test(input.version))
    throw new BadRequestException('If-Match must be a quoted positive version');
  const expectedVersion=Number(input.version.slice(1,-1));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new BadRequestException('Invalid If-Match');
  return {
    token:match[1],
    requestId:input.requestId.toLowerCase(),
    expectedVersion,
    key:validateIdempotencyKey(input.idempotencyKey),
  };
}
