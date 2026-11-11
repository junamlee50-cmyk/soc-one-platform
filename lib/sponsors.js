import {getJson,putJson,clean,makeId,now} from './blobdb.js';
export async function saveSponsor(req,res,user){
 const b=req.body||{},previous=b.id?await getJson('sponsors/'+clean(b.id,80)+'.json'):null;
 if(b.id&&!previous)return res.status(404).json({ok:false,message:'파트너 기록을 찾을 수 없습니다.'});
 if(previous&&b.revision!==(previous.revision||0))return res.status(409).json({ok:false,message:'다른 변경이 있습니다. 다시 불러와 주세요.'});
 const row={...previous,id:previous?.id||makeId('spn'),name:clean(b.name,180),category:clean(b.category,80),status:clean(b.status,30)||'LEAD',contractValue:Number(b.contractValue),receivable:Number(b.receivable),currency:'KRW',notes:clean(b.notes,1000),contractReference:clean(b.contractReference,300),publicListing:b.publicListing===true,revision:(previous?.revision||0)+1,createdAt:previous?.createdAt||now(),updatedAt:now(),updatedBy:user.id};
 if(!row.name||!['LEAD','NEGOTIATING','CONTRACTED','ACTIVE','COMPLETED','CANCELED','CLOSED'].includes(row.status)||![row.contractValue,row.receivable].every(n=>Number.isSafeInteger(n)&&n>=0)||row.receivable>row.contractValue||!clean(b.reason,500)||['CONTRACTED','ACTIVE','COMPLETED'].includes(row.status)&&!row.contractReference)return res.status(400).json({ok:false,message:'파트너명·상태·금액·계약 증빙·처리 사유를 확인해 주세요. 미수금은 계약금액을 넘을 수 없습니다.'});
 if(!['CONTRACTED','ACTIVE','COMPLETED'].includes(row.status))row.publicListing=false;
 await putJson('sponsors/'+row.id+'.json',row,{overwrite:!!previous});await putJson('audit/'+makeId('aud')+'.json',{action:'SPONSOR_SAVED',actorUserId:user.id,entityId:row.id,before:previous,after:row,reason:clean(b.reason,500),createdAt:now()},{overwrite:false});return res.status(previous?200:201).json({ok:true,sponsor:row});
}
