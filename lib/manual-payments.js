import {usesPostgres} from './database.js';
import {getJson,putJson,listJson,makeId,clean,now,hash} from './blobdb.js';

export const paymentRoles=['FINANCE','STAFF','ADMIN','CEO'];
export function validBankSettings(b){
  return !!b&&b.enabled===true&&typeof b.bankName==='string'&&b.bankName.length>0&&
    typeof b.accountHolder==='string'&&b.accountHolder.length>0&&/^[0-9 -]{6,30}$/.test(b.accountNumber||'')&&
    Number.isInteger(b.paymentHours)&&b.paymentHours>=1&&b.paymentHours<=168;
}
export async function currentBankSettings(){return getJson('system/bank-transfer.json');}
export function bankSnapshot(b){return {version:b.version,bankName:b.bankName,accountNumber:b.accountNumber,accountHolder:b.accountHolder,instructions:b.instructions||''};}
export function paymentDeadline(tournament,settings){
  const limit=Date.now()+settings.paymentHours*3600000,close=Date.parse(tournament.registrationCloseAt);
  return new Date(Number.isFinite(close)?Math.min(limit,close):limit).toISOString();
}
async function locked(reg){return (await listJson('brackets/',1000,{tournamentId:reg.tournamentId,divisionKey:reg.divisionKey})).some(b=>b.status==='PUBLISHED');}
async function hasDependents(reg){return (await listJson('registrations/',1000,{userId:reg.userId,tournamentId:reg.tournamentId})).some(r=>r.id!==reg.id&&r.status==='REGISTERED'&&r.priceSnapshot?.baseRegistrationId===reg.id);}
export function paymentSummary(ledger,regs){
  const received=ledger.filter(e=>e.kind==='DEPOSIT').reduce((sum,e)=>sum+e.amount,0),refunded=ledger.filter(e=>e.kind==='REFUND').reduce((sum,e)=>sum+e.amount,0);
  return {received,refunded,netReceived:received-refunded,pending:regs.filter(r=>r.status==='REGISTERED'&&['UNPAID','PENDING'].includes(r.paymentStatus)).length,refundRequests:regs.filter(r=>r.paymentStatus==='REFUND_REQUESTED').length,legacyUnreconciled:regs.filter(r=>['PAID','REFUND_REQUESTED'].includes(r.paymentStatus)&&!r.receiptLedgerId).length};
}
export async function auditPayment(actor,action,reg,before,reason){
  await putJson('audit/'+makeId('aud')+'.json',{actorUserId:actor,action,entityType:'REGISTRATION',entityId:reg.id,before,after:reg,reason,createdAt:now()},{overwrite:false});
}
export async function confirmManualPayment(reg,b,user){
  if(reg.userId===user.id)return {error:'independent_payment_operator_required',status:403};
  const status=clean(b.paymentStatus,30),reason=clean(b.reason,500),reference=clean(b.reference,120);
  if(!['PAID','REFUNDED','UNPAID'].includes(status))return {error:'invalid_payment_transition',status:400};
  if(!reason||!reference)return {error:'payment_evidence_required',status:400};
  if(!Number.isInteger(b.revision)||b.revision!==(reg.paymentRevision||0))return {error:'payment_revision_conflict',status:409};
  if(reg.status!=='REGISTERED')return {error:'registration_inactive',status:409};
  if(status===reg.paymentStatus)return {error:'payment_status_unchanged',status:409};
  if(status!=='PAID'&&await locked(reg))return {error:'published_bracket_requires_correction',status:409};
  if(status==='REFUNDED'&&await hasDependents(reg))return {error:'dependent_registrations_active',status:409};
  if(status==='PAID'&&reg.priceSnapshot?.baseRegistrationId){
    const base=await getJson('registrations/'+reg.priceSnapshot.baseRegistrationId+'.json');
    if(!base||base.status!=='REGISTERED'||base.paymentStatus!=='PAID'||base.userId!==reg.userId||base.tournamentId!==reg.tournamentId)return {error:'base_payment_required',status:409};
  }
  if(status==='REFUNDED'&&(!reg.refundApproval||reg.refundApproval.status!=='APPROVED'||!Number.isSafeInteger(reg.refundApproval.amount)||reg.refundApproval.amount<=0||reg.refundApproval.amount>reg.amount))return {error:'refund_approval_required',status:409};
  if(status==='REFUNDED'&&reg.refundApproval.reviewedBy===user.id)return {error:'independent_refund_executor_required',status:403};
  const before=structuredClone(reg);
  if(status==='UNPAID'){
    if(reg.paymentStatus!=='PENDING')return {error:'invalid_payment_transition',status:409};
    reg.paymentStatus='UNPAID';reg.claimRejectedReason=reason;
  }else{
    if(status==='PAID'&&!['UNPAID','PENDING'].includes(reg.paymentStatus))return {error:'invalid_payment_transition',status:409};
    if(status==='REFUNDED'&&!['PAID','REFUND_REQUESTED'].includes(reg.paymentStatus))return {error:'payment_not_refundable',status:409};
    if(!Number.isSafeInteger(b.amount)||b.amount!==(status==='REFUNDED'?reg.refundApproval.amount:reg.amount)||b.amount<0)return {error:'payment_amount_mismatch',status:400};
    const occurred=Date.parse(b.occurredAt);
    if(!Number.isFinite(occurred)||occurred>Date.now()+300000)return {error:'payment_date_required',status:400};
    const event=await getJson('tournaments/'+reg.tournamentId+'.json');
    if(status==='PAID'&&(!event||event.deletedAt||event.status==='CANCELED'))return {error:'tournament_inactive',status:409};
    if(status==='PAID'&&reg.paymentDueAt&&occurred>Date.parse(reg.paymentDueAt))return {error:'payment_after_deadline',status:409};
    const bank=reg.bankTransfer;
    if(status==='PAID'&&reg.amount>0&&(!bank?.accountNumber||!bank?.bankName))return {error:'bank_details_missing',status:409};
    if(status==='REFUNDED'&&!reg.receiptLedgerId)return {error:'legacy_payment_review_required',status:409};
    const deposit=reg.receiptLedgerId?await getJson('payment-ledger/'+reg.receiptLedgerId+'.json'):null;
    if(status==='REFUNDED'&&(!deposit||deposit.registrationId!==reg.id||deposit.kind!=='DEPOSIT'||occurred<Date.parse(deposit.occurredAt)))return {error:'invalid_refund_receipt',status:409};
    const kind=status==='PAID'?'DEPOSIT':'REFUND';
    const evidenceKey=hash([kind,bank?.bankName||'ZERO_FEE',bank?.accountNumber?.replace(/[ -]/g,'')||'',reference.toUpperCase()].join('|'));
    if((await listJson('payment-ledger/',1000,{evidenceKey})).length)return {error:'payment_evidence_already_used',status:409};
    const entry={id:makeId('pay'),kind,registrationId:reg.id,tournamentId:reg.tournamentId,amount:b.amount,currency:'KRW',evidenceKey,reference,occurredAt:new Date(occurred).toISOString(),recordedAt:now(),recordedBy:user.id,reason,reverses:status==='REFUNDED'?reg.receiptLedgerId:null};
    await putJson('payment-ledger/'+entry.id+'.json',entry,{overwrite:false});
    if(status==='PAID')reg.receiptLedgerId=entry.id;
    else {reg.refundLedgerId=entry.id;reg.refundedAmount=b.amount;reg.retainedAmount=reg.amount-b.amount;reg.status='REFUNDED';}
    reg.paymentStatus=status;
  }
  reg.paymentRevision=(reg.paymentRevision||0)+1;reg.paymentMethod='BANK_TRANSFER';reg.paymentUpdatedBy=user.id;reg.paymentUpdatedAt=now();reg.updatedAt=now();
  await putJson('registrations/'+reg.id+'.json',reg);
  await auditPayment(user.id,'MANUAL_PAYMENT_'+status,reg,before,reason);
  return {registration:reg};
}
export async function memberPaymentChange(reg,b,user){
  if(reg.status!=='REGISTERED')return {error:'registration_inactive',status:409};
  if(!Number.isInteger(b.revision)||b.revision!==(reg.paymentRevision||0))return {error:'payment_revision_conflict',status:409};
  const action=clean(b.action,30),before=structuredClone(reg),reason=clean(b.reason,500);
  if(['REQUEST_REFUND','CANCEL'].includes(action)&&await hasDependents(reg))return {error:'dependent_registrations_active',status:409};
  if(action==='REPORT_DEPOSIT'){
    if(!['UNPAID','PENDING'].includes(reg.paymentStatus))return {error:'invalid_payment_transition',status:409};
    if(reg.paymentDueAt&&Date.now()>Date.parse(reg.paymentDueAt))return {error:'payment_deadline_passed',status:409};
    const depositorName=clean(b.depositorName,80),occurred=Date.parse(b.occurredAt);
    if(!depositorName||!Number.isSafeInteger(b.amount)||b.amount!==reg.amount||!Number.isFinite(occurred)||occurred>Date.now()+300000)return {error:'invalid_deposit_report',status:400};
    if(!reg.bankTransfer){const settings=await currentBankSettings();if(!validBankSettings(settings))return {error:'bank_details_missing',status:409};reg.bankTransfer=bankSnapshot(settings);}
    reg.depositClaim={depositorName,amount:b.amount,occurredAt:new Date(occurred).toISOString(),reportedAt:now()};
    reg.paymentStatus='PENDING';
  }else if(action==='REQUEST_REFUND'){
    if(!reason)return {error:'change_reason_required',status:400};
    if(reg.paymentStatus!=='PAID')return {error:'payment_not_refundable',status:409};
    if(await locked(reg))return {error:'published_bracket_requires_correction',status:409};
    delete reg.refundApproval;reg.paymentStatus='REFUND_REQUESTED';reg.refundRequest={reason,requestedAt:now()};
  }else if(action==='CANCEL'){
    if(!reason)return {error:'change_reason_required',status:400};
    if(reg.paymentStatus!=='UNPAID')return {error:'payment_review_required',status:409};
    if(await locked(reg))return {error:'published_bracket_requires_correction',status:409};
    reg.status='CANCELED';reg.paymentStatus='CANCELED';
  }else return {error:'invalid_payment_action',status:400};
  reg.paymentRevision=(reg.paymentRevision||0)+1;reg.updatedAt=now();
  await putJson('registrations/'+reg.id+'.json',reg);await auditPayment(user.id,action,reg,before,reason||'선수 입금 신고, 은행 입금 확인 전');
  return {registration:reg};
}

export async function reviewRefund(reg,b,user){
  if(!usesPostgres())return {error:'transactional_database_required',status:503};
  if(!user.roles?.some(r=>['ADMIN','CEO'].includes(r)))return {error:'refund_approver_required',status:403};
  if(b.revision!==(reg.paymentRevision||0))return {error:'payment_revision_conflict',status:409};
  if(reg.status!=='REGISTERED'||!['PAID','REFUND_REQUESTED'].includes(reg.paymentStatus))return {error:'payment_not_refundable',status:409};
  if(reg.userId===user.id||reg.refundApproval?.status==='APPROVED')return {error:'refund_review_conflict',status:409};
  if(await locked(reg))return {error:'published_bracket_requires_correction',status:409};
  if(await hasDependents(reg))return {error:'dependent_registrations_active',status:409};
  const reason=clean(b.reason,500),policyReference=clean(b.policyReference,160),recipientReference=clean(b.recipientReference,160);
  if(!reason||!policyReference||!recipientReference||!['APPROVE','REJECT'].includes(b.action)||(!Number.isSafeInteger(b.amount)||b.amount<=0||b.amount>reg.amount))return {error:'refund_review_evidence_required',status:400};
  if(!reg.receiptLedgerId)return {error:'legacy_payment_review_required',status:409};
  const before=structuredClone(reg);
  reg.refundApproval={status:b.action==='APPROVE'?'APPROVED':'REJECTED',amount:b.amount,policyReference,recipientReference,reason,reviewedBy:user.id,reviewedAt:now()};
  reg.paymentStatus=b.action==='APPROVE'?'REFUND_REQUESTED':'PAID';reg.paymentRevision=(reg.paymentRevision||0)+1;reg.updatedAt=now();
  await putJson('registrations/'+reg.id+'.json',reg);await auditPayment(user.id,'REFUND_'+b.action,reg,before,reason);
  return {registration:reg};
}

// One bank transaction may fund multiple registrations. All allocations commit or roll back together.
export async function confirmBatchDeposit(b,user){
 if(!usesPostgres())return {error:'transactional_database_required',status:503};
 const allocations=b.allocations,reference=clean(b.reference,80),reason=clean(b.reason,500);
 if(!reference||!reason||!Array.isArray(allocations)||allocations.length<2||allocations.length>100||!Number.isSafeInteger(b.amount)||b.amount<=0)return {error:'invalid_batch_deposit',status:400};
 if(new Set(allocations.map(a=>a.registrationId)).size!==allocations.length)return {error:'duplicate_batch_registration',status:400};
 let total=0,bankKey=null;const regs=[];
 for(const a of allocations){
  const r=await getJson('registrations/'+clean(a.registrationId,80)+'.json');
  if(!r||r.status!=='REGISTERED'||!['UNPAID','PENDING'].includes(r.paymentStatus)||a.revision!==(r.paymentRevision||0)||!Number.isSafeInteger(a.amount)||a.amount!==r.amount||a.amount<=0)return {error:'invalid_batch_allocation',status:409};
  const key=[r.bankTransfer?.bankName,r.bankTransfer?.accountNumber?.replace(/[ -]/g,'')].join('|');
  if(!r.bankTransfer?.accountNumber||(bankKey!==null&&key!==bankKey))return {error:'batch_bank_mismatch',status:400};
  bankKey=key;total+=a.amount;regs.push(r);
 }
 if(total!==b.amount)return {error:'batch_total_mismatch',status:400};
 // Pay dependency-free registrations before their additional entries.
 const pending=[...regs],ordered=[];
 while(pending.length){const i=pending.findIndex(r=>!pending.some(p=>p.id===r.priceSnapshot?.baseRegistrationId));if(i<0)return {error:'batch_dependency_cycle',status:409};ordered.push(pending.splice(i,1)[0]);}
 const batchId=makeId('batch');let index=0;
 for(const r of ordered){
  const result=await confirmManualPayment(r,{paymentStatus:'PAID',revision:r.paymentRevision||0,amount:r.amount,occurredAt:b.occurredAt,reference:index++===0?reference:reference+'::'+r.id,reason},user);
  if(result.error)return result; // apiHandler rolls back responses with status >= 400.
 }
 const batch={id:batchId,reference,amount:b.amount,allocations:regs.map(r=>({registrationId:r.id,amount:r.amount})),recordedBy:user.id,createdAt:now()};
 await putJson('payment-batches/'+batchId+'.json',batch,{overwrite:false});
 return {batch};
}
