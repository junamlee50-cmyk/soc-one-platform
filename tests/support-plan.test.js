import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const plan=JSON.parse(readFileSync(new URL('../assets/support-plan.json',import.meta.url),'utf8'));
test('published support allowances equal each annual cap and the first-season budget',()=>{
 for(const tier of plan.tiers){assert.equal(tier.items.reduce((sum,item)=>sum+item.amount,0),tier.annualCap,tier.id);assert(tier.places>0);}
 assert.equal(plan.tiers.reduce((sum,tier)=>sum+tier.places,0),35);
 assert.equal(plan.tiers.reduce((sum,tier)=>sum+tier.places*tier.annualCap,0),45000000);
});
