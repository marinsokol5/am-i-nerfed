import test from 'node:test';
import assert from 'node:assert/strict';
import {generateTaskBank,tracking} from '../src/task-bank.js';
import {grade} from '../src/grading.js';

test('private banks deterministically contain five distinct tasks at each level',()=>{
  const a=generateTaskBank('synthetic-bank-a'),b=generateTaskBank('synthetic-bank-b');
  assert.deepEqual(a,generateTaskBank('synthetic-bank-a'));assert.notDeepEqual(a,b);
  assert.equal(a.tasks.length,15);assert.equal(new Set(a.tasks.map(t=>t.promptHash)).size,15);
  for(const level of ['easy','medium','hard'])assert.deepEqual(a.tasks.filter(t=>t.difficulty===level).map(t=>t.family),['hats','cards','knowledge','tracking','coordination']);
  for(const task of a.tasks){assert.equal(grade(task.answer,task.answer).percent,100);assert.equal(grade(task.answer,null).percent,0);}
});
test('hat answers are independently determined from the public transcript, including changed order',()=>{
  for(const task of generateTaskBank('synthetic-public-hats').tasks.filter(t=>t.family==='hats')) {
    const prompt=task.prompt,n=Number(/(\d) people \(/.exec(prompt)[1]);
    const counts=[.../wear exactly (.*?) hats/.exec(prompt)[1].matchAll(/(\d) (red|blue|white|green)/g)];
    const pool=counts.flatMap(m=>Array(Number(m[1])).fill(m[2]));
    const worlds=[];
    function permute(prefix,remaining){if(!remaining.length){worlds.push(prefix);return;}for(const color of new Set(remaining)){const copy=[...remaining];copy.splice(copy.indexOf(color),1);permute([...prefix,color],copy);}}
    permute([],pool);
    const vis=[...prompt.matchAll(/^([A-H]) sees ([A-H](?:, [A-H])*)\.$/gm)].map(m=>m[2].split(', ').map(x=>x.charCodeAt(0)-65));
    const said=[...prompt.matchAll(/^Round (\d), ([A-H]): (unknown|red|blue|white|green)$/gm)];
    const utterance=(w,possible,s)=>{
      const candidates=possible.filter(v=>vis[s].every(i=>v[i]===w[i]));const colors=new Set(candidates.map(v=>v[s]));
      return colors.size===1?[...colors][0]:'unknown';
    };
    let possible=worlds;
    for(const [,round,who,reply] of said){const s=who.charCodeAt(0)-65;possible=possible.filter(w=>utterance(w,possible,s)===reply);}
    assert.equal(possible.length,1);
    const actual=possible[0];assert.deepEqual(task.answer.knowledge.hats,Object.fromEntries(actual.map((c,i)=>[String.fromCharCode(65+i),c])));
    const alt=/same hats but order ([A-H](?:, [A-H])*) in each of (\d)/.exec(prompt);
    const order=alt[1].split(', ');possible=worlds;const expected={};
    for(let round=1;round<=Number(alt[2]);round++)for(const who of order){const s=who.charCodeAt(0)-65,reply=utterance(actual,possible,s);expected[`round${round}_${who}`]=reply;possible=possible.filter(w=>utterance(w,possible,s)===reply);}
    assert.deepEqual(task.answer.knowledge.alternative,expected);assert.equal(actual.length,n);
  }
});
test('tracking keys match a forward replay of every observer subset',()=>{
  for(let level=0;level<3;level++) {
    const task=tracking('synthetic-forward-'+level,level),{initial,events,queries}=task.oracle;
    const people=[...new Set(events.flatMap(e=>e.audience))];const beliefs=new Map();let actual={...initial};
    for(let mask=1;mask<(1<<people.length);mask++)beliefs.set(mask,{...initial});
    for(const e of events){if(!e.whisper)actual[e.object]=e.place;const audience=e.audience.reduce((m,p)=>m|(1<<people.indexOf(p)),0);
      for(const [mask,belief] of beliefs)if((mask&audience)===mask)belief[e.object]=e.place;
    }
    const expected=Object.fromEntries(queries.map((q,i)=>{const mask=q.chain.reduce((m,p)=>m|(1<<people.indexOf(p)),0);return [`q${i+1}`,(mask?beliefs.get(mask):actual)[q.object]];}));
    assert.deepEqual(task.answer.knowledge,expected);
  }
});

test('card dialogues independently reduce the public list to the keyed card and counts',()=>{
  for(const task of generateTaskBank('synthetic-public-cards').tasks.filter(t=>t.family==='cards')) {
    const list=task.prompt.split('complete public list:\n')[1].split('\nAnn sees')[0].trim().split('\n');
    let possible=list.map(name=>name.split(' '));const people=['Ann','Bob','Cid'];
    const cell=(person,w,worlds)=>worlds.filter(x=>x[person]===w[person]);
    const knows=(person,w,worlds)=>cell(person,w,worlds).length===1;
    const knowsWhether=(i,j,w,worlds)=>new Set(cell(i,w,worlds).map(x=>knows(j,x,worlds))).size===1;
    const replies=[...task.prompt.matchAll(/^(\d+)\. (Ann|Bob|Cid): (.*)$/gm)];const counts={};
    for(const [,number,speaker,text] of replies) {
      const i=people.indexOf(speaker),before=possible;
      const truth=w=>{
        if(text==='I know which card it is.')return knows(i,w,before);
        if(text==='I do not know which card it is.')return !knows(i,w,before);
        const nested=/^I know that (Ann|Bob|Cid) does not know whether (Ann|Bob|Cid) knows which card it is\.$/.exec(text);
        if(nested)return cell(i,w,before).every(x=>!knowsWhether(people.indexOf(nested[1]),people.indexOf(nested[2]),x,before));
        const whether=/^I do not know whether (Ann|Bob|Cid) knows which card it is\.$/.exec(text);
        if(whether)return !knowsWhether(i,people.indexOf(whether[1]),w,before);
        const unknown=/^I know that (Ann|Bob|Cid) does not know which card it is\.$/.exec(text);
        assert.ok(unknown,text);return cell(i,w,before).every(x=>!knows(people.indexOf(unknown[1]),x,before));
      };
      possible=before.filter(truth);counts['after'+number]=possible.length;
    }
    assert.equal(possible.length,1);assert.equal(possible[0].join(' '),task.answer.knowledge.card);
    assert.deepEqual(counts,task.answer.knowledge.remaining);
  }
});
