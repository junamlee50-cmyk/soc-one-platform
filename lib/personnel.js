import {getJson,putJson,listJson,clean,makeId,now} from './blobdb.js';
import {usesPostgres} from './database.js';
import {recordCashFlow} from './business.js';
const manager=u=>u.roles.some(r=>['ADMIN','CEO'].includes(r));
const fail=(res,status,message)=>res.status(status).json({ok:false,message});
export async function personnel(req,res,user,{admin=false}={}){
 const rows=await listJson('personnel/'),b=req.body||{},action=b.action;
 if(req.method==='GET')return res.status(200).json({ok:true,records:admin?rows:rows.filter(r=>r.userId===user.id),canManage:admin&&manager(user),people:admin?(await listJson('users/')).filter(u=>u.status==='ACTIVE'&&u.roles.some(r=>['REFEREE','COMMITTEE'].includes(r))).map(u=>({id:u.id,name:u.name,roles:u.roles})):[]});
 if(!usesPostgres())return fail(res,503,'운영 데이터베이스 연결 후 처리해 주세요.');
 const previous=rows.find(r=>r.id===b.id),reason=clean(b.reason,500);let row;
 if(!reason)return fail(res,400,'처리 사유를 입력해 주세요.');
 if(action==='CREATE'){
  if(!admin||!manager(user))return fail(res,403,'관리자만 교육·활동·평가·수당을 등록합니다.');
  const person=await getJson('users/'+clean(b.userId,80)+'.json'),type=clean(b.type,30),title=clean(b.title,180),amount=Number(b.amount||0),score=b.score===''||b.score==null?null:Number(b.score),date=clean(b.date,10);
  if(!person||person.status!=='ACTIVE'||!person.roles.some(r=>['REFEREE','COMMITTEE'].includes(r))||!['EDUCATION','ACTIVITY','ASSESSMENT','ALLOWANCE'].includes(type)||!title||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!Number.isSafeInteger(amount)||amount<0||score!==null&&(!Number.isFinite(score)||score<0||score>100))return fail(res,400,'대상자·구분·제목·날짜·금액·평가점수를 확인해 주세요.');
  if(type==='ALLOWANCE'&&amount<=0||type==='ASSESSMENT'&&score===null)return fail(res,400,'수당은 지급 예정액, 평가는 승인 기준에 따른 점수가 필요합니다.');
  row={id:makeId('personnel'),kind:'personnel',userId:person.id,personName:person.name,type,title,date,amount:type==='ALLOWANCE'?amount:0,score:type==='ASSESSMENT'?score:null,basis:clean(b.basis,1000),evidence:clean(b.evidence,1000),status:'DRAFT',revision:0,createdBy:user.id,createdAt:now()};
 }else{
  if(!previous||!admin&&previous.userId!==user.id)return fail(res,404,'본인 기록을 선택해 주세요.');
  if(b.revision!==previous.revision)return fail(res,409,'다른 변경이 있습니다. 새로고침해 주세요.');row=structuredClone(previous);
  if(action==='SUBMIT'){
   if(!['DRAFT','RETURNED'].includes(row.status)||!admin&&row.userId!==user.id)return fail(res,409,'작성·보완 중인 본인 기록만 제출할 수 있습니다.');
   row.evidence=clean(b.evidence,1000);if(!row.evidence||!row.basis)return fail(res,400,'계약·평가 기준과 실제 교육·활동·출석 증빙을 입력해 주세요.');row.status='IN_REVIEW';row.submittedBy=user.id;
  }else if(['APPROVE','RETURN'].includes(action)){
   if(!admin||!manager(user)||[row.userId,row.createdBy,row.submittedBy].includes(user.id))return fail(res,403,'대상자·등록자·제출자와 다른 관리자가 검토합니다.');
   if(row.status!=='IN_REVIEW')return fail(res,409,'검토 대기 상태가 아닙니다.');
   if(action==='APPROVE'&&row.date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}))return fail(res,409,'활동·교육을 마친 후 실제 증빙을 확인해 주세요.');
   row.status=action==='APPROVE'?'APPROVED':'RETURNED';row.reviewedBy=user.id;row.reviewReason=reason;
  }else if(action==='PAY'){
   if(!admin||row.type!=='ALLOWANCE'||row.status!=='APPROVED'||[row.userId,row.reviewedBy].includes(user.id))return fail(res,403,'대상자·승인자와 다른 수납 담당자가 실제 지급을 기록합니다.');
   if(Number(b.amount)!==row.amount)return fail(res,400,'승인된 지급액과 일치해야 합니다.');
   const result=await recordCashFlow(row,user,'OUT',row.amount,b,'PERSONNEL_PAY');if(result.error)return fail(res,400,result.error);row.status='PAID';row.paymentId=result.entry.id;
  }else if(action==='CANCEL'){
   if(!admin||!manager(user)||!['DRAFT','RETURNED'].includes(row.status))return fail(res,409,'작성·보완 중인 기록만 취소할 수 있습니다.');row.status='CANCELED';
  }else return fail(res,400,'처리 종류를 확인해 주세요.');
 }
 row.revision++;row.updatedAt=now();await putJson('personnel/'+row.id+'.json',row,{overwrite:!!previous});await putJson('audit/'+makeId('aud')+'.json',{action:'PERSONNEL_'+action,actorUserId:user.id,entityId:row.id,before:previous,after:row,reason,createdAt:now()},{overwrite:false});
 return res.status(previous?200:201).json({ok:true,record:row});
}
