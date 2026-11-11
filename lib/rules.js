export const DRAFT_RULES = {
  id:'SOC-RANKING-DRAFT-20261105',version:'2026-11-05-draft',status:'DRAFT',
  participation:5,win:10,bestEvents:6,
  medals:{GOLD:100,SILVER:60,BRONZE:30,ABS_GOLD:180,ABS_SILVER:100,ABS_BRONZE:50},
  bracketFactors:{one:0,two:0.7,three:null,four:1,fiveToEight:null,ninePlus:null}
};
export function validateRules(input){
  if(!input||!['DRAFT','APPROVED'].includes(input.status))return 'invalid_rules_status';
  if(!input.version||typeof input.version!=='string'||input.version.length>60)return 'rules_version_required';
  if(input.bestEvents!==6)return 'invalid_best_events';
  const points=[input.participation,input.win,...Object.keys(DRAFT_RULES.medals).map(k=>input.medals?.[k])];
  if(points.some(v=>!Number.isFinite(v)||v<0||v>10000))return 'invalid_rule_points';
  const factors=Object.keys(DRAFT_RULES.bracketFactors).map(k=>input.bracketFactors?.[k]);
  if(factors.some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>5)))return 'invalid_rule_factor';
  if(input.status==='APPROVED'&&factors.some(v=>v===null))return 'unresolved_rule_factors';
  return null;
}
export function bracketFactor(count,rules){return rules.bracketFactors[count===1?'one':count===2?'two':count===3?'three':count===4?'four':count<=8?'fiveToEight':'ninePlus'];}
