import {getJson,putJson,listJson,clean,makeId,hash,now} from './blobdb.js';
import {usesPostgres} from './database.js';
import {currentBankSettings,validBankSettings,bankSnapshot,paymentDeadline,paymentEvidenceKey,paymentEvidenceUsed} from './manual-payments.js';
import {ownsAcademy,normalizeBirthDate} from './member-profile.js';

const kinds=['product','training','support','pro'];
const managers=u=>u.roles?.some(r=>['ADMIN','CEO'].includes(r));
const finance=u=>u.roles?.some(r=>['FINANCE','ADMIN','CEO'].includes(r));
const text=(v,n=500)=>clean(v,n);
const money=v=>Number.isSafeInteger(v)&&v>=0;
const integer=v=>Number.isSafeInteger(v)&&v>0;
const validDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const fail=(res,status,message)=>res.status(status).json({ok:false,message});
const stored=(collection,id)=>getJson(collection+'/'+text(id,80)+'.json');
const expired=r=>r.status==='UNPAID'&&Date.parse(r.paymentDueAt)<=Date.now();
const inactive=r=>['CANCELED','REJECTED','REFUNDED'].includes(r.status)||expired(r);
async function audit(user,action,before,after,reason){await putJson('audit/'+makeId('aud')+'.json',{actorUserId:user.id,action,entityId:after.id,before,after,reason,createdAt:now()},{overwrite:false});}
async function save(collection,row,previous,user,action,reason){row.revision=(previous?.revision||0)+1;row.updatedAt=now();await putJson(collection+'/'+row.id+'.json',row,{overwrite:!!previous});await audit(user,action,previous,row,reason);return row;}
async function notify(row,title,body){const n={id:makeId('notice'),userId:row.userId,title,body,href:'/business.html?kind='+row.kind,createdAt:now(),readAt:null};await putJson('notifications/'+n.id+'.json',n,{overwrite:false});}
export async function recordCashFlow(row,user,direction,amount,b,action){
 const reference=text(b.reference,160),occurredAt=b.occurredAt,reason=text(b.reason);
 if(!money(amount)||amount===0||!reference||!validDate(occurredAt)||Date.parse(occurredAt)>Date.now()+60000||!reason)return {error:'실제 거래 금액·거래 시각·증빙 관리번호·처리 사유를 입력해 주세요.'};
 const bank=row.bank||bankSnapshot(await currentBankSettings()||{});
 if(!bank.accountNumber||!bank.bankName)return {error:'실제 거래 계좌를 먼저 설정해 주세요.'};
 const evidenceKey=paymentEvidenceKey(direction==='IN'?'DEPOSIT':'REFUND',bank,reference);
 const id='biz_'+evidenceKey;
 if(await paymentEvidenceUsed(evidenceKey))return {error:'대회·상품·훈련·지원 장부에 이미 기록된 거래 증빙입니다.'};
 if(direction==='IN'&&Date.parse(occurredAt)>Date.parse(row.paymentDueAt))return {error:'입금기한 이후 거래입니다. 실제 입금일을 확인해 주세요.'};
 if(action==='REFUND'){const deposit=await stored('business-ledger',row.receiptId);if(!deposit||Date.parse(occurredAt)<Date.parse(deposit.occurredAt))return {error:'원래 입금 내역과 환불 거래일을 확인해 주세요.'};}

 if(await stored('business-ledger',id))return {error:'이미 기록된 거래 증빙입니다. 중복 입금·지급 여부를 확인해 주세요.'};
 const entry={id,recordId:row.id,programId:row.programId,kind:row.kind,userId:row.userId,direction,amount,reference,evidenceKey,bank,occurredAt:new Date(occurredAt).toISOString(),reason,actorId:user.id,action,createdAt:now()};
 await putJson('business-ledger/'+id+'.json',entry,{overwrite:false});return {entry};
}
export async function publicBusiness(req,res){
 const kind=text(req.query.kind,20);if(!kinds.includes(kind))return fail(res,400,'사업 구분을 확인해 주세요.');
 const all=await listJson('business-programs/',1000,{kind}),records=await listJson('business-records/',1000,{kind});
 const programs=all.filter(p=>p.status==='OPEN').map(p=>{const used=records.filter(r=>r.programId===p.id&&!inactive(r)).reduce((n,r)=>n+r.quantity,0);return {id:p.id,kind,title:p.title,description:p.description,startsAt:p.startsAt,endsAt:p.endsAt,price:p.price,capacity:p.capacity,available:Math.max(0,p.capacity-used),canApply:p.kind==='product'||(Date.parse(p.endsAt)>Date.now()&&(p.kind==='training'?Date.parse(p.startsAt)>Date.now():Date.parse(p.startsAt)<=Date.now())),terms:p.terms,variant:p.variant||'',location:p.location||'',perPersonLimit:p.perPersonLimit,budget:p.budget,revision:p.revision};});
 return res.status(200).json({ok:true,programs});
}
export async function business(req,res,user,{admin=false}={}){
 const b=req.body||{},kind=text(req.query.kind||b.kind,20),host=req.query.view==='host';
 if(!kinds.includes(kind))return fail(res,400,'사업 구분을 확인해 주세요.');
 const programs=await listJson('business-programs/',1000,{kind}),records=await listJson('business-records/',1000,{kind});
 const owned=host?(await listJson('academies/')).filter(a=>a.status==='APPROVED'&&ownsAcademy(a,user)):[];
 const hostPrograms=programs.filter(p=>owned.some(a=>a.id===p.academyId));
 if(req.method==='GET'){
  if(admin&&!managers(user)&&!finance(user))return fail(res,403,'운영 담당자만 조회할 수 있습니다.');
  const rows=admin?records:host?records.filter(r=>hostPrograms.some(p=>p.id===r.programId)):records.filter(r=>r.userId===user.id);
  const visible=host?rows.map(r=>({id:r.id,kind:r.kind,programId:r.programId,title:r.title,athleteName:r.athleteName,status:r.status,revision:r.revision,quantity:r.quantity})):rows;
  return res.status(200).json({ok:true,programs:admin?programs:host?hostPrograms:[],records:visible.map(r=>({...r,effectiveStatus:expired(r)?'EXPIRED':r.status})),ledger:admin?await listJson('business-ledger/',1000,{kind}):[],canManage:admin&&managers(user),canFinance:admin&&finance(user),academies:admin?(await listJson('academies/')).filter(a=>a.status==='APPROVED').map(a=>({id:a.id,name:a.name})):[]});
 }
 if(!usesPostgres())return fail(res,503,'운영 데이터베이스 연결 후 처리할 수 있습니다.');
 const action=text(b.action,40),reason=text(b.reason);
 if(action==='SAVE_PROGRAM'){
  if(!admin||!managers(user))return fail(res,403,'관리자만 상품·모집·훈련을 등록할 수 있습니다.');
  const previous=b.id?programs.find(p=>p.id===b.id):null;
  if(b.id&&!previous)return fail(res,404,'등록 정보를 찾을 수 없습니다.');
  if(previous&&(b.revision!==previous.revision||previous.status!=='DRAFT'))return fail(res,409,'작성 중인 최신 정보만 수정할 수 있습니다. 공개한 조건은 보존되며 새 항목으로 등록해 주세요.');
  const row={id:previous?.id||makeId('program'),kind,title:text(b.title,180),description:text(b.description,4000),terms:text(b.terms,6000),price:Number(b.price),capacity:Number(b.capacity),startsAt:text(b.startsAt,40),endsAt:text(b.endsAt,40),location:text(b.location,300),variant:text(b.variant,100),academyId:text(b.academyId,80),agreementReference:text(b.agreementReference,300),budget:Number(b.budget||0),perPersonLimit:Number(b.perPersonLimit||0),hostFee:Number(b.hostFee||0),status:'DRAFT',createdBy:previous?.createdBy||user.id,createdAt:previous?.createdAt||now()};
  if(!row.title||!reason||!money(row.price)||!integer(row.capacity)||![row.budget,row.perPersonLimit,row.hostFee].every(money))return fail(res,400,'제목·금액·정원·처리 사유를 확인해 주세요. 금액은 0 이상의 정수입니다.');
  if(kind!=='product'&&(!validDate(row.startsAt)||!validDate(row.endsAt)||Date.parse(row.endsAt)<=Date.parse(row.startsAt)))return fail(res,400,'시작·종료 일시를 확인해 주세요.');
  if(kind==='training'&&(await stored('academies',row.academyId))?.status!=='APPROVED')return fail(res,400,'승인된 개최 도장을 선택해 주세요.');
  return res.status(previous?200:201).json({ok:true,program:await save('business-programs',row,previous,user,action,reason)});
 }
 if(['OPEN_PROGRAM','CLOSE_PROGRAM'].includes(action)){
  if(!admin||!managers(user))return fail(res,403,'관리자만 공개·마감할 수 있습니다.');
  const previous=programs.find(p=>p.id===b.id);if(!previous)return fail(res,404,'등록 정보를 찾을 수 없습니다.');
  if(b.revision!==previous.revision)return fail(res,409,'내용이 변경되었습니다. 새로고침해 주세요.');
  const row=structuredClone(previous);if(!reason)return fail(res,400,'처리 사유를 입력해 주세요.');
  if(action==='OPEN_PROGRAM'){
   if(row.status!=='DRAFT'||row.terms.length<20)return fail(res,409,'작성 중 상태에서 이용·취소 조건을 입력한 뒤 공개해 주세요.');
   if(kind!=='product'&&(!row.agreementReference||row.createdBy===user.id||Date.parse(row.endsAt)<=Date.now()))return fail(res,409,'협약·모집 기준 증빙과 유효한 일정이 필요합니다. 등록자와 다른 관리자가 검토해 주세요.');
   if(['support','pro'].includes(kind)&&(!integer(row.budget)||!integer(row.perPersonLimit)||row.perPersonLimit>row.budget))return fail(res,400,'확보된 총예산과 1인 지원 한도를 입력해 주세요.');
   if(['product','training'].includes(kind)&&row.price>0&&!validBankSettings(await currentBankSettings()))return fail(res,409,'입금계좌와 입금기한을 먼저 설정해 주세요.');
   row.status='OPEN';row.approvedBy=user.id;row.approvedAt=now();
  }else{if(row.status!=='OPEN')return fail(res,409,'공개 중인 항목만 마감할 수 있습니다.');row.status='CLOSED';}
  return res.status(200).json({ok:true,program:await save('business-programs',row,previous,user,action,reason)});
 }
 if(action==='APPLY'){
  if(admin||host)return fail(res,403,'본인 신청 화면에서 신청해 주세요.');
  if(!user.emailVerifiedAt)return fail(res,409,'내 SOC에서 이메일 인증을 완료해 주세요.');
  const p=programs.find(p=>p.id===b.programId);if(!p||p.status!=='OPEN')return fail(res,409,'현재 신청 가능한 항목이 아닙니다.');
  if(b.programRevision!==p.revision||b.consent!==true)return fail(res,409,'최신 금액과 이용·취소 조건을 확인하고 동의해 주세요.');
  if(kind!=='product'&&Date.parse(p.startsAt)>Date.now()&&kind!=='training')return fail(res,409,'아직 신청 시작 전입니다. 모집 일정을 확인해 주세요.');
  if(kind!=='product'&&Date.parse(p.endsAt)<=Date.now())return fail(res,409,'신청 기간이 종료되었습니다.');
  if(kind==='training'&&Date.parse(p.startsAt)<=Date.now())return fail(res,409,'훈련 시작 후에는 신청할 수 없습니다.');
  if(kind!=='product'){
   const profile=await stored('athletes',user.id),birth=normalizeBirthDate(profile?.birthDate);
   if(!birth)return fail(res,409,'선수정보에서 생년월일을 먼저 등록해 주세요.');
   const adultDate=new Date();adultDate.setUTCFullYear(adultDate.getUTCFullYear()-19);
   if(birth>adultDate.toISOString().slice(0,10)&&(await stored('guardian-consents',user.id))?.status!=='VERIFIED')return fail(res,409,'미성년자는 운영진의 보호자 동의 확인 후 신청할 수 있습니다.');
  }
  const quantity=kind==='product'?Number(b.quantity):1;
  if(!integer(quantity)||quantity>100)return fail(res,400,'신청 수량을 확인해 주세요.');
  if(records.some(r=>r.programId===p.id&&r.userId===user.id&&!inactive(r)))return fail(res,409,'이미 신청한 내역이 있습니다. 내 신청내역을 확인해 주세요.');
  const used=records.filter(r=>r.programId===p.id&&!inactive(r)).reduce((n,r)=>n+r.quantity,0);
  if(used+quantity>p.capacity)return fail(res,409,'잔여 정원 또는 재고가 부족합니다.');
  const bank=await currentBankSettings(),amount=['product','training'].includes(kind)?p.price*quantity:0;
  if(!money(amount)||amount>0&&!validBankSettings(bank))return fail(res,409,'입금계좌 또는 금액을 확인할 수 없습니다. 운영진에게 문의해 주세요.');
  const evidence=text(b.evidence,2000),delivery=text(b.delivery,1000);
  if(kind==='product'&&!delivery)return fail(res,400,'수령인·연락처·배송지를 입력해 주세요.');
  if(['support','pro'].includes(kind)&&evidence.length<10)return fail(res,400,'경기 기록·영상 주소와 신청 내용을 입력해 주세요.');
  const row={id:makeId('business'),programId:p.id,kind,userId:user.id,socId:user.socId,athleteName:user.name,title:p.title,quantity,amount,status:['support','pro'].includes(kind)?'SUBMITTED':amount?'UNPAID':'CONFIRMED',termsSnapshot:p.terms,programRevision:p.revision,variant:p.variant,bank:amount?bankSnapshot(bank):null,paymentDueAt:amount?paymentDeadline({},bank):null,evidence,delivery,awardAmount:0,paidOut:0,createdAt:now()};
  if(kind==='training'&&row.paymentDueAt&&row.paymentDueAt>p.startsAt)row.paymentDueAt=p.startsAt;
  return res.status(201).json({ok:true,record:await save('business-records',row,null,user,action,'본인 신청')});
 }
 const previous=records.find(r=>r.id===b.id);if(!previous)return fail(res,404,'신청내역을 찾을 수 없습니다.');
 const p=programs.find(p=>p.id===previous.programId),row=structuredClone(previous),own=row.userId===user.id;
 if(b.revision!==row.revision)return fail(res,409,'처리 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
 if(!reason)return fail(res,400,'처리 사유를 입력해 주세요.');
 const memberActions=['CANCEL','REPORT_DEPOSIT','REQUEST_REFUND'];
 if(memberActions.includes(action)){
  if(!own||admin||host)return fail(res,403,'본인 신청만 변경할 수 있습니다.');
  if(action==='CANCEL'){
   if(!['UNPAID','SUBMITTED','CONFIRMED'].includes(row.status)||kind==='training'&&Date.parse(p.startsAt)<=Date.now())return fail(res,409,'입금 신고 건은 담당자 확인 후 취소할 수 있습니다. 입금이 확인된 신청은 환불을 요청해 주세요.');row.status='CANCELED';
  }
  if(action==='REPORT_DEPOSIT'){
   if(row.status!=='UNPAID'||expired(row))return fail(res,409,'신고 가능한 미입금 신청이 아닙니다. 입금기한을 확인해 주세요.');
   if(Number(b.amount)!==row.amount||!text(b.depositorName,80)||!validDate(b.occurredAt)||Date.parse(b.occurredAt)>Date.now()+60000)return fail(res,400,'신청금액과 입금자명·입금 시각을 확인해 주세요.');
   row.depositClaim={amount:row.amount,name:text(b.depositorName,80),occurredAt:b.occurredAt};row.status='DEPOSIT_REPORTED';
  }
  if(action==='REQUEST_REFUND'){
   if(!['PAID','SHIPPED','DELIVERED'].includes(row.status))return fail(res,409,'입금 확인된 주문·신청만 환불을 요청할 수 있습니다.');row.beforeRefund=row.status;row.status='REFUND_REQUESTED';row.refundReason=reason;
  }
 }else if(action==='ATTEND'){
  const academy=p?.academyId?await stored('academies',p.academyId):null;
  if(kind!=='training'||!(admin&&managers(user)||host&&academy?.status==='APPROVED'&&ownsAcademy(academy,user))||own)return fail(res,403,'개최 도장 또는 운영진이 다른 참가자의 출석을 확인합니다.');
  if(!['PAID','CONFIRMED'].includes(row.status)||Date.now()<Date.parse(p.startsAt))return fail(res,409,'훈련 시작 이후 확정된 참가자의 출석을 확인해 주세요.');row.status='ATTENDED';row.attendedBy=user.id;row.attendedAt=now();row.attendanceReference=reason;
 }else{
  if(!admin||!finance(user)||own)return fail(res,403,'본인 신청을 제외한 운영 담당자만 처리할 수 있습니다.');
  if(action==='REJECT_DEPOSIT'){
   if(row.status!=='DEPOSIT_REPORTED')return fail(res,409,'입금 확인 요청 건만 반려할 수 있습니다.');row.status='UNPAID';row.depositRejection=reason;
  }else if(action==='CONFIRM_DEPOSIT'){
   if(!['UNPAID','DEPOSIT_REPORTED'].includes(row.status)||expired(row)||Number(b.amount)!==row.amount)return fail(res,409,'신청금액과 상태·입금기한을 확인해 주세요.');
   const l=await recordCashFlow(row,user,'IN',row.amount,b,action);if(l.error)return fail(res,400,l.error);row.status='PAID';row.receiptId=l.entry.id;
  }else if(action==='REVIEW_APPLICATION'){
   if(!managers(user)||!['support','pro'].includes(kind)||row.status!=='SUBMITTED'||p.createdBy===user.id)return fail(res,403,'등록자·신청자와 다른 관리자가 심사해 주세요.');
   if(b.accept===true){const amount=Number(b.amount),allocated=records.filter(r=>r.programId===p.id&&r.id!==row.id&&['SELECTED','PAID_OUT'].includes(r.status)).reduce((n,r)=>n+r.awardAmount,0);if(!integer(amount)||amount>p.perPersonLimit||allocated+amount>p.budget||!text(b.contractReference,300))return fail(res,409,'확보 예산·1인 한도·계약 증빙을 확인해 주세요.');row.awardAmount=amount;row.contractReference=text(b.contractReference,300);row.selectedBy=user.id;row.status='SELECTED';}else row.status='REJECTED';row.reviewReason=reason;
  }else if(action==='PAYOUT'){
   if(!['support','pro'].includes(kind)||row.status!=='SELECTED'||user.id===row.selectedBy||!row.contractReference)return fail(res,403,'선발 승인자와 다른 지급 담당자가 계약 조건과 지급 증빙을 확인해 주세요.');
   const amount=Number(b.amount);if(!integer(amount)||row.paidOut+amount>row.awardAmount)return fail(res,409,'잔여 지원 한도를 초과했습니다.');const l=await recordCashFlow(row,user,'OUT',amount,b,action);if(l.error)return fail(res,400,l.error);row.paidOut+=amount;if(row.paidOut===row.awardAmount)row.status='PAID_OUT';
  }else if(action==='SHIP'){
   if(kind!=='product'||row.status!=='PAID'||!text(b.tracking,200))return fail(res,409,'입금 확인 후 택배사와 운송장 번호를 입력해 주세요.');row.status='SHIPPED';row.tracking=text(b.tracking,200);
  }else if(action==='DELIVER'){
   if(kind!=='product'||row.status!=='SHIPPED')return fail(res,409,'발송된 주문만 배송 완료 처리할 수 있습니다.');row.status='DELIVERED';
  }else if(action==='REJECT_REFUND'){
   if(!managers(user)||row.status!=='REFUND_REQUESTED')return fail(res,409,'환불 요청을 확인해 주세요.');row.status=row.beforeRefund;row.refundRejection=reason;
  }else if(action==='APPROVE_REFUND'){
   if(!managers(user)||row.status!=='REFUND_REQUESTED'||!money(Number(b.amount))||Number(b.amount)>row.amount||!text(b.contractReference,300))return fail(res,409,'환불 요청·환불액·정책 및 수취인 확인 증빙을 검토해 주세요.');row.refundAmount=Number(b.amount);row.refundApprovedBy=user.id;row.refundEvidence=text(b.contractReference,300);row.status='REFUND_APPROVED';
  }else if(action==='REFUND'){
   if(row.status!=='REFUND_APPROVED'||row.refundApprovedBy===user.id||Number(b.amount)!==row.refundAmount)return fail(res,403,'환불 승인자와 다른 담당자가 승인된 금액을 확인해 주세요.');
   if(row.refundAmount>0){const l=await recordCashFlow(row,user,'OUT',row.refundAmount,b,action);if(l.error)return fail(res,400,l.error);row.refundId=l.entry.id;}row.status='REFUNDED';
   if(kind==='product'&&['SHIPPED','DELIVERED'].includes(row.beforeRefund)&&b.restock!==true){const changed={...p,capacity:p.capacity-row.quantity};await save('business-programs',changed,p,user,'STOCK_RETURN_NOT_RECEIVED',reason);}
  }else if(action==='APPROVE_SETTLEMENT'){
   if(!managers(user)||kind!=='training'||row.status!=='ATTENDED'||user.id===row.attendedBy||!p.agreementReference||!integer(p.hostFee))return fail(res,403,'출석 확인자와 다른 관리자가 협약 단가와 출석을 검토해 주세요.');row.status='SETTLEMENT_APPROVED';row.settlementAmount=p.hostFee;row.settlementApprovedBy=user.id;
  }else if(action==='SETTLE'){
   if(kind!=='training'||row.status!=='SETTLEMENT_APPROVED'||row.settlementApprovedBy===user.id||Number(b.amount)!==row.settlementAmount)return fail(res,403,'정산 승인자와 다른 담당자가 승인된 금액을 기록해 주세요.');const l=await recordCashFlow(row,user,'OUT',row.settlementAmount,b,action);if(l.error)return fail(res,400,l.error);row.status='SETTLED';row.settlementId=l.entry.id;
  }else return fail(res,400,'처리 종류를 확인해 주세요.');
 }
 await save('business-records',row,previous,user,action,reason);
 if(!memberActions.includes(action))await notify(row,'신청 처리 안내',row.title+' · '+reason);
 return res.status(200).json({ok:true,record:row});
}
