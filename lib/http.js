import {isDemoEmail} from './demo-account.js';
import { inTransaction, usesPostgres, demoEnabled } from './database.js';
import {hash} from './blobdb.js';
import { requireSameOrigin, parseCookies } from './auth.js';
import { consumeAuthAttempt } from './rate-limit.js';

// Apply the same boundary to direct function URLs and rewritten routes.
export function apiHandler(handler, methods) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const op = String(req.query?.op || '').toLowerCase();
    const allowed = Array.isArray(methods) ? methods : methods[op];
    if (allowed && !allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '));
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!requireSameOrigin(req, res)) return;
      const type = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        return res.status(415).json({ ok: false, error: 'json_required' });
      }
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: 'invalid_body' });
      }
    }
    try {
      if(op==='health'&&allowed?.includes('GET'))return await handler(req,res);
      if(process.env.VERCEL_ENV==='preview'&&process.env.SOC_PREVIEW_ISOLATED!=='true')return res.status(503).json({ok:false,error:'preview_storage_not_isolated',message:'검수용 데이터베이스 연결 전입니다. 이 화면에서는 회원정보를 저장하지 않습니다.'});
      if(process.env.VERCEL_ENV==='production'&&!usesPostgres()&&!['GET','HEAD','OPTIONS'].includes(req.method)&&op!=='logout')return res.status(503).json({ok:false,error:'transactional_database_required',message:'운영 데이터베이스 준비 중입니다. 아직 신청·변경 내용을 저장할 수 없습니다.'});
      if(!usesPostgres())return await handler(req,res);
      const wantsDemo=op==='login'?isDemoEmail(String(req.body?.email||'').trim().toLowerCase()):parseCookies(req)['__Host-soc_demo']==='1';
      const demo=demoEnabled()&&wantsDemo;
      if(demo&&['email-request','email-confirm','reset-request','reset-confirm','register'].includes(op))return res.status(409).json({ok:false,error:'demo_action_unavailable',message:'공용 테스트 계정에서는 회원가입·이메일 발송을 하지 않습니다. 테스트 종료 후 이용해 주세요.'});
      if(['email-request','email-confirm','reset-request','reset-confirm','login','register','mfa-start','mfa-confirm','change-password'].includes(op)){
        const limit=await consumeAuthAttempt(op,['login','register','reset-request','reset-confirm'].includes(op)?req.body?.email:hash(parseCookies(req)['__Host-soc_session']||'missing-session'),{demo});
        if(!limit.allowed){res.setHeader('Retry-After',String(limit.retryAfter));return res.status(429).json({ok:false,error:'too_many_attempts',message:'요청 횟수를 초과했습니다. 15분 뒤 다시 시도해 주세요.'});}
      }
      const staged={statusCode:200,headers:{},body:undefined,kind:'end',
        setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},
        json(value){this.body=value;this.kind='json';return this;},
        send(value){this.body=value;this.kind='send';return this;},end(){return this;}};
      const result=await inTransaction(async()=>{await handler(req,staged);return staged;},{write:req.method!=='GET'||op==='certificate',demo});
      for(const [key,value] of Object.entries(result.headers))res.setHeader(key,value);
      return res.status(result.statusCode)[result.kind](result.body);
    } catch (error) {
      // Do not expose provider messages, personal data, paths, or secrets.
      const conflict = error?.name === 'BlobPreconditionFailedError'||['23505','40001','40P01'].includes(error?.code);
      return res.status(conflict ? 409 : 503).json({
        ok: false,
        error: conflict ? 'concurrent_update' : 'service_unavailable',
        message: conflict ? '다른 요청이 먼저 처리되었습니다. 새로고침해 주세요.' : '처리 상태를 확인한 뒤 다시 시도해 주세요.'
      });
    }
  };
}
